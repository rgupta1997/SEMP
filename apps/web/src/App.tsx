import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, type AppRole } from './lib/auth';
import { AppShell, roleHome } from './components/AppShell';
import { Spinner, ToastProvider } from './components/ui';
import { AuthPage } from './pages/AuthPage';

import { EventsListPage } from './pages/organiser/EventsListPage';
import { CreateEventWizard } from './pages/organiser/CreateEventWizard';
import { EventLayout } from './pages/organiser/EventLayout';
import { EventDashboard } from './pages/organiser/EventDashboard';
import { EventSetupPage } from './pages/organiser/EventSetupPage';
import { ApprovalsPage } from './pages/organiser/ApprovalsPage';
import { SchedulePage } from './pages/organiser/SchedulePage';
import { StandingsPage } from './pages/organiser/StandingsPage';
import { EventSettingsPage } from './pages/organiser/EventSettingsPage';
import { EventParticipantsPage } from './pages/organiser/EventParticipantsPage';
import { EventOfficialsPage } from './pages/organiser/EventOfficialsPage';
import { EventOrganisersPage } from './pages/organiser/EventOrganisersPage';

import { InstitutionDashboard } from './pages/institution/InstitutionDashboard';
import { BrowseEventsPage } from './pages/institution/BrowseEventsPage';
import { TeamsPage } from './pages/institution/TeamsPage';
import { RosterPage } from './pages/institution/RosterPage';
import { StudentsPage } from './pages/institution/StudentsPage';
import { PocsPage } from './pages/institution/PocsPage';

import { OfficialFixturesPage } from './pages/official/OfficialFixturesPage';
import { MatchConsolePage } from './pages/official/MatchConsolePage';

import { ParticipantDashboard } from './pages/participant/ParticipantDashboard';
import { ParticipantEventPage } from './pages/participant/ParticipantEventPage';
import { ParticipantMatchesPage } from './pages/participant/ParticipantMatchesPage';
import { ParticipantMatchPage } from './pages/participant/ParticipantMatchPage';
import { DesignShowcase } from './pages/DesignShowcase';
import { NotificationsPage } from './pages/NotificationsPage';
import { PlatformResource } from './pages/platform/PlatformResource';
import { PlatformOverview } from './pages/platform/PlatformOverview';
import { PlatformUsersPage } from './pages/platform/PlatformUsersPage';
import { PlatformInstitutionsPage } from './pages/platform/PlatformInstitutionsPage';

function HomeRedirect() {
  const { activeRole } = useAuth();
  return <Navigate to={roleHome(activeRole)} replace />;
}

// Route-level guard: only users entitled to one of `roles` may enter; others are
// redirected to their own home. (Server APIs enforce the real boundary; this
// keeps users out of shells they have no business seeing.)
function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { availableRoles, activeRole } = useAuth();
  const ok = roles.some((r) => availableRoles.includes(r));
  return ok ? <>{children}</> : <Navigate to={roleHome(activeRole)} replace />;
}

const ORG: AppRole[] = ['organiser', 'system'];
const INST: AppRole[] = ['institution', 'system'];
const OFFICIAL: AppRole[] = ['official', 'system'];
const SYSTEM: AppRole[] = ['system'];
const PARTICIPANT: AppRole[] = ['participant', 'system'];

function AuthenticatedRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* Organiser / System */}
        <Route path="/events" element={<RequireRole roles={ORG}><EventsListPage /></RequireRole>} />
        <Route path="/events/new" element={<RequireRole roles={ORG}><CreateEventWizard /></RequireRole>} />
        <Route path="/events/:eventId" element={<RequireRole roles={ORG}><EventLayout /></RequireRole>}>
          <Route index element={<EventDashboard />} />
          <Route path="setup" element={<EventSetupPage />} />
          <Route path="team" element={<EventOrganisersPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="participants" element={<EventParticipantsPage />} />
          <Route path="officials" element={<EventOfficialsPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="standings" element={<StandingsPage />} />
          <Route path="settings" element={<EventSettingsPage />} />
        </Route>
        <Route path="/platform/overview" element={<RequireRole roles={SYSTEM}><PlatformOverview /></RequireRole>} />
        <Route path="/platform/users" element={<RequireRole roles={SYSTEM}><PlatformUsersPage /></RequireRole>} />
        <Route path="/platform/institutions" element={<RequireRole roles={SYSTEM}><PlatformInstitutionsPage /></RequireRole>} />
        <Route path="/platform/:key" element={<RequireRole roles={SYSTEM}><PlatformResource /></RequireRole>} />

        {/* Institution / Captain */}
        <Route path="/inst" element={<RequireRole roles={INST}><InstitutionDashboard /></RequireRole>} />
        <Route path="/inst/events" element={<RequireRole roles={INST}><BrowseEventsPage /></RequireRole>} />
        <Route path="/inst/teams" element={<RequireRole roles={INST}><TeamsPage /></RequireRole>} />
        <Route path="/inst/teams/:teamId" element={<RequireRole roles={INST}><RosterPage /></RequireRole>} />
        <Route path="/inst/students" element={<RequireRole roles={INST}><StudentsPage /></RequireRole>} />
        <Route path="/inst/pocs" element={<RequireRole roles={INST}><PocsPage /></RequireRole>} />

        {/* Official */}
        <Route path="/official" element={<RequireRole roles={OFFICIAL}><OfficialFixturesPage /></RequireRole>} />
        <Route path="/official/score/:fixtureId" element={<RequireRole roles={OFFICIAL}><MatchConsolePage /></RequireRole>} />

        {/* Participant — only participant accounts (and captains, who hold the
            participant role too); officials / organisers / POCs are redirected. */}
        <Route path="/me" element={<RequireRole roles={PARTICIPANT}><ParticipantDashboard /></RequireRole>} />
        <Route path="/me/events/:eventId" element={<RequireRole roles={PARTICIPANT}><ParticipantEventPage /></RequireRole>} />
        <Route path="/me/matches" element={<RequireRole roles={PARTICIPANT}><ParticipantMatchesPage /></RequireRole>} />
        <Route path="/me/matches/:fixtureId" element={<RequireRole roles={PARTICIPANT}><ParticipantMatchPage /></RequireRole>} />

        {/* Notifications — global feed, open to any authenticated user */}
        <Route path="/notifications" element={<NotificationsPage />} />

        {/* Design system reference — open to any authenticated user */}
        <Route path="/design" element={<DesignShowcase />} />

        {/* Catch all - redirect to role home */}
        <Route path="*" element={<HomeRedirect />} />
      </Route>
    </Routes>
  );
}

function AppRoutes() {
  const { ctx, loading } = useAuth();
  
  if (loading) return <div className="grid h-screen place-items-center"><Spinner /></div>;
  
  return ctx ? <AuthenticatedRoutes /> : (
    <Routes>
      <Route path="*" element={<AuthPage />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </BrowserRouter>
  );
}
