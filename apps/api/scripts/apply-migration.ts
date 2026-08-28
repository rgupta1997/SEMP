/**
 * Apply one .sql migration file.
 *
 *   npx tsx scripts/apply-migration.ts ../../supabase/migrations/<file>.sql
 *   npx tsx scripts/apply-migration.ts <file>.sql --direct   # session connection
 *
 * There was no migration runner in this repo, which is a large part of why the
 * folder's README has to track by hand which files have run. This is a small one.
 *
 * It splits on ';' while respecting dollar-quoted blocks ($$ ... $$) - the
 * migrations contain `do $$ ... $$;` and a naive split cuts them in half - and sends
 * each statement on its own, because Prisma's extended protocol refuses
 * multi-statement strings.
 *
 * NOT idempotent by itself: it re-runs every statement it is given. Write the
 * migration idempotently (`create table if not exists`, `drop constraint if
 * exists`), as the files in that folder already do.
 */

import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) { console.error('usage: apply-migration.ts <file.sql> [--direct]'); process.exit(1); }

// The default datasource (DATABASE_URL, the transaction pooler) rather than
// DIRECT_URL. Overriding `datasources` here hung without ever opening a session -
// pg_stat_activity showed nothing arrive - and every other script in this folder
// reaches the database perfectly well over the pooler.
//
// Pass --direct if a migration needs a session connection: pgbouncer in transaction
// mode cannot hold advisory locks or run a statement that must span the session, and
// some DDL wants one. Plain `create table` / `create index` / `alter table` are each
// one statement and go through fine.
const direct = process.argv.includes('--direct');
const prisma = direct && process.env.DIRECT_URL
  ? new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } })
  : new PrismaClient();

function split(sql: string): Array<{ sql: string; code: string }> {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  let tag: string | null = null; // the active dollar-quote tag, e.g. '$$' or '$fn$'
  while (i < sql.length) {
    if (tag) {
      if (sql.startsWith(tag, i)) { buf += tag; i += tag.length; tag = null; continue; }
      buf += sql[i++]; continue;
    }
    // line comment
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl + 1;
      buf += sql.slice(i, end); i = end; continue;
    }
    if (sql[i] === "'") {
      const j = sql.indexOf("'", i + 1);
      const end = j === -1 ? sql.length : j + 1;
      buf += sql.slice(i, end); i = end; continue;
    }
    const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (m) { tag = m[0]; buf += tag; i += tag.length; continue; }
    if (sql[i] === ';') { out.push(buf); buf = ''; i += 1; continue; }
    buf += sql[i++];
  }
  if (buf.trim()) out.push(buf);
  // Comment-only chunks are dropped - the gap between two statements in these files
  // is mostly prose. Done by stripping comment LINES rather than with a regex:
  // `/^(--.*\n?)*$/` is a nested quantifier, and against one of the long comment
  // blocks in these migrations it backtracks catastrophically. It hung for three
  // minutes and looked exactly like a stuck database connection.
  return out.map(label).filter((s) => s.code.length > 0);
}

/** A statement, plus its code with comment lines removed for the log line. */
function label(raw: string): { sql: string; code: string } {
  const code = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { sql: raw.trim(), code };
}

async function main() {
  const statements = split(readFileSync(file!, 'utf8'));
  console.log(`\n${file}\n${statements.length} statements\n`);
  for (const [n, { sql, code }] of statements.entries()) {
    const head = code.slice(0, 88);
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log(`  ✓ ${String(n + 1).padStart(2)}  ${head}`);
    } catch (e: any) {
      console.error(`  ✗ ${String(n + 1).padStart(2)}  ${head}\n      ${e.message.split('\n')[0]}`);
      throw e;
    }
  }
  console.log('\nDone.\n');
}

main().catch(() => process.exit(1)).finally(() => prisma.$disconnect());
