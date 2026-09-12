import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronDown } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { suggestShort, titleCase } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { api } from '../../lib/api';
import { useFilterBar, usePageFilters } from '../../lib/filters';
import { useApi, useApiMutation, useTableControls } from '../../lib/hooks';
import { pluralise } from '@semp/shared';
import { useOrgUnits, unitPath } from '../../lib/units';
import { Badge, Button, Card, Checkbox, cn, EmptyState, Field, Input, ListToolbar, Modal, PageHeader, Pagination, SearchableSelect, SearchInput, Select, Skeleton, SortDirButton, Spinner, StatusBadge, Tabs, INSET} from '../../components/ui';

// Teams created by a bulk wizard action, kept only for this browser session so a
// "New" badge can tell them apart from teams the wizard reused (see
// BulkCreateTeamsModal) - not persisted server-side, since it's a viewing aid for
// whoever just ran the wizard, not a fact about the team.
function newTeamIdsKey(orgId: string) { return `bulk-new-team-ids:${orgId}`; }
function readNewTeamIds(orgId: string): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(newTeamIdsKey(orgId)) ?? '[]')); } catch { return new Set(); }
}


// A roster can be entered into several championships; these read its team_entries.
function teamEntries(team: any): any[] { return team.team_entries ?? []; }
function teamChampIds(team: any): string[] { return teamEntries(team).map((e: any) => e.championship_id); }
function teamChampNames(team: any): string { return teamEntries(team).map((e: any) => e.championships?.name).filter(Boolean).join(' '); }
function teamTournaments(team: any): { id: string; name: string }[] {
  const map = new Map<string, string>();
  for (const e of teamEntries(team)) {
    const t = e.tournament_disciplines?.tournament_sports?.tournaments;
    if (t?.id && t?.name) map.set(t.id, t.name);
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

function drawLabel(d: any): string {
  const tournament = d.tournament_sports?.tournaments?.name;
  const sport = d.tournament_sports?.sports?.name ?? 'Sport';
  const disc = d.disciplines?.name;
  const sportDisc = disc ? `${sport} · ${disc}` : sport;
  return tournament ? `${tournament} · ${sportDisc}` : sportDisc;
}

// Discipline meta shown in team-entry pickers: squad range + (effective) format.
function squadText(d: any): string {
  const min = d.squad_min ?? d.disciplines?.squad_min ?? 1;
  const max = d.squad_max ?? d.disciplines?.squad_max ?? 15;
  return `squad ${min}–${max}`;
}
function drawFormatName(d: any, formats: any[]): string | null {
  const id = d.format_id ?? d.tournament_sports?.format_id;
  return formats.find((f) => f.id === id)?.name ?? null;
}

// Enter one team for every selected discipline in a single action.
function BulkCreateTeamsModal({ approved, organization, kind, defaultEnrollmentId, onClose, markNewTeams }:
  {
    approved: any[];
    organization: any;
    /** Decided by the tab this was opened from, never asked. */
    kind: 'organization' | 'campus' | 'department';
    defaultEnrollmentId?: string;
    onClose: () => void;
    /** Flags freshly-created team ids so the list can badge them "New". */
    markNewTeams?: (ids: string[]) => void;
  }) {
  const [enrollmentId, setEnrollmentId] = useState(defaultEnrollmentId ?? approved[0]?.id ?? '');
  const enrollment = approved.find((e) => e.id === enrollmentId);
  const eventId = enrollment?.championship_id;
  const { data: draws = [], isLoading } = useApi<any[]>(eventId ? `/championships/${eventId}/draws` : null);
  const { data: formats = [] } = useApi<any[]>('/tournament-formats');
  const { data: existing = [] } = useApi<any[]>(organization?.id ? `/teams?organization_id=${organization.id}` : null);

  // Don't offer draws this CONTINGENT has already entered for this championship.
  //
  // Keyed on the entry's campus as well as the championship. Keyed on the
  // championship alone - as it read before intra events - the moment Bangalore
  // entered Cricket, Cricket disappeared from Mumbai's picker too, because both
  // entries belong to the same organisation.
  // Which unit these squads play for. On the Organisation tab there is none; on a
  // campus or batch tab the tab has fixed the KIND, so all that remains is WHICH -
  // and when the organisation has only one, not even that.
  const { units: campusTree, labels: unitLabels, flat: allUnits } = useOrgUnits(organization?.id);
  const pickable = useMemo(
    () => (kind === 'campus' ? allUnits.filter((u) => u.type === 'campus')
      : kind === 'department' ? allUnits.filter((u) => u.type === 'department')
        : []),
    [allUnits, kind],
  );
  const [bulkUnitId, setBulkUnitId] = useState('');
  useEffect(() => {
    if (kind !== 'organization' && pickable.length === 1) setBulkUnitId(pickable[0].id);
  }, [kind, pickable.length]);

  const unitNoun = kind === 'campus' ? unitLabels.campus : unitLabels.department;
  const entryUnitId = kind === 'organization' ? null : (bulkUnitId || null);
  const takenDrawIds = useMemo(
    () => new Set(
      existing
        .flatMap((t: any) => (t.team_entries ?? []) as any[])
        .filter((e) => e.championship_id === eventId && (e.org_unit_id ?? null) === entryUnitId)
        .map((e) => e.tournament_discipline_id)
        .filter(Boolean),
    ),
    [existing, eventId, entryUnitId],
  );
  const available = useMemo(() => draws.filter((d) => !takenDrawIds.has(d.id)), [draws, takenDrawIds]);
  const tournamentNames = useMemo(
    () => [...new Set(draws.map((d) => d.tournament_sports?.tournaments?.name).filter(Boolean))],
    [draws],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // discipline id -> id of an existing team to enter instead of creating a new one.
  // Absent (or '') means "create a new team", same as before this feature existed.
  const [reuseTeam, setReuseTeam] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // A pre-existing roster this discipline COULD reuse instead of a fresh team:
  // right sport, right unit (a campus squad can't suddenly play for another
  // campus), and not already carrying an entry into THIS championship - a team
  // enters a championship once, never twice under two disciplines.
  const reuseCandidates = useMemo(() => {
    const takenElsewhereInBatch = new Set(
      Object.entries(reuseTeam).filter(([drawId, teamId]) => teamId && selected.has(drawId)).map(([, teamId]) => teamId),
    );
    const byDraw = new Map<string, any[]>();
    for (const d of available) {
      const sportId = d.tournament_sports?.sport_id;
      const picked = reuseTeam[d.id];
      const options = existing.filter((t: any) =>
        t.sport_id === sportId
        && (t.org_unit_id ?? null) === entryUnitId
        && !teamChampIds(t).includes(eventId)
        && (t.id === picked || !takenElsewhereInBatch.has(t.id)));
      byDraw.set(d.id, options);
    }
    return byDraw;
  }, [available, existing, entryUnitId, eventId, reuseTeam, selected]);
  // A campus team is named after the CAMPUS, not the institution. Every campus in an
  // intra championship shares one organisation, so "NIT Cricket" twice tells nobody
  // which side is which - on the team list, the fixture card or the scoreboard.
  // A campus squad is named after the CAMPUS. Every squad in an internal
  // championship shares one organisation, so the institution's name distinguishes
  // nothing on a team list, a fixture card or a scoreboard.
  const short = (entryUnitId ? pickable.find((u) => u.id === entryUnitId)?.name : null)
    || organization?.short_name || organization?.name || 'Team';
  // Every team here is named automatically: "<who> Sport Discipline". `short` is
  // always in front, campus/department tab or not - an open championship holds
  // OTHER organisations' entries too, and "Cricket Whole sport" from two
  // different institutions would be exactly as indistinguishable on the bracket,
  // the standings and the scoreboard as two campuses' squads sharing a name is
  // on an internal one. Nothing asks for a name here - whoever opens the team
  // afterwards to add its real players can rename it there, same as any other team.
  const autoName = (d: any) => {
    const sport = d.tournament_sports?.sports?.name ?? 'Team';
    const disc = d.disciplines?.name;
    const base = disc ? `${sport} ${disc}` : sport;
    return `${short} ${base}`.replace(/\s+/g, ' ').trim();
  };

  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allChecked = available.length > 0 && selected.size === available.length;
  const reuseCount = [...selected].filter((id) => reuseTeam[id]).length;

  // Two different requests, one per discipline: a fresh team is a single batched
  // POST (as before), but entering an EXISTING team is the same one-team-at-a-time
  // route its own page uses to enter a championship - it already carries all the
  // "may this team actually play here" rules (sport, unit, one entry per
  // championship), and this wizard has no reason to duplicate them.
  const submit = async () => {
    setError(null);
    if (!enrollment || selected.size === 0) { setError('Select at least one discipline'); return; }
    if (kind !== 'organization' && !bulkUnitId) { setError(`Pick which ${unitNoun.toLowerCase()} these squads play for`); return; }
    const rows = available.filter((d) => selected.has(d.id));
    const freshRows = rows.filter((d) => !reuseTeam[d.id]);
    const reuseRows = rows.filter((d) => reuseTeam[d.id]);

    const teams = freshRows.map((d) => {
      const name = autoName(d);
      return {
        championship_id: enrollment.championship_id,
        organization_id: organization.id,
        championship_organization_id: enrollment.id,
        org_unit_id: entryUnitId,
        sport_id: d.tournament_sports.sport_id,
        tournament_discipline_id: d.id,
        name,
        // The API requires an abbreviation too (the scoreboard short name); this
        // form has no field for one, so it's derived from the same auto name -
        // it's just an initialism, not something worth a decision of its own,
        // and it can be edited from the team's own page same as the name can.
        short_name: suggestShort(name),
      };
    });

    setSubmitting(true);
    try {
      const created: any[] = teams.length
        ? (await api<{ created: number; teams: any[] }>('POST', '/teams/bulk', { teams })).teams ?? []
        : [];

      const entered = await Promise.allSettled(reuseRows.map((d) => api('POST', `/teams/${reuseTeam[d.id]}/entries`, {
        entries: [{ championship_organization_id: enrollment.id, tournament_discipline_id: d.id }],
      })));
      const failed = entered
        .map((r, i) => ({ r, d: reuseRows[i] }))
        .filter((x) => x.r.status === 'rejected') as { r: PromiseRejectedResult; d: any }[];

      await qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string'
          && (q.queryKey[0] === '/me/teams' || q.queryKey[0].startsWith('/teams')),
      });

      if (created.length) markNewTeams?.(created.map((t) => t.id));

      if (failed.length) {
        setError(`${failed.length} existing team${failed.length === 1 ? '' : 's'} could not be entered: `
          + failed.map((f) => (f.r.reason as any)?.message ?? autoName(f.d)).join('; '));
        // Only the failed rows stay selected/pending - the rest of the batch went
        // through and shouldn't have to be redone.
        setSelected(new Set(failed.map((f) => f.d.id)));
        return;
      }

      // Always back to the list, never to one team's page - a wizard whose whole
      // point is entering several teams at once has no single "the" result to jump
      // to, even when this particular run only acted on one. The list is also
      // where the "New" badge actually shows what this action just made.
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Could not enter these teams');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Enter multiple teams"
      onClose={onClose}
      wide
      footer={(
        <>
          {error && <p className="mb-2.5 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="t-meta">
              {selected.size} selected{reuseCount > 0 ? ` · ${reuseCount} existing, ${selected.size - reuseCount} new` : ''}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button disabled={selected.size === 0 || submitting} onClick={submit}>
                {submitting ? 'Saving…'
                  : reuseCount === 0 ? `Create ${selected.size || ''} team${selected.size === 1 ? '' : 's'}`
                    : reuseCount === selected.size ? `Enter ${selected.size} team${selected.size === 1 ? '' : 's'}`
                      : `Create ${selected.size - reuseCount} & enter ${reuseCount}`}
              </Button>
            </div>
          </div>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Championship">
            <Select value={enrollmentId} onChange={(e) => { setEnrollmentId(e.target.value); setSelected(new Set()); setReuseTeam({}); }}>
              {/* `label` is the server's own "Championship · Campus", so an
                  organisation holding one entry per campus does not render the same
                  championship name three times with nothing to choose between them. */}
              {approved.map((e) => <option key={e.id} value={e.id}>{e.championships?.name ?? 'Championship'}</option>)}
            </Select>
          </Field>

          {/* WHICH one - never which kind. Hidden entirely when there is one possible
              answer, which is preselected above. */}
          {kind !== 'organization' && pickable.length > 1 && (
            <Field label={unitNoun} hint={`These squads all play for the ${unitNoun.toLowerCase()} you choose.`}>
              <Select value={bulkUnitId} onChange={(e) => { setBulkUnitId(e.target.value); setReuseTeam({}); }}>
                <option value="">- select a {unitNoun.toLowerCase()} -</option>
                {kind === 'campus'
                  ? pickable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)
                  : campusTree.map((c) => (
                    <optgroup key={c.id} label={c.name}>
                      {(c.children ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </optgroup>
                  ))}
              </Select>
            </Field>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="t-eyebrow">Disciplines</span>
            <div className="flex items-center gap-3">
              {eventId && tournamentNames.length > 0 && (
                <span className="t-meta truncate">
                  Season{tournamentNames.length > 1 ? 's' : ''}:{' '}
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{tournamentNames.join(', ')}</span>
                </span>
              )}
              {available.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(allChecked ? new Set() : new Set(available.map((d) => d.id)))}
                  className="shrink-0 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
                >
                  {allChecked ? 'Clear all' : `Select all (${available.length})`}
                </button>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="grid place-items-center py-8"><Spinner /></div>
          ) : available.length === 0 ? (
            <p className={`${INSET} bg-slate-50 px-4 py-6 text-center text-sm text-slate-400 dark:bg-slate-800/60 dark:text-slate-500`}>
              {draws.length === 0 ? 'No disciplines configured for this championship yet. The organiser must add draws in Setup before teams can be entered.' : 'You have already entered every available discipline.'}
            </p>
          ) : (
            <div className={`max-h-80 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800 ${INSET}`}>
              {available.map((d) => {
                const candidates = reuseCandidates.get(d.id) ?? [];
                const isSelected = selected.has(d.id);
                const reused = reuseTeam[d.id];
                const reusedName = reused ? candidates.find((t: any) => t.id === reused)?.name : null;
                return (
                  <div
                    key={d.id}
                    className={`flex items-center gap-3 px-3.5 py-3 transition-colors ${isSelected ? 'bg-brand-50/60 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <Checkbox checked={isSelected} onChange={() => toggle(d.id)} />
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-base dark:bg-brand-500/10">
                        {d.tournament_sports?.sports?.icon ?? '◇'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{drawLabel(d)}</div>
                        <div className="truncate t-meta">
                          {d.entry_type} · {squadText(d)}{drawFormatName(d, formats) ? ` · ${drawFormatName(d, formats)}` : ''}
                          {reusedName ? (
                            <>
                              {' · '}
                              <span className="font-semibold text-brand-600 dark:text-brand-300">Existing:</span> {reusedName}
                            </>
                          ) : ` · ${autoName(d)}`}
                        </div>
                      </div>
                    </label>
                    {/* Only when this discipline is actually in the batch, and only
                        when there's a pre-existing roster of the right sport and unit
                        to reuse - most disciplines have none, and the row stays
                        exactly as it was before this existed.

                        A bespoke control, not the shared `Select` - that one is
                        styled as a full form field (solid fill, heavy border), which
                        reads as a prominent button fighting the row's own text for
                        attention. This is meant to look like a quiet, optional
                        toggle: dashed and ghost by default, only picking up real
                        color once a team is actually chosen. */}
                    {isSelected && candidates.length > 0 && (
                      <div className="relative shrink-0">
                        <select
                          value={reused ?? ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setReuseTeam((m) => {
                            const n = { ...m };
                            if (e.target.value) n[d.id] = e.target.value; else delete n[d.id];
                            return n;
                          })}
                          title="Enter an existing team instead of creating a new one"
                          className={cn(
                            'w-36 appearance-none rounded-full border py-1.5 pl-3 pr-7 text-xs font-medium transition-colors focus:outline-none focus:ring-2',
                            reused
                              ? 'border-brand-300 bg-brand-50 text-brand-700 focus:ring-brand-400/30 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300'
                              : 'border-dashed border-slate-300 bg-transparent text-slate-500 hover:border-slate-400 focus:ring-slate-400/20 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600',
                          )}
                        >
                          <option value="">New team</option>
                          {candidates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <ChevronDown
                          size={12}
                          aria-hidden
                          className={cn(
                            'pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2',
                            reused ? 'text-brand-500 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500',
                          )}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Create a team as a standalone organization asset - just a name and sport. Rendered
// inline (not a popup) so it sits right in the Teams list. It's entered into a
// championship & discipline later from the team page.
// A team created here has no championship entry yet, so nothing else can tell us
// which campus it plays for - it has to be asked. Skipping the question was worse
// than it looked: the team silently became an ORGANISATION team, and an organisation
// team can never be entered into an internal championship. The mistake only surfaced
// later, on a screen that said "no championships left to enter" with no reason given.
function InlineCreateTeam({ institutionId, kind, onClose }: {
  institutionId: string;
  /** Decided by the tab this was opened from, never asked. */
  kind: 'organization' | 'campus' | 'department';
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { data: sports = [] } = useApi<any[]>('/sports');
  const [name, setName] = useState('');
  // Entered, never derived. A slice of the name gives "B.Tech 2023" and "B.Tech
  // 2024" the same three letters, and on a scoreboard the abbreviation IS the side -
  // two rows reading BTE is a result nobody can tell apart. Whoever creates the
  // squad knows theirs are BT23 and BT24.
  //
  // `touched` is what makes the suggestion a suggestion: it follows the name until
  // the moment somebody types here, and then it is theirs and stops moving.
  const [shortName, setShortName] = useState('');
  const [shortTouched, setShortTouched] = useState(false);
  const [sportId, setSportId] = useState('');
  const [playsFor, setPlaysFor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { flat: allUnits, units: campusTree, labels } = useOrgUnits(institutionId);

  // Only the units of THIS kind. The tab has already decided whether this is a
  // campus squad or a batch squad, so offering the other kind - or "the whole
  // organisation" - would be offering a way to contradict the tab you are standing in.
  const units = useMemo(
    () => (kind === 'campus' ? allUnits.filter((u) => u.type === 'campus')
      : kind === 'department' ? allUnits.filter((u) => u.type === 'department')
        : []),
    [allUnits, kind],
  );
  const noun = kind === 'campus' ? labels.campus : labels.department;

  // One possible answer is not a question: a lone campus is chosen for you.
  useEffect(() => {
    if (kind !== 'organization' && units.length === 1) setPlaysFor(units[0].id);
  }, [kind, units.length]);

  const create = useApiMutation(
    (body: any) => api('POST', '/teams', body),
    ['/me/teams', `/teams?organization_id=${institutionId}`],
    (team: any) => navigate(`/organizations/${institutionId}/teams/${team.id}`),
  );

  const submit = () => {
    setError(null);
    if (!name.trim()) { setError('Team name is required'); return; }
    if (shortName.trim().length < 2) { setError('A short name of at least 2 characters is required'); return; }
    if (!sportId) { setError('Pick a sport'); return; }
    if (kind !== 'organization' && !playsFor) { setError(`Pick which ${noun.toLowerCase()} this squad plays for`); return; }
    create.mutate({
      name: name.trim(),
      short_name: shortName.trim().toUpperCase(),
      sport_id: sportId,
      organization_id: institutionId,
      // Null for an organisation squad, and the tab guarantees it.
      org_unit_id: kind === 'organization' ? null : playsFor,
    }, { onError: (e: any) => setError(e.message) });
  };

  return (
    <Card className="mb-4 p-5 ring-1 ring-brand-200 dark:ring-brand-500/30">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">
          {kind === 'organization' ? 'Create a team' : `Create a ${noun.toLowerCase()} squad`}
        </h3>
        <button onClick={onClose} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancel</button>
      </div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        {kind === 'organization'
          ? 'Add a team for your organization, then enter it into a championship & pick a discipline when you’re ready.'
          : `Add a ${noun.toLowerCase()} squad, then enter it into one of this organisation's internal championships when you’re ready.`}
      </p>
      {/* Top-aligned, not bottom-aligned: the Short name column carries an extra hint
          line under its input that the other columns don't have, and `items-end`
          would push everyone's INPUT down to keep BOTTOMS level - which is what was
          making Team name and Sport visibly sag below Short name. Top-aligning keeps
          every label (and so every input) on the same line regardless of what any
          one column has underneath it. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <label className="block flex-1">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Team name</span>
          <Input
            value={name}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              // A head start, not an answer: it tracks the name until somebody
              // types their own, then stops.
              if (!shortTouched) setShortName(suggestShort(e.target.value));
            }}
            placeholder="e.g. VJTI Titans"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
        </label>
        <label className="block sm:w-40">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Short name <span className="text-rose-500">*</span>
          </span>
          <Input
            value={shortName}
            onChange={(e) => { setShortTouched(true); setShortName(e.target.value.toUpperCase().slice(0, 12)); }}
            placeholder="VJTI"
            maxLength={12}
            className="font-mono uppercase tracking-wide"
            aria-describedby="short-name-hint"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          <span id="short-name-hint" className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
            Shown on scoreboards and phones
          </span>
        </label>
        <label className="block sm:w-56">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Sport</span>
          <SearchableSelect
            value={sportId}
            onChange={setSportId}
            options={sports.map((s) => ({ id: s.id, label: s.name, icon: s.icon }))}
            placeholder="- select a sport -"
            searchPlaceholder="Search sports…"
            emptyLabel="No sports match"
            className="w-full"
          />
        </label>
        {/* Which one - never which KIND. The tab answered that, and a picker with a
            single option is a question not worth putting on the screen, so it is
            preselected above. Batches are grouped by campus because two campuses can
            each have a "2026". */}
        {kind !== 'organization' && units.length > 1 && (
          <label className="block sm:w-60">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{noun}</span>
            <Select value={playsFor} onChange={(e) => setPlaysFor(e.target.value)}>
              <option value="">- select a {noun.toLowerCase()} -</option>
              {kind === 'campus'
                ? units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)
                : campusTree.map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    {(c.children ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </optgroup>
                ))}
            </Select>
          </label>
        )}
        <div className="block">
          {/* Matches the real labels' height so the button lines up with the inputs,
              not with the labels above them. */}
          <span aria-hidden="true" className="invisible mb-1.5 block text-xs font-semibold">Create</span>
          <Button disabled={!name.trim() || !sportId || create.isPending} onClick={submit}>{create.isPending ? 'Creating…' : 'Create team'}</Button>
        </div>
      </div>
      <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">
        {kind === 'organization'
          ? `This squad represents the whole institution and plays other institutions. It cannot enter a championship contested between your own ${pluralise(labels.campus).toLowerCase()}.`
          : `This squad represents one ${noun.toLowerCase()}${playsFor ? ` — ${units.find((u) => u.id === playsFor)?.name ?? ''}` : ''}. It plays championships contested between ${pluralise(noun).toLowerCase()}, and only people who belong to it can be picked.`}
      </p>
      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </Card>
  );
}

export function TeamsPage() {
  const { ctx } = useAuth();
  const { can } = usePermissions();
  const canManage = can('team.manage'); // POC only; captains are read-only
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { orgId } = useParams();
  const institutionId = orgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  // Organization staff see all their organization's teams; a captain with no
  // organization still sees the teams they captain (via /me/teams).
  // The org being viewed - NOT ctx.organization, which is the user's primary org. A POC
  // managing several orgs (IIMB A/B/C) must enter teams against the org in the URL, or the
  // entry modal reads the wrong org's existing teams (and hides every discipline as "taken").
  const { data: viewedOrg } = useApi<any>(institutionId ? `/organizations/${institutionId}` : null);
  const { data: instTeams = [], isLoading: instLoading } = useApi<any[]>(institutionId ? `/teams?organization_id=${institutionId}` : null);
  const { data: myTeams = [], isLoading: myLoading } = useApi<any[]>(institutionId ? null : '/me/teams');
  const teams = institutionId
    ? instTeams
    : myTeams.filter((t) => t.membership_role === 'captain' || t.membership_role === 'vice_captain');
  const isLoading = institutionId ? instLoading : myLoading;

  // Teams the "Enter multiple" wizard just created THIS session, so its card can
  // say "New" - the only way, short of opening it, to tell a roster the wizard
  // made from one it reused. Session-only and client-side: it's a viewing aid for
  // whoever just ran the wizard, not a fact worth persisting about the team.
  const [newTeamIds, setNewTeamIds] = useState<Set<string>>(() => readNewTeamIds(institutionId));
  const markNewTeams = (ids: string[]) => {
    if (ids.length === 0) return;
    setNewTeamIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      try { sessionStorage.setItem(newTeamIdsKey(institutionId), JSON.stringify([...next])); } catch { /* private mode etc. */ }
      return next;
    });
  };
  // Enrollments scoped to THIS org (a user may run several) so "Enter" uses the right
  // approved enrollment - otherwise entering a team can pick another org's enrollment.
  // WHICH TAB. Declared here, above everything derived from it.
  //
  // It used to sit two hundred lines lower, and `approved` below reads it inside a
  // `.filter()` callback - which is why the type checker stayed silent: TypeScript
  // assumes a callback might run later, so it does not flag the temporal dead zone.
  // `.filter()` runs immediately, so the page threw "Cannot access 'playsFor'
  // before initialization" on first render.
  //
  // Organisation first: it is the kind that existed before internal championships,
  // and the one an institution that runs none will only ever have.
  const [playsFor, setPlaysFor] = useState<string>('organization');

  const { data: enrollments = [] } = useApi<any[]>(institutionId ? `/me/enrollments?organization_id=${institutionId}` : '/me/enrollments');
  // Approved entries this organisation holds. Internal championships are excluded:
  // their competitors are CAMPUS squads, built for one campus and entered from that
  // squad's own page. Offering them in an organisation-level bulk create would ask
  // this modal to decide which campus a batch of squads belongs to, which is not a
  // question it should be asking.
  // Championships this tab's squads can actually enter. An organisation squad plays
  // open championships; a campus squad plays campus-level ones; a batch squad plays
  // batch-level ones. Filtering by the tab means the picker never offers a
  // championship the server would then refuse the squad from.
  const approved = enrollments.filter((e) => e.status === 'approved'
    && (e.championships?.entry_level ?? 'organization') === playsFor);

  const { eventId, setEventId } = useFilterBar();
  const [tournamentFilter, setTournamentFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [status, setStatus] = useState('all');

  const activeEvent = approved.find((e) => e.championship_id === eventId);
  const defaultEnrollmentId = activeEvent?.id;
  const drawsEventId = eventId || approved[0]?.championship_id || null;
  const { data: eventDraws = [] } = useApi<any[]>(drawsEventId ? `/championships/${drawsEventId}/draws` : null);
  const { data: eventTournaments = [] } = useApi<any[]>(eventId ? `/tournaments?championship_id=${eventId}` : null);
  const canEnterTeams = approved.length > 0 && (!eventId || eventDraws.length > 0);

  const tournamentOptions = useMemo(() => {
    if (eventId) {
      return eventTournaments.map((t) => ({ id: t.id, name: t.name }));
    }
    const map = new Map<string, string>();
    for (const t of teams) for (const x of teamTournaments(t)) map.set(x.id, x.name);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [eventId, eventTournaments, teams]);

  // Sports narrow to the selected championship + tournament (cascading); published to header.
  const sportOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams) {
      if (eventId && !teamChampIds(t).includes(eventId)) continue;
      if (tournamentFilter !== 'all' && !teamTournaments(t).some((x) => x.id === tournamentFilter)) continue;
      if (t.sport_id) map.set(t.sport_id, t.sports?.name ?? 'Sport');
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [teams, eventId, tournamentFilter]);

  // `eventId` is shared, app-wide state - with no header dropdown on this tab to
  // show or clear it, a selection left over from another page (say, Events) must
  // not go on silently filtering this tab's teams. Drop it if it isn't one of
  // this tab's own championships; the deep-link effect below can still set a
  // fresh one straight after.
  useEffect(() => {
    if (eventId && !approved.some((e) => e.championship_id === eventId)) setEventId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, playsFor]);

  // Seed the shared championship filter from a deep link (?championship=…), e.g. "Manage teams".
  useEffect(() => {
    const ev = searchParams.get('championship');
    if (ev) setEventId(ev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Open the create-team panel straight from a deep link (?create=1), e.g. the
  // getting-started checklist's "Create a team" step.
  useEffect(() => {
    if (searchParams.get('create') === '1') setCreating(true);
  }, [searchParams]);

  // Reset the tournament drill-down when the header championship changes.
  useEffect(() => { setTournamentFilter('all'); }, [eventId]);

  // Register the shared Sport filter; read back the active sport. The championship
  // filter is deliberately not published here - this tab's teams are scoped to the
  // organisation, and a header dropdown for it read as an extra, unwanted control.
  const { sportId } = usePageFilters({
    sports: sportOptions.length ? sportOptions : undefined,
  });

  const { labels, units: campusTree } = useOrgUnits(institutionId);
  const statusOptions = useMemo(() => ['all', ...new Set(teams.map((t) => t.status).filter(Boolean))], [teams]);

  // WHO A TEAM PLAYS FOR is a different question from who owns it, and on this
  // screen it is the more useful one. Every team here belongs to the same
  // organisation, so once campuses and departments are in play the owner's name
  // distinguishes nothing - "NIT Cricket" three times over is unreadable.
  //
  // Three kinds are genuinely different things and must not be mixed up:
  //
  //   organisation - represents the whole institution against OTHER institutions
  //   campus       - represents one campus against the institution's other campuses
  //   department   - represents one department, inside a campus or across the org
  //
  // A campus squad can never play in an inter-organisation event and an
  // organisation squad can never play in an internal one, so a list that showed
  // them together with no distinction invited exactly the wrong team to be picked.
  /** Which of the three a team is. The tabs, and the card chip, both read this. */
  const kindOf = (t: any): 'organization' | 'campus' | 'department' =>
    (t?.org_units?.type === 'campus' ? 'campus' : t?.org_units?.type === 'department' ? 'department' : 'organization');

  const kindCounts = useMemo(() => ({
    organization: teams.filter((t) => kindOf(t) === 'organization').length,
    campus: teams.filter((t) => kindOf(t) === 'campus').length,
    department: teams.filter((t) => kindOf(t) === 'department').length,
  }), [teams]);

  // THREE tabs, one per kind of squad. They are not variations of one another:
  //
  //   Organisation - represents the whole institution against OTHER institutions
  //   Campuses     - represents one campus against this institution's other campuses
  //   Batches      - represents one batch against the other batches
  //
  // Each plays in a different kind of championship and draws from different people.
  // The tab is also what makes the create buttons below contextual: standing in the
  // Campuses tab, "Create team" already knows the squad is a campus squad, so it
  // never has to ask whether you meant a campus, a batch or the whole organisation.
  const kindTabs = useMemo(() => ([
    { id: 'organization', label: 'Organisation', n: kindCounts.organization },
    { id: 'campus', label: pluralise(labels.campus), n: kindCounts.campus },
    { id: 'department', label: pluralise(labels.department), n: kindCounts.department },
  ]), [kindCounts, labels]);

  const filtered = useMemo(() => {
    let rows = teams;
    if (eventId) rows = rows.filter((t) => teamChampIds(t).includes(eventId));
    if (tournamentFilter !== 'all') rows = rows.filter((t) => teamTournaments(t).some((x) => x.id === tournamentFilter));
    if (sportId) rows = rows.filter((t) => t.sport_id === sportId);
    if (status !== 'all') rows = rows.filter((t) => t.status === status);
    rows = rows.filter((t) => kindOf(t) === playsFor);
    return rows;
  }, [teams, eventId, tournamentFilter, sportId, status, playsFor]);
  const tc = useTableControls(filtered, {
    // Name and sport only - both are printed on the card. Matching on the
    // championships a team is entered into (not shown here at all) made a search
    // match teams for reasons nothing on screen explained, and any championship
    // whose name shared a common word with the query silently pulled in every
    // team entered in it. Filtering to a specific championship already has its
    // own control (the season/event dropdown above), so search doesn't need to
    // double as one too.
    search: (t) => `${t.name} ${t.sports?.name ?? ''}`,
    sorts: {
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
      championship: (a, b) => teamChampNames(a).localeCompare(teamChampNames(b)),
    },
    initialSort: 'name',
    pageSize: 12,
  });

  return (
    <div>
      <PageHeader
        title={activeEvent ? `${activeEvent.championships?.name ?? 'Championship'} teams` : 'Teams'}
        subtitle={activeEvent ? 'Teams entered for this championship.' : 'Enter and manage teams across your approved championships.'}
      >
      </PageHeader>

      {/* Hidden entirely until the organisation has a structure. Without campuses
          there is only one kind of squad, and a two-tab strip where one tab can
          never fill is a question with one answer. */}
      {campusTree.length > 0 && (
        <div className="mb-4">
          <Tabs
            active={playsFor}
            onChange={setPlaysFor}
            tabs={kindTabs.map((t) => ({
              id: t.id,
              label: t.label,
              badge: (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {t.n}
                </span>
              ),
            }))}
          />
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-prose text-[12.5px] text-slate-500 dark:text-slate-400">
              {playsFor === 'organization'
                ? 'These squads represent the whole institution against other institutions. They play in open championships.'
                : `Each of these represents one ${(playsFor === 'campus' ? labels.campus : labels.department).toLowerCase()}, and plays in championships run inside this organisation. Only people who belong to it can be picked.`}
            </p>

            {/* The actions live HERE, inside the tab, rather than in the page
                header. Standing in a tab already answers "what kind of squad", so
                the create form below never asks - which is the whole reason they
                moved. A header button would have to ask, because a header belongs
                to no tab. */}
            {canManage && (
              <div className="flex flex-none flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => setBulkCreating(true)}
                  disabled={!canEnterTeams}
                  title={canEnterTeams ? undefined
                    : approved.length === 0
                      ? 'You have no approved championship entry yet.'
                      : 'This championship has no discipline draws yet — set up its sports first.'}
                >+ Enter multiple</Button>
                <Button onClick={() => setCreating(true)}>
                  + Create {playsFor === 'organization' ? 'team' : (playsFor === 'campus' ? labels.campus : labels.department).toLowerCase() + ' squad'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* With no structure there is only one kind of squad, so no tab strip is
          drawn - but the actions still have to be somewhere. */}
      {campusTree.length === 0 && canManage && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setBulkCreating(true)} disabled={!canEnterTeams}>+ Enter multiple</Button>
          <Button onClick={() => setCreating(true)}>+ Create team</Button>
        </div>
      )}

      {/* The commonest reason teams cannot be created, stated where it is hit.
          Entrants can be in and squads still impossible, because a team is entered
          into a DRAW and the draws come from Setup → Sports. */}
      {approved.length > 0 && !canEnterTeams && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          This championship has no discipline draws yet, so there is nothing to enter a team into.
          Add its sports and disciplines under <strong>Setup → Sports</strong> first.
        </p>
      )}

      {/* Says where a CAMPUS squad is entered, which is not here. Without this the
          Teams page silently omits the internal championship an organiser has just
          set up, and the only clue is an absence. */}
      {/* Scoped to the tab, because `approved` now is. Standing in Campuses with no
          campus-level championship is a different sentence from standing in
          Organisation with no open one - and pointing somebody at "Browse
          championships" when what they need is an internal event nobody has created
          would send them out of the product for something that is not there. */}
      {approved.length === 0 && (
        <p className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {playsFor === 'organization'
            ? 'You need an approved championship registration before entering teams. Apply via “Browse championships”.'
            : `No championship is being contested between your ${pluralise(playsFor === 'campus' ? labels.campus : labels.department).toLowerCase()} yet. You can still build squads here — they can be entered once one exists and this ${(playsFor === 'campus' ? labels.campus : labels.department).toLowerCase()} is added to it.`}
        </p>
      )}
      {approved.length > 0 && eventId && eventDraws.length === 0 && (
        <p className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          No disciplines are configured for this championship yet. The organiser must add discipline draws in Setup before you can enter teams or assign players.
        </p>
      )}

      {creating && institutionId && (
        <InlineCreateTeam
          institutionId={institutionId}
          kind={playsFor as 'organization' | 'campus' | 'department'}
          onClose={() => setCreating(false)}
        />
      )}

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-4">
              <div className="flex items-start justify-between"><Skeleton className="h-10 w-10" rounded="rounded-xl" /><Skeleton className="h-5 w-16" rounded="rounded-full" /></div>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </Card>
          ))}
        </div>
      ) : teams.length === 0 && !eventId ? (
        <EmptyState icon="⚇" title="No teams yet" description="Create a team for your organization, then assign it to a championship."
          action={canManage ? <Button onClick={() => setCreating(true)}>+ Create team</Button> : undefined} />
      ) : (
        <>
          <ListToolbar>
            <SearchInput value={tc.query} onChange={tc.setQuery} placeholder="Search teams…" className="w-full sm:w-64" />
            {tournamentOptions.length > 0 && (
              <Select value={tournamentFilter} onChange={(e) => setTournamentFilter(e.target.value)} className="w-auto min-w-[11rem]">
                <option value="all">All seasons</option>
                {tournamentOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
            {statusOptions.length > 2 && (
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
                {statusOptions.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : titleCase(String(s))}</option>)}
              </Select>
            )}
            <Select value={tc.sortKey} onChange={(e) => tc.setSortKey(e.target.value)} className="w-auto">
              <option value="name">Sort: Name</option>
              <option value="championship">Sort: Championship</option>
            </Select>
            <SortDirButton dir={tc.dir} onToggle={() => tc.setDir(tc.dir === 'asc' ? 'desc' : 'asc')} />
          </ListToolbar>
          {tc.total === 0 ? (
            <EmptyState
              icon="⚇"
              title={eventId || tournamentFilter !== 'all' ? 'No teams match these filters' : 'No matching teams'}
              description={eventId ? 'Enter a team to participate in this championship, or try a different filter.' : 'Try a different search or filter.'}
              action={canManage && tournamentFilter === 'all' ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => setCreating(true)}>+ Create team</Button>
                  {eventId && canEnterTeams && <Button variant="outline" onClick={() => setBulkCreating(true)}>+ Enter multiple</Button>}
                </div>
              ) : undefined}
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tc.view.map((t) => (
                  <Card key={t.id} className="cursor-pointer p-4 transition hover:border-brand-300 dark:hover:border-brand-500/50 hover:shadow-md" onClick={() => navigate(`/organizations/${institutionId}/teams/${t.id}`)}>
                    <div className="flex items-start justify-between">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 dark:bg-brand-500/10 text-lg">{t.sports?.icon ?? '◇'}</span>
                      <div className="flex items-center gap-1.5">
                        {newTeamIds.has(t.id) && <Badge tone="green">New</Badge>}
                        <StatusBadge status={t.status} />
                      </div>
                    </div>
                    <h3 className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{t.name}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{t.sports?.name}</p>
                    {/* The line that stops two identically-named squads being
                        mistaken for each other. Absent for an organisation team,
                        because "the organisation" is the default and saying it on
                        every card is noise. */}
                    {(t as any).org_units && (
                      <p className="mt-0.5 flex items-center gap-1.5 text-[12px] font-medium text-brand-700 dark:text-brand-300">
                        <Building2 size={11} className="flex-none" aria-hidden />
                        {(t as any).org_units.name}
                        <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] opacity-70">
                          {(t as any).org_units.type === 'campus' ? labels.campus : labels.department}
                        </span>
                      </p>
                    )}
                    <div className="mt-1.5">
                      {teamEntries(t).length === 0
                        ? <span className="text-xs text-amber-600 dark:text-amber-400">Not entered yet</span>
                        : <span className="text-xs text-slate-500 dark:text-slate-400">Entered in {teamEntries(t).length} championship{teamEntries(t).length === 1 ? '' : 's'}</span>}
                    </div>
                    <div className="mt-2">
                      <p className="text-xs text-slate-400 dark:text-slate-500">{t.team_members?.length ?? 0} member{(t.team_members?.length ?? 0) === 1 ? '' : 's'}</p>
                    </div>
                  </Card>
                ))}
              </div>
              <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} />
            </>
          )}
        </>
      )}

      {bulkCreating && institutionId && (
        <BulkCreateTeamsModal
          approved={approved}
          organization={viewedOrg ?? (ctx?.organization?.id === institutionId ? ctx.organization : { id: institutionId })}
          kind={playsFor as 'organization' | 'campus' | 'department'}
          defaultEnrollmentId={defaultEnrollmentId}
          onClose={() => setBulkCreating(false)}
          markNewTeams={markNewTeams}
        />
      )}
    </div>
  );
}
