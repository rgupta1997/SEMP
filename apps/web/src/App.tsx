import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, type AppRole } from './lib/auth';
import { AppShell, roleHome } from './components/AppShell';
import { ConfirmProvider, Spinner, ToastProvider } from './components/ui';
import { TourProvider } from './components/onboarding/Tour';
import { HelpPage } from './pages/HelpPage';
import { AuthPage } from './pages/AuthPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';

// Host / championship management (reachable by the championship's organiser)
import { CreateEventWizard } from './pages/organiser/CreateEventWizard';
import { EventLayout } from './pages/organiser/EventLayout';
import { EventDashboard } from './pages/organiser/EventDashboard';
import { EventSetupPage } from './pages/organiser/EventSetupPage';
import { ApprovalsPage } from './pages/organiser/ApprovalsPage';
import { SchedulePage } from './pages/organiser/SchedulePage';
import { ResultsPage } from './pages/organiser/ResultsPage';
import { StandingsPage } from './pages/organiser/StandingsPage';
import { EventSettingsPage } from './pages/organiser/EventSettingsPage';
import { EventParticipantsPage } from './pages/organiser/EventParticipantsPage';
import { EventOrganisersPage } from './pages/organiser/EventOrganisersPage';

// Organizations (multi-org membership + management)
import { OrganizationsPage } from './pages/OrganizationsPage';
import { OrgOverviewPage } from './pages/organization/OrgOverviewPage';
import { TeamsPage } from './pages/organization/TeamsPage';
import { RosterPage } from './pages/organization/RosterPage';
import { StudentsPage } from './pages/organization/StudentsPage';
import { PocsPage } from './pages/organization/PocsPage';
import { InvitationsPage } from './pages/organization/InvitationsPage';

// Officiating
import { OfficialFixturesPage } from './pages/official/OfficialFixturesPage';
import { MatchConsolePage } from './pages/official/MatchConsolePage';

// Unified landing pages (the 5 nav sections)
import { ParticipantDashboard } from './pages/participant/ParticipantDashboard';
import { ParticipantEventPage } from './pages/participant/ParticipantEventPage';
import { ParticipantMatchesPage } from './pages/participant/ParticipantMatchesPage';
import { ParticipantMatchPage } from './pages/participant/ParticipantMatchPage';
import { ParticipantAchievementsPage } from './pages/participant/ParticipantAchievementsPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { MyChampionshipsPage } from './pages/MyChampionshipsPage';
import { HostPage } from './pages/HostPage';

import { DesignShowcase } from './pages/DesignShowcase';
import { NotificationsPage } from './pages/NotificationsPage';
import { PlatformResource } from './pages/platform/PlatformResource';
import { PlatformOverview } from './pages/platform/PlatformOverview';
import { PlatformUsersPage } from './pages/platform/PlatformUsersPage';
import { PlatformInstitutionsPage } from './pages/platform/PlatformInstitutionsPage';
import { PlatformDemoRequestsPage } from './pages/platform/PlatformDemoRequestsPage';
import { ChampionshipMatrixImportPage } from './pages/platform/ChampionshipMatrixImportPage';

function HomeRedirect() {
  const { activeRole } = useAuth();
  return <Navigate to={roleHome(activeRole)} replace />;
}

// Route guard for platform-only pages.
function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { availableRoles, activeRole } = useAuth();
  const ok = roles.some((r) => availableRoles.includes(r));
  return ok ? <>{children}</> : <Navigate to={roleHome(activeRole)} replace />;
}

const SYSTEM: AppRole[] = ['system'];

function AuthenticatedRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* Profile / My Game */}
        <Route path="/profile" element={<ParticipantDashboard />} />
        <Route path="/profile/achievements" element={<ParticipantAchievementsPage />} />
        <Route path="/profile/matches" element={<ParticipantMatchesPage />} />
        <Route path="/profile/matches/:fixtureId" element={<ParticipantMatchPage />} />
        <Route path="/profile/championships/:championshipId" element={<ParticipantEventPage />} />

        {/* Organizations */}
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/organizations/:orgId/overview" element={<OrgOverviewPage />} />
        <Route path="/organizations/:orgId/teams" element={<TeamsPage />} />
        <Route path="/organizations/:orgId/teams/:teamId" element={<RosterPage />} />
        <Route path="/organizations/:orgId/students" element={<StudentsPage />} />
        <Route path="/organizations/:orgId/members" element={<PocsPage />} />
        <Route path="/organizations/:orgId/invitations" element={<InvitationsPage />} />

        {/* Discover + Championships + Host */}
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/championships" element={<MyChampionshipsPage />} />
        <Route path="/host" element={<HostPage />} />
        <Route path="/championships/new" element={<CreateEventWizard />} />
        <Route path="/championships/:eventId" element={<EventLayout />}>
          <Route index element={<EventDashboard />} />
          <Route path="setup" element={<EventSetupPage />} />
          <Route path="team" element={<EventOrganisersPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="participants" element={<EventParticipantsPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="standings" element={<StandingsPage />} />
          <Route path="settings" element={<EventSettingsPage />} />
        </Route>

        {/* Officiating */}
        <Route path="/officiating" element={<OfficialFixturesPage />} />
        <Route path="/score/:fixtureId" element={<MatchConsolePage />} />

        {/* Platform (system admin only) */}
        <Route path="/platform/overview" element={<RequireRole roles={SYSTEM}><PlatformOverview /></RequireRole>} />
        <Route path="/platform/users" element={<RequireRole roles={SYSTEM}><PlatformUsersPage /></RequireRole>} />
        <Route path="/platform/demo-requests" element={<RequireRole roles={SYSTEM}><PlatformDemoRequestsPage /></RequireRole>} />
        <Route path="/platform/organizations" element={<RequireRole roles={SYSTEM}><PlatformInstitutionsPage /></RequireRole>} />
        <Route path="/platform/import-setup" element={<RequireRole roles={SYSTEM}><ChampionshipMatrixImportPage /></RequireRole>} />
        <Route path="/platform/:key" element={<RequireRole roles={SYSTEM}><PlatformResource /></RequireRole>} />

        {/* Notifications + help + design system - any authenticated user */}
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/design" element={<DesignShowcase />} />

        {/* Catch all */}
        <Route path="*" element={<HomeRedirect />} />
      </Route>
    </Routes>
  );
}

function AppRoutes() {
  const { ctx, loading, justLoggedIn, clearJustLoggedIn, activeRole } = useAuth();

  // Consume the one-shot login flag once we've acted on it (below).
  useEffect(() => { if (justLoggedIn) clearJustLoggedIn(); }, [justLoggedIn, clearJustLoggedIn]);

  if (loading) return <div className="grid h-screen place-items-center"><Spinner /></div>;
  // Logged out: a public marketing landing page at the root, with the sign-in
  // screen at /login. Any other path falls through to the landing page.
  if (!ctx) return (
    <Routes>
      <Route path="/" element={<AuthPage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
  // Provisioned logins must set their own password before they can use the app.
  if (ctx.user.must_change_password) return <ChangePasswordPage />;
  // After an explicit login/signup, bounce to the role's home so the previous
  // session's last-visited URL never renders. Initial token refresh skips this.
  if (justLoggedIn) return <Navigate to={roleHome(activeRole)} replace />;
  return <AuthenticatedRoutes />;
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <TourProvider>
            <AppRoutes />
          </TourProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
