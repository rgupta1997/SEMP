#!/usr/bin/env python3
"""
What does supabase/migrations/ say should exist, and what does RDS actually have?

    python3 infra/rds-migrations/audit-drift.py            # uses DIRECT_URL from apps/api/.env
    DATABASE_URL=... python3 infra/rds-migrations/audit-drift.py

Read-only. It runs SELECTs against the catalogue and reads the migration files; it
never writes to either.

WHY THIS EXISTS, AND THE BUG IT WAS WRITTEN AROUND
--------------------------------------------------
`prisma migrate diff` only answers "do the tables match". It never reads pg_proc,
pg_trigger, partial indexes, CHECK constraints or seed rows, so a migration whose
substance is any of those looks applied when none of it arrived. This script is the
check the diff cannot be.

The first version of it got that right and then threw the answer away. It collected
every name any migration DROPS into one flat set and skipped those names when
reporting - the intent being to ignore objects a later migration deliberately
removed. But the idempotency pattern these migrations are written in is

    alter table t drop constraint if exists c;
    alter table t add constraint c check (...);

so every well-written constraint put its own name in the "deliberately dropped" set
and vanished from the report. It hid 22 missing CHECK constraints that way, and the
perverse part is WHICH ones: the carefully replayable migrations were exactly the
invisible ones, while two that happened to use a `do $$ if not exists $$` guard were
the only ones it caught.

The fix is to stop treating drops as a set and start treating them as events. An
object's expected state is decided by the LAST thing done to it, in migration order
and in statement order within a file - so drop-then-add resolves to "should exist",
and add-then-drop-in-a-later-file resolves to "should be absent". That is what a
migration directory actually means.

WHAT IT STILL CANNOT SEE
------------------------
Renames performed in DYNAMIC SQL. 20260616000000 renames institution_id to
organization_id across every table with

    execute format('alter table %I rename column institution_id to organization_id', r.tbl)

inside a loop, and no regex over the file text can follow that. It also renames an
index with `alter index ... rename to`, which is not matched either. So a handful of
fossils are reported as missing - users.institution_id, idx_users_institution_id,
the idx_teams_* and idx_sponsors_* indexes, trg_events_updated_at - and triaging a
hit against the thing that removed it is still a manual step. The script narrows the
field from 99 migrations to a short list; it does not replace reading.
"""
import os, re, sys, glob, subprocess, collections

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS = os.path.join(ROOT, 'supabase', 'migrations', '*.sql')


def db_url():
    u = os.environ.get('DATABASE_URL')
    if not u:
        env = os.path.join(ROOT, 'apps', 'api', '.env')
        for line in open(env):
            if line.startswith('DIRECT_URL='):
                u = line.split('=', 1)[1].strip().strip('"')
                break
    if not u:
        sys.exit('no DATABASE_URL and no DIRECT_URL in apps/api/.env')
    return re.sub(r'[?&]connection_limit=\d+', '', u)


def psql(url, sql):
    for d in ('/Applications/Postgres.app/Contents/Versions/latest/bin', '/opt/homebrew/bin', '/usr/local/bin'):
        if os.path.exists(os.path.join(d, 'psql')):
            os.environ['PATH'] = d + os.pathsep + os.environ['PATH']
            break
    r = subprocess.run(['psql', url, '-Atq', '-F', '|', '-c', sql],
                       capture_output=True, text=True,
                       env={**os.environ, 'PGCONNECT_TIMEOUT': '30'})
    if r.returncode:
        sys.exit(f'psql failed: {r.stderr.strip()}')
    return [l.split('|') for l in r.stdout.splitlines() if l]


INVENTORY_SQL = """
select 'table', tablename, '' from pg_tables where schemaname='public'
union all select 'column', table_name, column_name from information_schema.columns where table_schema='public'
union all select 'function', p.proname, '' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
union all select 'trigger', t.tgname, '' from pg_trigger t join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
union all select 'index', indexname, '' from pg_indexes where schemaname='public'
union all select 'constraint', conname, '' from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'
union all select 'enum', t.typname, '' from pg_type t join pg_namespace n on n.oid=t.typnamespace
  where n.nspname='public' and t.typtype='e'
union all select 'sequence', sequencename, '' from pg_sequences where schemaname='public'
"""

