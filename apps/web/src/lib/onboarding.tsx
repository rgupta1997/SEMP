import { useApi } from './hooks';

// ---------------------------------------------------------------------------
// Onboarding: a single source of truth for the guided flows. The same step
// content drives three surfaces - the dashboard "Getting started" checklist,
// the in-app tour, and the Help page - so they can never drift apart. The
// CONTENT arrays below hold the wording; the hooks attach a CTA target and a
// live "done" flag computed from real data.
// ---------------------------------------------------------------------------

export interface StepContent {
  id: string;
  title: string;
  description: string;   // short line shown in the checklist
  help: string;          // fuller explanation shown on the Help page
}

export interface OnboardingStep extends StepContent {
  cta: { label: string; to: string };
  done: boolean;
}

export interface OnboardingState {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  complete: boolean;
  loading: boolean;
}

export interface GuideSection {
  audience: string;            // who this guide is for
  blurb: string;
  steps: StepContent[];
}

// ---- Organization / POC journey -------------------------------------------
export const POC_GUIDE: StepContent[] = [
  {
    id: 'members',
    title: 'Add your people',
    description: 'Invite staff and players to your organization by name or mobile.',
    help: 'Open Members and search by name or mobile number to add people already on the platform. Unknown numbers get an invitation that auto-applies when they sign up. These are the people you can later put into teams.',
  },
  {
    id: 'team',
    title: 'Create a team',
    description: 'A team is a reusable roster for one sport - create it once, enter it anywhere.',
    help: 'On the Teams page, “Create team” makes a standalone roster (just a name + sport). You build its squad once and can then enter it into one or more championships.',
  },
  {
    id: 'apply',
    title: 'Apply to a championship',
    description: 'Browse open championships and request to participate.',
    help: 'Use Discover to find open championships and apply. An organiser reviews and approves your organization before you can enter teams - watch its status on your dashboard.',
  },
  {
    id: 'enter',
    title: 'Enter a team into a championship',
    description: 'Once approved, enter teams and pick their discipline draw.',
    help: 'From a team’s page (or “Enter multiple”), choose an approved championship and a discipline. A team can join several championships; each entry locks independently.',
  },
  {
    id: 'roster',
    title: 'Build your squad',
    description: 'Add players to a team from your members or by pasting a list.',
    help: 'Open a team and “Add players” - tick people from your organization or paste a Name, email, jersey list. The squad is shared across all of that team’s championship entries.',
  },
  {
    id: 'lock',
    title: 'Lock your roster',
    description: 'Lock each entry once the squad meets the discipline’s rules.',
    help: 'When a championship entry has a discipline and enough players, lock it to confirm your squad for that competition. Locking is per entry, so other entries stay editable.',
  },
];

// ---- Organiser journey -----------------------------------------------------
export const ORGANISER_GUIDE: StepContent[] = [
  {
    id: 'season',
    title: 'Add a season',
    description: 'Create the season (tournament) that holds your sports.',
    help: 'In Setup → Seasons, add at least one season. Everything else - sports, disciplines, fixtures - hangs off a season.',
  },
  {
    id: 'draws',
    title: 'Set up sports & disciplines',
    description: 'Add the sports and discipline draws teams will enter.',
    help: 'In Setup → Sports & disciplines, add each sport and its disciplines (with squad sizes and format). These draws are what participating teams pick when they enter.',
  },
  {
    id: 'venue',
    title: 'Add a venue',
    description: 'Add at least one venue so fixtures have somewhere to play.',
    help: 'In Setup → Venue, add venues and grounds. Fixtures are scheduled against a venue ground.',
  },
  {
    id: 'invite',
    title: 'Invite organizations',
    description: 'Invite organizations to participate, or approve those who applied.',
    help: 'From Setup → Invite, invite organizations directly, or review applications on the Approvals tab. Approved organizations can then enter teams into your draws.',
  },
  {
    id: 'officials',
    title: 'Assign officials',
    description: 'Add officials who will score matches and manage fixtures.',
    help: 'On the Team page, assign officials. They see this championship’s fixtures in their “My Matches” view and can score the matches assigned to them.',
  },
  {
    id: 'open',
    title: 'Open registration',
    description: 'Move the championship out of draft so organizations can apply.',
    help: 'Once setup looks right, open registration from Settings (or the championship header). Draft championships are not visible for organizations to apply to.',
  },
];

// Grouped content for the Help page (no live data needed).
export const GUIDES: GuideSection[] = [
  { audience: 'For organizations', blurb: 'Run your contingent: add people, build teams and enter championships.', steps: POC_GUIDE },
  { audience: 'For organisers', blurb: 'Set up and run a championship from scratch.', steps: ORGANISER_GUIDE },
];

function build(content: StepContent[], cta: Record<string, { label: string; to: string }>, done: Record<string, boolean>, loading: boolean): OnboardingState {
  const steps = content.map((c) => ({ ...c, cta: cta[c.id], done: !!done[c.id] }));
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length, loading };
}

