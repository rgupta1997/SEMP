import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, KeyRound, Plus, UserPlus, X } from 'lucide-react';
import { CAPABILITIES } from '@semp/entitlements';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useOrgUnits, type UnitNode } from '../lib/units';
import { downloadCsvTemplate } from '../lib/import';
import { Badge, Button, Checkbox, Modal, Input, SearchInput, Select, Spinner, toast, INSET} from './ui';

// Adding people to the roll from the screen they are missing from (J1-E5-S3).
//
// Two ways in, one submission. Search-and-link finds an account that ALREADY
// exists - by phone - and attaches it directly by id, which is what actually
// removes an ambiguity the platform's own sign-in already has to answer: Option B
// (accounts.service.ts) lets one phone number back several separate accounts
// with different emails, so guessing "the" account from a phone number alone is
// a coin flip. A row that already names its exact account (`user_id`) skips
// that guess entirely - see the note on RosterRow.user_id in the API's
// roster-import.ts, which is what actually resolves it.
//
// A found account can ALSO be the wrong door on purpose: an organiser who wants
// this person on THIS number but under their own work email is not looking for
// an existing account at all, they're starting a new one that happens to share
// a number with one already found - which Option B explicitly allows. The
// "start a new account here" action on each result copies the number into a
// blank manual row instead of linking, for exactly that case.
//
// Manual rows are still here for the person search genuinely can't find: nobody
// on the platform yet, so a login has to be provisioned for them. A single row
// goes to POST /people, which is never gated; more than one (of either kind) goes
// through the bulk importer, which is - so the row limit IS the capability, and
// the button says so rather than letting the submit fail with a 403.
//
// The placement is a picker rather than a text field on purpose. The server rejects
// a campus or department it does not already know, because a typo would otherwise
// quietly found a new one; offering a free-text box that can only ever be wrong is
// not a kindness. Since units became what compete in an intra-organisation
// championship, a typo would also invent an ENTRANT, which is worse.

interface Row { name: string; email: string; phone: string; member_code: string; unit: string }

const blankRow = (): Row => ({ name: '', email: '', phone: '', member_code: '', unit: '' });

interface Credential { name: string; email: string; phone: string | null; password: string }

interface RowResult {
  index: number;
  verdict: 'create' | 'match' | 'update' | 'reject';
  message: string;
  name: string | null;
}

interface Report {
  rows: RowResult[];
  summary: { total: number; create: number; match: number; update: number; reject: number };
  applied?: number;
  credentials?: Credential[];
}

/** What both paths - one person and several - come back as, so one screen renders both. */
interface Outcome { total: number; added: number; skipped: RowResult[]; credentials: Credential[] }

/** A person the search picker found - already a real account, just missing from this roll. */
interface FoundUser { id: string; name: string; email: string; phone: string | null }

/** A found account picked to link, plus the SAME placement fields a manual row gets -
 * being an existing account doesn't mean this institution already knows their roll
 * number or which campus they belong to here. */
