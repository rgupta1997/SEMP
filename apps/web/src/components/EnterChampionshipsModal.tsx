import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Button, Checkbox, Modal, Select, Spinner, toast } from './ui';

interface Enrollment { id: string; status: string; championship_id: string; championships?: { id: string; name: string } | null }

// One selectable championship: a checkbox + (when checked) a discipline picker
// scoped to the team's sport and excluding draws the org has already taken.
function EnrollmentRow({ enrollment, team, orgTeams, checked, drawId, onToggle, onDraw }: {
  enrollment: Enrollment; team: any; orgTeams: any[]; checked: boolean; drawId: string;
  onToggle: (v: boolean) => void; onDraw: (id: string) => void;
}) {
  const eventId = enrollment.championship_id;
  const { data: draws = [], isLoading } = useApi<any[]>(`/championships/${eventId}/draws`);

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

  // Default to the first available draw once selected, so a checked row is submittable.
  useEffect(() => {
    if (checked && !drawId && sportDraws[0]) onDraw(sportDraws[0].id);
  }, [checked, drawId, sportDraws, onDraw]);

  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-800">
      <label className="flex cursor-pointer items-center gap-3">
        <Checkbox checked={checked} onChange={onToggle} />
        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{enrollment.championships?.name ?? 'Championship'}</span>
      </label>
      {checked && (
        <div className="mt-2 pl-7">
          {isLoading ? <Spinner /> : sportDraws.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No available {team.sports?.name ?? ''} disciplines here — the organiser must add a draw.</p>
          ) : (
            <Select value={drawId || sportDraws[0]?.id || ''} onChange={(e) => onDraw(e.target.value)}>
              {sportDraws.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.tournament_sports?.tournaments?.name ? `${d.tournament_sports.tournaments.name} · ` : ''}{d.disciplines?.name ?? team.sports?.name} ({d.entry_type})
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
    </div>
  );
}

// Enter an existing roster into one or more approved championships at once. Each
// selection needs a discipline draw matching the team's sport.
export function EnterChampionshipsModal({ team, onClose }: { team: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: enrollments = [] } = useApi<Enrollment[]>('/me/enrollments');
  const { data: orgTeams = [] } = useApi<any[]>(`/teams?organization_id=${team.organization_id}`);
  const [sel, setSel] = useState<Record<string, string>>({}); // enrollmentId -> drawId
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
    setSel((s) => { const n = { ...s }; if (enrollmentId in n) delete n[enrollmentId]; else n[enrollmentId] = ''; return n; });
  const setDraw = (enrollmentId: string, draw: string) => setSel((s) => ({ ...s, [enrollmentId]: draw }));

  const entries = Object.entries(sel)
    .filter(([, draw]) => draw)
    .map(([championship_organization_id, tournament_discipline_id]) => ({ championship_organization_id, tournament_discipline_id }));

  const submit = async () => {
    setError(null);
    if (entries.length === 0) { setError('Select at least one championship and discipline'); return; }
    setBusy(true);
    try {
      await api('POST', `/teams/${team.id}/entries`, { entries });
      await qc.invalidateQueries();
      toast.success(`Entered ${entries.length} championship${entries.length === 1 ? '' : 's'}`);
      onClose();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Enter championship(s)" onClose={onClose} wide>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Pick the approved championships to enter this team into, and a discipline draw for each. The same roster competes in every one.</p>
      {approved.length === 0 ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          No approved championships left to enter — either your organization has none approved yet (apply via “Browse championships”) or this team is already in all of them.
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
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={entries.length === 0 || busy} onClick={submit}>{busy ? 'Entering…' : `Enter ${entries.length || ''}`}</Button>
      </div>
    </Modal>
  );
}