export function usePocOnboarding(orgId: string, enabled = true): OnboardingState {
  const on = enabled && !!orgId;
  const members = useApi<any[]>(on ? `/organizations/${orgId}/members` : null);
  const teams = useApi<any[]>(on ? `/teams?organization_id=${orgId}` : null);
  const enrollments = useApi<any[]>(on ? `/me/enrollments?organization_id=${orgId}` : null);

  const m = members.data ?? [];
  const t = teams.data ?? [];
  const e = enrollments.data ?? [];
  const teamsHref = `/organizations/${orgId}/teams`;
  // The checklist lives on the Teams page, so the per-team steps must point at a
  // specific team (a no-op link back to the same page is the "button does nothing"
  // bug). Pick the team that still needs each action; deep-link to the right tab.
  const teamHref = (id: string | undefined, tab: 'squad' | 'championships') =>
    id ? `/organizations/${orgId}/teams/${id}?tab=${tab}` : teamsHref;
  const teamToEnter = t.find((x) => (x.team_entries ?? []).length === 0) ?? t[0];
  const teamToFill = t.find((x) => (x.team_members ?? []).length === 0) ?? t[0];
  const teamToLock = t.find((x) => (x.team_entries ?? []).some((en: any) => en.status !== 'roster_locked')) ?? t[0];

  return build(
    POC_GUIDE,
    {
      members: { label: 'Add members', to: `/organizations/${orgId}/members` },
      team: { label: 'Create a team', to: `${teamsHref}?create=1` },
      apply: { label: 'Browse championships', to: '/discover' },
      enter: { label: 'Enter a team', to: teamHref(teamToEnter?.id, 'championships') },
      roster: { label: 'Add players', to: teamHref(teamToFill?.id, 'squad') },
      lock: { label: 'Lock a roster', to: teamHref(teamToLock?.id, 'championships') },
    },
    {
      members: m.some((x) => x.role !== 'owner'),
      team: t.length > 0,
      apply: e.length > 0,
      enter: t.some((x) => (x.team_entries ?? []).length > 0),
      roster: t.some((x) => (x.team_members ?? []).length > 0),
      lock: t.some((x) => (x.team_entries ?? []).some((en: any) => en.status === 'roster_locked')),
    },
    members.isLoading || teams.isLoading || enrollments.isLoading,
  );
}

export function useOrganiserOnboarding(eventId: string, status?: string, enabled = true): OnboardingState {
  const on = enabled && !!eventId;
  const tournaments = useApi<any[]>(on ? `/tournaments?championship_id=${eventId}` : null);
  const draws = useApi<any[]>(on ? `/championships/${eventId}/draws` : null);
  const venues = useApi<any[]>(on ? `/venues?championship_id=${eventId}` : null);
  const enrollments = useApi<any[]>(on ? `/championships/${eventId}/enrollments` : null);
  const invitations = useApi<any[]>(on ? `/championships/${eventId}/invitations` : null);
  const officials = useApi<any[]>(on ? `/championships/${eventId}/officials` : null);

  const setupHref = `/championships/${eventId}/setup`;

  return build(
    ORGANISER_GUIDE,
    {
      // Deep-link each step straight to the right Setup tab (?tab=…).
      season: { label: 'Add a season', to: `${setupHref}?tab=tournaments` },
      draws: { label: 'Configure sports', to: `${setupHref}?tab=sports` },
      venue: { label: 'Add a venue', to: `${setupHref}?tab=venues` },
      invite: { label: 'Invite organizations', to: `${setupHref}?tab=invite` },
      officials: { label: 'Assign officials', to: `/championships/${eventId}/team` },
      open: { label: 'Open registration', to: `/championships/${eventId}/settings` },
    },
    {
      season: (tournaments.data ?? []).length > 0,
      draws: (draws.data ?? []).length > 0,
      venue: (venues.data ?? []).length > 0,
      // "Invited" counts both organisations you invited and those who applied/joined.
      invite: (invitations.data ?? []).length > 0 || (enrollments.data ?? []).length > 0,
      officials: (officials.data ?? []).length > 0,
      open: !!status && status !== 'draft',
    },
    tournaments.isLoading || draws.isLoading || venues.isLoading || enrollments.isLoading || invitations.isLoading || officials.isLoading,
  );
}

// ---- Portal tour -----------------------------------------------------------
// A short spotlight tour of the main navigation, reliable because these anchors
// are always present. Targets are `data-tour="nav-<path>"` set in AppShell.
export interface TourStep { target: string; title: string; body: string }

export const PORTAL_TOUR: TourStep[] = [
  { target: 'nav-/profile', title: 'My Game', body: 'Your personal hub - the championships you play in, your matches and achievements.' },
  { target: 'nav-/organizations', title: 'Organizations', body: 'Manage the organizations you run: members, teams and rosters live here.' },
  { target: 'nav-/discover', title: 'Discover', body: 'Find open championships and apply to participate with your organization.' },
  { target: 'nav-/championships', title: 'Championships', body: 'Everything you take part in, in one place - across every organization.' },
  { target: 'nav-/host', title: 'Host', body: 'Run your own championship - create one and you become its organiser.' },
  { target: 'nav-/help', title: 'Help & guide', body: 'Step-by-step guides for every role. Come back here any time.' },
];