interface LinkedPerson extends FoundUser { member_code: string; unit: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (s: string) => s.replace(/\D/g, '');
/** The last 10 digits, same convention `phoneLast10` uses server-side - "+91 98765
 * 43210" and "9876543210" are the same number, and must compare equal here too. */
const last10 = (phone: string | null | undefined) => {
  const d = digits(phone ?? '');
  return d.length >= 10 ? d.slice(-10) : '';
};

// The first rules the server's validator applies, applied here too so an obvious
// mistake costs a keystroke rather than a round trip. Everything it does NOT
// cover - a duplicate phone, a member code somebody else holds - is still the
// server's to answer, and its verdict is what the result screen reports.
function rowError(r: Row): string | null {
  if (!r.name.trim()) return 'A name is required.';
  if (r.email.trim() && !EMAIL.test(r.email.trim())) return `"${r.email.trim()}" is not a valid email address.`;
  if (r.phone.trim() && digits(r.phone).length !== 10) return `"${r.phone.trim()}" is not a 10-digit phone number.`;
  if (!r.email.trim() && digits(r.phone).length !== 10) return 'Give an email or a 10-digit phone number.';
  return null;
}

// A still-blank row is an offer to add someone, not a person yet - it must not
// block Link when the organiser only meant to use search-and-link, and it's what
// "start a new account on this number" reuses instead of always adding a fresh row.
const isBlankRow = (r: Row) => !r.name.trim() && !r.email.trim() && !r.phone.trim() && !r.member_code.trim() && !r.unit;

/** The unit tree flattened to what a select can hold: a campus and its departments. */
function flattenUnits(units: UnitNode[]): Array<{ campus: UnitNode; departments: UnitNode[] }> {
  return units.map((u) => ({ campus: u, departments: u.children ?? [] }));
}

// The unit is carried as `type:name` because the server takes NAMES, not ids - the
// same shape the spreadsheet importer takes, so every path (manual row, linked
// account, CSV) meets the same validator.
function unitFields(unit: string): { campus?: string; department?: string } {
  const sep = unit.indexOf(':');
  if (sep < 0) return {};
  const type = unit.slice(0, sep);
  const name = unit.slice(sep + 1);
  return name ? (type === 'department' ? { department: name } : { campus: name }) : {};
}

/**
 * Every found account, grouped by phone number - the one signal that surfaces Option B
 * (several accounts sharing a number) instead of hiding it behind a single guess.
 *
 * Grouped by the last 10 digits, the same normalisation the server uses everywhere
 * else a phone is compared (phoneLast10) - "9876543210" and "+91 98765 43210" are
 * the same number and MUST land in the same group, or two accounts that share a
 * number look unrelated just because one of them was typed with a country code.
 * An account with no phone on file gets a group of its own rather than being
 * lumped under "no number".
 */
interface PhoneGroup { key: string; phone: string | null; users: FoundUser[] }
function groupByPhone(users: FoundUser[]): PhoneGroup[] {
  const byKey = new Map<string, PhoneGroup>();
  for (const u of users) {
    const l10 = last10(u.phone);
    const key = l10 || `solo:${u.id}`;
    const g = byKey.get(key);
    if (g) g.users.push(u);
    else byKey.set(key, { key, phone: u.phone, users: [u] });
  }
  return [...byKey.values()];
}

export function AddPlayersModal({
  orgId, canBulk, existingUserIds, onClose, onAdded,
}: {
  orgId: string;
  /** Whether this plan may add more than one person at a time. */
  canBulk: boolean;
  /** Accounts already on this roll - search still shows them (removing them would
   * hide the very fact that a phone has another account too), but linking one
   * again would just be a no-op the organiser has to puzzle over, so it's shown
   * as already added rather than offered. */
  existingUserIds?: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  // Reading the structure is open to every member: `multi_campus` gates running a
  // SECOND campus, not looking at the one you have. So an empty picker here means
  // the organisation has not built its structure yet, not that it has not paid.
  const { units, labels, error: unitsError } = useOrgUnits(orgId);
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  // Accounts picked from search, by id - a Map (not a Set) because the result
  // screen and the placement inputs need the rest of the record back, and the
  // search results that produced it can scroll out of view or change as the
  // query changes.
  const [linked, setLinked] = useState<Map<string, LinkedPerson>>(new Map());
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Phone-only: this picker's whole reason to exist is Option B (several accounts
  // on one number), so a hit on name or email would surface the WRONG kind of
  // match - somebody unrelated whose email happens to contain the same digits.
  // Unmasked for now - real numbers, on purpose (a later pass, not this one).
  // Nothing loads until there are enough digits to mean something - unlike a
  // typeahead that shows "the first 10 people" by default, a query too short to
  // narrow anything would just be noise above the manual rows.
  const queryDigits = digits(debounced);
  const searchPath = queryDigits.length >= 3 ? `/users?q=${encodeURIComponent(queryDigits)}&phone_only=1&limit=25` : null;
  const { data: found = [], isFetching: searching } = useApi<FoundUser[]>(searchPath);
  const resultGroups = useMemo(() => groupByPhone(found), [found]);

  const unitGroups = useMemo(() => flattenUnits(units), [units]);
  // Aligned 1:1 with `rows` (not filtered) so `errors[i]` always matches `rows[i]`
  // when rendering per-row messages.
  const errors = useMemo(() => rows.map((r) => (isBlankRow(r) ? null : rowError(r))), [rows]);
  const ready = errors.every((e) => e === null);
  const activeRows = useMemo(() => rows.filter((r) => !isBlankRow(r)), [rows]);

  // One combined count - a linked account and a manually-typed row are the same act
  // (a person joining the roll) performed a different way, so the capability that
  // gates "more than one at a time" has to gate BOTH the same way.
  const total = activeRows.length + linked.size;
  const atCap = !canBulk && total >= 1;
  // "Start a new account on this number" either fills the existing blank row slot
  // (free on any plan) or has to open a new one, which only a bulk plan may do.
  const canQuickAdd = rows.some(isBlankRow) || canBulk;
  const alreadyAdded = (id: string) => existingUserIds?.has(id) ?? false;

  const toggleLink = (u: FoundUser) => {
    setLinked((m) => {
      if (m.has(u.id)) { const next = new Map(m); next.delete(u.id); return next; }
      if (atCap) return m; // selecting a NEW one is what the cap refuses; deselecting always works
      return new Map(m).set(u.id, { ...u, member_code: '', unit: '' });
    });
  };
  const setLinkedField = (id: string, patch: Partial<Pick<LinkedPerson, 'member_code' | 'unit'>>) =>
    setLinked((m) => {
      const cur = m.get(id);
      if (!cur) return m;
      return new Map(m).set(id, { ...cur, ...patch });
    });
  const toggleExpand = (key: string) => setExpanded((s) => {
    const next = new Set(s);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  // Reuses the first empty row rather than always adding a new one - the person
  // typing a name right after has no reason to see a second, unrelated blank row
  // appear alongside it. Only opens a NEW row when every existing one is already
  // in use, which is exactly what `canQuickAdd` gates on the button itself.
  const addRowWithPhone = (phone: string) => setRows((rs) => {
    const idx = rs.findIndex(isBlankRow);
    if (idx >= 0) return rs.map((r, i) => (i === idx ? { ...r, phone } : r));
    return [...rs, { ...blankRow(), phone }];
  });

  const payload = (r: Row) => ({
    name: r.name.trim(),
    email: r.email.trim() || null,
    phone: r.phone.trim() || null,
    member_code: r.member_code.trim() || null,
    ...unitFields(r.unit),
  });

  const linkedPayload = (u: LinkedPerson) => ({
    user_id: u.id,
    member_code: u.member_code.trim() || null,
    ...unitFields(u.unit),
  });

  const submit = async () => {
    setAttempted(true);
    if (!ready) return;
    // A linked row carries `user_id` - the server looks the account up directly
    // by it (see RosterRow.user_id) rather than re-guessing from name/email/
    // phone, which is the entire point of having searched for it first.
    const allRows: Array<Record<string, unknown>> = [
      ...[...linked.values()].map(linkedPayload),
      ...activeRows.map(payload),
    ];
    if (allRows.length === 0) return;
    setBusy(true);
    try {
      if (allRows.length === 1) {
        // Never gated, and it answers with the one login it may have just made.
        const res = await api<{ name: string | null; credential: Credential | null }>(
          'POST', `/organizations/${orgId}/people`, allRows[0],
        );
        setOutcome({
          total: 1, added: 1, skipped: [],
          credentials: res.credential ? [res.credential] : [],
        });
      } else {
        const res = await api<Report>('POST', `/organizations/${orgId}/people/import`, {
          rows: allRows,
        });
        setOutcome({
          total: res.summary.total,
          added: res.applied ?? 0,
          skipped: res.rows.filter((r) => r.verdict === 'reject'),
          credentials: res.credentials ?? [],
        });
      }
      onAdded();
    } catch (e: any) {
      // A single add is refused outright when the validator rejects it, and the
      // refusal names the reason - so it belongs against the form, not on a
      // result screen that would claim something happened.
      toast.error(e?.message ?? 'Could not add that person');
    } finally {
      setBusy(false);
    }
  };

  if (outcome) {
    const { added, total: outcomeTotal, skipped, credentials } = outcome;
    return (
      <Modal title={added === 1 ? 'Player added' : `${added} players added`} onClose={onClose} size="3xl" dismissible={false}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {added} of {outcomeTotal} {outcomeTotal === 1 ? 'person is' : 'people are'} now on the roll, added as{' '}
            <strong>verified</strong>.
            {skipped.length > 0 && ` ${skipped.length} ${skipped.length === 1 ? 'row was' : 'rows were'} not added.`}
          </p>

          {skipped.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-rose-200 dark:border-rose-500/30">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-rose-100 dark:divide-rose-500/20">
                  {skipped.map((r) => (
                    <tr key={r.index} className="bg-rose-50/50 dark:bg-rose-500/5">
                      <td className="px-3 py-2 font-medium">{r.name ?? `Row ${r.index + 1}`}</td>
                      <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{r.message}</td>
                      <td className="px-3 py-2 text-right"><Badge tone="rose">Not added</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Shown once and never again - the passwords are not stored anywhere in
              readable form. Leaving without taking them means resetting them one
              at a time, so the warning is blunt rather than polite. */}
          {credentials.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-display text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Sign-ins for {credentials.length} new {credentials.length === 1 ? 'account' : 'accounts'}
                </h4>
                <Button
                  size="sm"
                  onClick={() => downloadCsvTemplate(
                    'new-player-sign-ins.csv',
                    ['name', 'email', 'phone', 'temporary_password'],
                    credentials.map((c) => [c.name, c.email, c.phone ?? '', c.password]),
                  )}
                >
                  Download CSV
                </Button>
              </div>
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                <KeyRound size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  Shown only now — once you close this they cannot be retrieved, only reset. Each person
                  is asked to choose their own password the first time they sign in.
                </span>
              </p>
              <div className={`max-h-64 overflow-auto ${INSET}`}>
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Sign in with</th>
                      <th className="px-3 py-2">Temporary password</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {credentials.map((c) => (
                      <tr key={c.email}>
                        <td className="px-3 py-2">{c.name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{c.email}{c.phone ? ` · ${c.phone}` : ''}</td>
                        <td className="px-3 py-2 font-mono text-xs font-semibold">{c.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => {
                setOutcome(null); setRows([blankRow()]); setLinked(new Map());
                setQuery(''); setDebounced(''); setExpanded(new Set()); setAttempted(false);
              }}
            >
              Add more
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  const cols = 'sm:grid-cols-[1fr_1.4fr_1.6fr_0.9fr_1.3fr_auto]';

  return (
    <Modal
      title={total <= 1 ? 'Add a Person' : `Add ${total} people`}
      onClose={onClose}
      size="4xl"
      dismissible={!busy}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Search first — anyone already on Sportagon is linked to their existing account. Want them on a
          different login instead (say, a work email)? Use <UserPlus size={12} className="inline -mt-0.5" aria-hidden /> next
          to a match to start a new account on that same number. Only add someone below if the search
          genuinely can't find them.
        </p>

        {/* ---- search & link an existing account ------------------------- */}
        <div className="space-y-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Search by phone…" className="w-full" />

          {debounced.length >= 2 && (
            <div className={`overflow-hidden ${INSET}`}>
              {searching && resultGroups.length === 0 ? (
                <div className="grid h-16 place-items-center"><Spinner /></div>
              ) : resultGroups.length === 0 ? (
                <p className="px-4 py-4 text-center text-sm text-slate-400 dark:text-slate-500">
                  No matching accounts. Add them below instead.
                </p>
              ) : (
                <div className="max-h-64 divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
                  {resultGroups.map((g) => {
                    const isOpen = expanded.has(g.key);
                    const multi = g.users.length > 1;
                    const primary = g.users[0];
                    // One "start a new account here" action per NUMBER, not per
                    // account under it - it means "someone else on this same
                    // number", which is a fact about the group, not any one row in it.
                    const quickAdd = g.phone && (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); addRowWithPhone(g.phone!); }}
                        disabled={!canQuickAdd}
                        title="Start a new account on this number - e.g. with a work email"
                        aria-label="Start a new account on this number"
                        className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-slate-700 dark:hover:text-slate-200"
                      >
                        <UserPlus size={15} />
                      </button>
                    );
                    return (
                      <div key={g.key}>
                        {multi ? (
                          <div className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                            <button
                              type="button"
                              onClick={() => toggleExpand(g.key)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              {isOpen ? <ChevronDown size={15} className="shrink-0 text-slate-400" aria-hidden /> : <ChevronRight size={15} className="shrink-0 text-slate-400" aria-hidden />}
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                                  {g.phone || primary.name}
                                  <span className="ml-1.5 text-xs font-normal text-slate-400 dark:text-slate-500">
                                    · {g.users.length} accounts on this number
                                  </span>
                                </div>
                              </div>
                            </button>
                            {quickAdd}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                            <span className="w-[15px] shrink-0" aria-hidden />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{primary.name}</div>
                              <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {primary.email}{g.phone ? ` · ${g.phone}` : ''}
                              </div>
                            </div>
                            {quickAdd}
                            {alreadyAdded(primary.id) ? (
                              <Badge tone="green">Added</Badge>
                            ) : (
                              <span className={atCap && !linked.has(primary.id) ? 'opacity-40' : ''}>
                                <Checkbox checked={linked.has(primary.id)} onChange={() => toggleLink(primary)} />
                              </span>
                            )}
                          </div>
                        )}
                        {multi && isOpen && (
                          <div className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/60 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-800/30">
                            {g.users.map((u) => (
                              <label
                                key={u.id}
                                className={`flex items-center gap-2 py-2 pl-9 pr-3 hover:bg-slate-100 dark:hover:bg-slate-800/60 ${alreadyAdded(u.id) ? '' : 'cursor-pointer'}`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm text-slate-800 dark:text-slate-200">{u.name}</div>
                                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">{u.email}</div>
                                </div>
                                {alreadyAdded(u.id) ? (
                                  <Badge tone="green">Added</Badge>
                                ) : (
                                  <span className={atCap && !linked.has(u.id) ? 'opacity-40' : ''}>
                                    <Checkbox checked={linked.has(u.id)} onChange={() => toggleLink(u)} />
                                  </span>
                                )}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---- linked accounts + manual rows: one placement editor for both --
            Being an existing account doesn't mean this institution already has
            a roll number or campus for them, so a linked row gets the same
            placement columns a manual row does - just with name/email/phone
            fixed rather than typed. ------------------------------------------ */}
        {(linked.size > 0 || rows.length > 0) && (
          <>
            <div className={`hidden gap-2 px-1 font-mono text-[9px] uppercase tracking-[0.13em] text-slate-500 sm:grid ${cols}`}>
              <span>Phone</span>
              <span>Name *</span>
              <span>Email</span>
              <span>Roll no.</span>
              <span>{labels.campus}</span>
              <span className="w-7" />
            </div>

            <div className="space-y-2">
              {[...linked.values()].map((u) => (
                <div key={u.id} className="rounded-xl bg-brand-50/60 p-2 dark:bg-brand-500/10">
                  <div className={`grid gap-2 ${cols}`}>
                    <div className="flex items-center truncate px-3 py-2 text-sm text-slate-500 dark:text-slate-400">{u.phone ?? '—'}</div>
                    <div className="flex items-center truncate px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-200" title={u.name}>{u.name}</div>
                    <div className="flex items-center truncate px-3 py-2 text-sm text-slate-500 dark:text-slate-400" title={u.email}>{u.email}</div>
                    <Input placeholder="Roll no." value={u.member_code} onChange={(e) => setLinkedField(u.id, { member_code: e.target.value })} />
                    <Select value={u.unit} onChange={(e) => setLinkedField(u.id, { unit: e.target.value })}>
                      <option value="">Unassigned</option>
                      {unitGroups.map((g) => (
                        <optgroup key={g.campus.id} label={g.campus.name}>
                          <option value={`campus:${g.campus.name}`}>{g.campus.name}</option>
                          {g.departments.map((d) => (
                            <option key={d.id} value={`department:${d.name}`}>{d.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                    <button
                      type="button"
                      aria-label={`Remove ${u.name}`}
                      onClick={() => toggleLink(u)}
                      className="flex h-9 w-7 items-center justify-center self-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              ))}

              {rows.map((r, i) => (
                <div key={i} className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800/50">
                  <div className={`grid gap-2 ${cols}`}>
                    <Input placeholder="Phone" value={r.phone} onChange={(e) => set(i, { phone: e.target.value })} />
                    <Input placeholder="Full name" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
                    <Input placeholder="Email" value={r.email} onChange={(e) => set(i, { email: e.target.value })} />
                    <Input placeholder="Roll no." value={r.member_code} onChange={(e) => set(i, { member_code: e.target.value })} />
                    <Select value={r.unit} onChange={(e) => set(i, { unit: e.target.value })}>
                      <option value="">Unassigned</option>
                      {unitGroups.map((g) => (
                        <optgroup key={g.campus.id} label={g.campus.name}>
                          <option value={`campus:${g.campus.name}`}>{g.campus.name}</option>
                          {g.departments.map((d) => (
                            <option key={d.id} value={`department:${d.name}`}>{d.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                    <button
                      type="button"
                      aria-label="Remove this person"
                      onClick={() => remove(i)}
                      className="flex h-9 w-7 items-center justify-center self-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {attempted && errors[i] && (
                    <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{errors[i]}</p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {/* Governed by the plan alone, not the live count: a free plan gets exactly
              one manual row SLOT, full stop, same as before this screen could also
              link existing accounts. `atCap` (below) still covers those - a blank,
              untouched slot must not itself count as "already at one". */}
          <Button variant="outline" size="sm" disabled={!canBulk} onClick={() => setRows((rs) => [...rs, blankRow()])}>
            <Plus size={14} /> Add
          </Button>
          {!canBulk && (
            // Named, not priced, and shown rather than hidden - somebody who cannot
            // find a feature assumes it does not exist.
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Adding several at once needs <strong>{CAPABILITIES.bulk_player_upload.label}</strong>, which is
              not on your current plan. One at a time always works.
            </span>
          )}
        </div>

        {units.length === 0 && !unitsError && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No {labels.campus.toLowerCase()} or {labels.department.toLowerCase()} exists yet — add them under
            the organisation's Campuses &amp; Units screen and people can be placed as they are added.
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {total} {total === 1 ? 'person' : 'people'}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || total === 0 || (attempted && !ready)}>
            {busy ? 'Linking…' : total <= 1 ? 'Link' : `Link ${total} people`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
