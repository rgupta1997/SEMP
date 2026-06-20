import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Button, Card, Checkbox, Pills, Spinner, toast } from './ui';

interface Enrollment { id: string; status: string; championship_id: string; championships?: { id: string; name: string } | null }

const CHOOSE_LATER = '';

// One selectable championship: a checkbox + (when checked) an OPTIONAL discipline
// picker scoped to the team's sport, excluding draws the org has already taken.
// Picking a discipline is not required — a team can enter now and choose later.
function EnrollmentRow({ enrollment, team, orgTeams, checked, drawId, onToggle, onDraw }: {
  enrollment: Enrollment; team: any; orgTeams: any[]; checked: boolean; drawId: string;
  onToggle: (v: boolean) => void; onDraw: (id: string) => void;
}) {
  const eventId = enrollment.championship_id;
  const { data: draws = [], isLoading } = useApi<any[]>(checked ? `/championships/${eventId}/draws` : null);

  const taken = useMemo(
    () => new Set(
      orgTeams
        .flatMap((t: any) => (t.team_entries ?? []) as any[])
        .filter((e) => e.championship_id === eventId && e.team_id !== team.id)
        .map((e) => e.tournament_discipline_id)
        .filter(Boolean),
    ),
    [orgTeams, eventId, team.id],
  );
  const sportDraws = useMemo(
    () => draws.filter((d) => d.tournament_sports?.sport_id === team.sport_id && !taken.has(d.id)),
    [draws, team.sport_id, taken],
  );

  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-800">
      <label className="flex cursor-pointer items-center gap-3">
        <Checkbox checked={checked} onChange={onToggle} />
        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{enrollment.championships?.name ?? 'Championship'}</span>
      </label>
      {checked && (
        <div className="mt-2 pl-7">
          {isLoading ? <Spinner /> : (
            <>
              <Pills
                ariaLabel="Discipline"
                value={drawId}
                onChange={onDraw}
                options={[
                  { value: CHOOSE_LATER, label: 'Choose later' },
                  ...sportDraws.map((d) => ({
                    value: d.id,
                    label: (
                      <>
                        {d.tournament_sports?.tournaments?.name ? `${d.tournament_sports.tournaments.name} · ` : ''}
                        {d.disciplines?.name ?? team.sports?.name}
                        <span className="ml-1 font-normal opacity-70">({d.entry_type})</span>
                      </>
                    ),
                  })),
                ]}
              />
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                {sportDraws.length === 0
                  ? 'No disciplines set up here yet — enter now and pick one once the organiser adds them.'
                  : 'Optional — you can pick or change the discipline after entering.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Enter an existing roster into one or more approved championships at once. Rendered
// inline (a panel, not a popup). The same roster competes in every one. A discipline
// draw is optional per championship — the team can be entered straight away and
// assigned its discipline later.
export function EnterChampionshipsPanel({ team, onClose }: { team: any; onClose: () => void }) {
  const qc = useQueryClient();
  // Enrollments must be scoped to THIS team's organization — a user may own several
  // orgs, and an enrollment from another org can't be used here.
  const { data: enrollments = [] } = useApi<Enrollment[]>(`/me/enrollments?organization_id=${team.organization_id}`);
  const { data: orgTeams = [] } = useApi<any[]>(`/teams?organization_id=${team.organization_id}`);
  const [sel, setSel] = useState<Record<string, string>>({}); // enrollmentId -> drawId ('' = choose later)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyIn = useMemo(
    () => new Set((team.team_entries ?? []).map((e: any) => e.championship_id)),
    [team.team_entries],
  );
  const approved = useMemo(
    () => enrollments.filter((e) => e.status === 'approved' && !alreadyIn.has(e.championship_id)),
    [enrollments, alreadyIn],
  );

  const toggle = (enrollmentId: string) =>
    setSel((s) => { const n = { ...s }; if (enrollmentId in n) delete n[enrollmentId]; else n[enrollmentId] = CHOOSE_LATER; return n; });
  const setDraw = (enrollmentId: string, draw: string) => setSel((s) => ({ ...s, [enrollmentId]: draw }));

  // Every checked championship is entered; an empty draw means "choose later" (null).
  const entries = Object.entries(sel).map(([championship_organization_id, tournament_discipline_id]) => ({
    championship_organization_id,
    tournament_discipline_id: tournament_discipline_id || null,
  }));

  const submit = async () => {
    setError(null);
    if (entries.length === 0) { setError('Select at least one championship to enter'); return; }
    setBusy(true);
    try {
      await api('POST', `/teams/${team.id}/entries`, { entries });
      await qc.invalidateQueries();
      toast.success(`Entered ${entries.length} championship${entries.length === 1 ? '' : 's'}`, 'Pick each discipline from the team page when ready.');
      onClose();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Card className="mb-4 p-5 ring-1 ring-brand-200 dark:ring-brand-500/30">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">Enter {team.name ? `“${team.name}” ` : ''}into championship(s)</h3>
        <button onClick={onClose} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancel</button>
      </div>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Pick the approved championships to enter this team into. Choosing a discipline is optional — you can set it later. The same roster competes in every one.</p>
      {approved.length === 0 ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          No approved championships left to enter — either this team’s organization has none approved yet (apply via “Browse championships”) or this team is already in all of them.
        </p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-auto">
          {approved.map((e) => (
            <EnrollmentRow key={e.id} enrollment={e} team={team} orgTeams={orgTeams}
              checked={e.id in sel} drawId={sel[e.id] ?? ''}
              onToggle={() => toggle(e.id)} onDraw={(d) => setDraw(e.id, d)} />
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button disabled={entries.length === 0 || busy} onClick={submit}>{busy ? 'Entering…' : `Enter ${entries.length || ''}`}</Button>
      </div>
    </Card>
  );
}
