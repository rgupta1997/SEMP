import { useMemo, useState } from 'react';
import { KeyRound, Plus, X } from 'lucide-react';
import { CAPABILITIES } from '@semp/entitlements';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { downloadCsvTemplate } from '../lib/import';
import { PhoneLookupNotice } from './userProvisioning';
import { Badge, Button, Modal, Input, Select, toast, INSET} from './ui';

// Adding people to the roll from the screen they are missing from (J1-E5-S3).
//
// One modal, one row per person, because "add a player" and "add the four who
// joined late this week" are the same act performed a different number of times.
// A single row goes to POST /people, which is never gated; more than one goes
// through the bulk importer, which is - so the row limit IS the capability, and
// the button says so rather than letting the submit fail with a 403.
//
// The programme is a picker rather than a text field on purpose. The server
// rejects a programme or batch it does not already know, because a typo would
// otherwise quietly found a new department; offering a free-text box that can
// only ever be wrong is not a kindness.

interface UnitNode { id: string; type: string; name: string; children?: UnitNode[] }

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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (s: string) => s.replace(/\D/g, '');

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

/** The unit tree flattened to what a select can hold, keeping programme over batch. */
function flatten(units: UnitNode[]): Array<{ programme: UnitNode; batches: UnitNode[] }> {
  return units.map((u) => ({ programme: u, batches: u.children ?? [] }));
}

export function AddPlayersModal({
  orgId, canBulk, onClose, onAdded,
}: {
  orgId: string;
  /** Whether this plan may add more than one person at a time. */
  canBulk: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  // The unit tree is itself behind multi_campus, so on a plan without it this
  // 403s rather than coming back empty. An empty picker is the right outcome
  // either way - what differs is what may honestly be said underneath it.
  const { data: units = [], error: unitsError } = useApi<UnitNode[]>(`/organizations/${orgId}/units`);
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const groups = useMemo(() => flatten(units), [units]);
  const errors = useMemo(() => rows.map(rowError), [rows]);
  const ready = errors.every((e) => e === null);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  // The unit is carried as `type:name` because the server takes NAMES, not ids -
  // the same shape the spreadsheet importer takes, so both paths meet the same
  // validator. Batch is the more specific placement and is sent as such.
  const payload = (r: Row) => {
    const sep = r.unit.indexOf(':');
    const type = sep < 0 ? '' : r.unit.slice(0, sep);
    const unitName = sep < 0 ? '' : r.unit.slice(sep + 1);
    return {
      name: r.name.trim(),
      email: r.email.trim() || null,
      phone: r.phone.trim() || null,
      member_code: r.member_code.trim() || null,
      ...(unitName ? (type === 'batch' ? { batch: unitName } : { programme: unitName }) : {}),
    };
  };

  const submit = async () => {
    setAttempted(true);
    if (!ready) return;
    setBusy(true);
    try {
      if (rows.length === 1) {
        // Never gated, and it answers with the one login it may have just made.
        const res = await api<{ name: string | null; credential: Credential | null }>(
          'POST', `/organizations/${orgId}/people`, payload(rows[0]),
        );
        setOutcome({
          total: 1, added: 1, skipped: [],
          credentials: res.credential ? [res.credential] : [],
        });
      } else {
        const res = await api<Report>('POST', `/organizations/${orgId}/people/import`, {
          rows: rows.map(payload),
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
    const { added, total, skipped, credentials } = outcome;
    return (
      <Modal title={added === 1 ? 'Player added' : `${added} players added`} onClose={onClose} size="3xl" dismissible={false}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {added} of {total} {total === 1 ? 'person is' : 'people are'} now on the roll. Anyone new starts{' '}
            <strong>awaiting verification</strong>.
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
              onClick={() => { setOutcome(null); setRows([blankRow()]); setAttempted(false); }}
            >
              Add more
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  const cols = 'sm:grid-cols-[1.4fr_1.6fr_1fr_0.9fr_1.3fr_auto]';

  return (
    <Modal
      title={rows.length === 1 ? 'Add a player' : `Add ${rows.length} players`}
      onClose={onClose}
      size="4xl"
      dismissible={!busy}
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Everyone added starts as <strong>awaiting verification</strong>. Anyone already on Sportagon with
          this phone number or email is matched to their existing account rather than given a second one.
        </p>

        <div className={`hidden gap-2 px-1 font-mono text-[9px] uppercase tracking-[0.13em] text-slate-500 sm:grid ${cols}`}>
          <span>Name *</span>
          <span>Email</span>
          <span>Phone</span>
          <span>Roll no.</span>
          <span>Programme</span>
          <span className="w-7" />
        </div>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800/50">
              <div className={`grid gap-2 ${cols}`}>
                <Input placeholder="Full name" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
                <Input placeholder="Email" value={r.email} onChange={(e) => set(i, { email: e.target.value })} />
                <Input placeholder="Phone" value={r.phone} onChange={(e) => set(i, { phone: e.target.value })} />
                <Input placeholder="Roll no." value={r.member_code} onChange={(e) => set(i, { member_code: e.target.value })} />
                <Select value={r.unit} onChange={(e) => set(i, { unit: e.target.value })}>
                  <option value="">Unassigned</option>
                  {groups.map((g) => (
                    <optgroup key={g.programme.id} label={g.programme.name}>
                      <option value={`programme:${g.programme.name}`}>{g.programme.name}</option>
                      {g.batches.map((b) => (
                        <option key={b.id} value={`batch:${b.name}`}>{b.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <button
                  type="button"
                  aria-label="Remove this person"
                  disabled={rows.length === 1}
                  onClick={() => remove(i)}
                  className="flex h-9 w-7 items-center justify-center self-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:invisible dark:hover:bg-slate-700 dark:hover:text-slate-200"
                >
                  <X size={15} />
                </button>
              </div>
              {r.phone.trim() ? <PhoneLookupNotice phone={r.phone} /> : null}
              {attempted && errors[i] && (
                <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{errors[i]}</p>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={!canBulk} onClick={() => setRows((rs) => [...rs, blankRow()])}>
            <Plus size={14} /> Add another person
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
            No programmes or batches exist yet — add them under Structure and people can be placed as they are added.
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {rows.length} {rows.length === 1 ? 'person' : 'people'}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (attempted && !ready)}>
            {busy ? 'Adding…' : rows.length === 1 ? 'Add player' : `Add ${rows.length} players`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