# (kind, regex). Each must capture the object name as group 1 (plus the table as
# group 1 and the column as group 2 for columns, handled separately).
CREATES = [
    ('table',      r'create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?'),
    ('function',   r'create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?'),
    ('trigger',    r'create\s+(?:or\s+replace\s+)?trigger\s+"?([a-z0-9_]+)"?'),
    ('index',      r'create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?'),
    ('constraint', r'add\s+constraint\s+"?([a-z0-9_]+)"?'),
    ('enum',       r'create\s+type\s+(?:public\.)?"?([a-z0-9_]+)"?\s+as\s+enum'),
    ('sequence',   r'create\s+sequence\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?'),
]
DROPS = [
    ('table',      r'drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?'),
    ('function',   r'drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?'),
    ('trigger',    r'drop\s+trigger\s+(?:if\s+exists\s+)?"?([a-z0-9_]+)"?'),
    ('index',      r'drop\s+index\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?'),
    ('constraint', r'drop\s+constraint\s+(?:if\s+exists\s+)?"?([a-z0-9_]+)"?'),
    ('enum',       r'drop\s+type\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?'),
    ('sequence',   r'drop\s+sequence\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?'),
]
COL_ADD  = r'alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?[^;]*?add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?'
COL_DROP = r'alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?[^;]*?drop\s+column\s+(?:if\s+exists\s+)?"?([a-z0-9_]+)"?'
TBL_RENAME = r'alter\s+table\s+(?:public\.)?"?([a-z0-9_]+)"?\s+rename\s+to\s+"?([a-z0-9_]+)"?'
COL_RENAME = r'alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s+rename\s+column\s+"?([a-z0-9_]+)"?\s+to\s+"?([a-z0-9_]+)"?'


def strip_sql(s):
    s = re.sub(r'/\*.*?\*/', ' ', s, flags=re.S)
    s = re.sub(r'^\s*--.*$', '', s, flags=re.M)
    return s.lower()


def main():
    url = db_url()
    live = collections.defaultdict(set)
    for kind, name, extra in psql(url, INVENTORY_SQL):
        live[kind].add((name.lower(), extra.lower()) if kind == 'column' else name.lower())

    # THE FIX: every create and every drop is an EVENT at a position, and the last
    # event for an object decides whether it should exist. Position is (filename,
    # character offset), so ordering holds within a file as well as across files.
    events = {}          # (kind, name) -> (pos, 'create'|'drop', source file)
    def record(kind, name, pos, action, src):
        key = (kind, name)
        if key not in events or pos > events[key][0]:
            events[key] = (pos, action, src)

    files = sorted(glob.glob(MIGRATIONS))
    for idx, f in enumerate(files):
        s = strip_sql(open(f).read())
        base = os.path.basename(f)
        for kind, pat in CREATES:
            for m in re.finditer(pat, s):
                record(kind, m.group(1), (idx, m.start()), 'create', base)
        for kind, pat in DROPS:
            for m in re.finditer(pat, s):
                record(kind, m.group(1), (idx, m.start()), 'drop', base)
        for m in re.finditer(COL_ADD, s, flags=re.S):
            record('column', (m.group(1), m.group(2)), (idx, m.start()), 'create', base)
        for m in re.finditer(COL_DROP, s, flags=re.S):
            record('column', (m.group(1), m.group(2)), (idx, m.start()), 'drop', base)
        # A rename retires the old name and introduces the new one, at the same point.
        for m in re.finditer(TBL_RENAME, s):
            record('table', m.group(1), (idx, m.start()), 'drop', base)
            record('table', m.group(2), (idx, m.start()), 'create', base)
        for m in re.finditer(COL_RENAME, s, flags=re.S):
            record('column', (m.group(1), m.group(2)), (idx, m.start()), 'drop', base)
            record('column', (m.group(1), m.group(3)), (idx, m.start()), 'create', base)

    missing = collections.defaultdict(list)
    for (kind, name), (_pos, action, src) in sorted(events.items(), key=lambda kv: str(kv[0])):
        if action != 'create':
            continue
        if kind == 'column':
            table, col = name
            # A column on a table that no longer exists is not drift.
            if table not in live['table']:
                continue
            if (table, col) not in live['column']:
                missing[src].append(f'column {table}.{col}')
        else:
            if name not in live[kind]:
                missing[src].append(f'{kind} {name}')

    total = sum(len(v) for v in missing.values())
    print(f'\n{len(files)} migrations, {sum(len(v) for v in live.values())} live objects on this database.')
    print(f'{total} object(s) that the migrations create and never drop are MISSING.\n')
    for src in sorted(missing):
        print(f'--- {src}')
        for x in sorted(missing[src]):
            print(f'      {x}')
    if not total:
        print('  nothing missing.')
    print()


if __name__ == '__main__':
    main()
