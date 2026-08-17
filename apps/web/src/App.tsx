import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useMatch } from 'react-router-dom';
import { useAuth, type AppRole } from './lib/auth';
import { AppShell, roleHome } from './components/AppShell';
import { useWorkspace, workspaceHome } from './lib/workspace';
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
import { LivePage } from './pages/organiser/LivePage';
import { StandingsPage } from './pages/organiser/StandingsPage';
import { EventSettingsPage } from './pages/organiser/EventSettingsPage';
import { EventParticipantsPage } from './pages/organiser/EventParticipantsPage';
import { EventOrganisersPage } from './pages/organiser/EventOrganisersPage';
import { EventImportPage } from './pages/organiser/EventImportPage';

// Organizations (multi-org membership + management)
import { OrganizationsPage } from './pages/OrganizationsPage';
import { OrgHomePage } from './pages/organization/OrgHomePage';
import { OrgReportsPage } from './pages/organization/OrgReportsPage';
import { OrgAchievementsPage } from './pages/organization/OrgAchievementsPage';
import { AchievementsLayout } from './pages/organization/AchievementsLayout';
import { AchievementTimeline } from './pages/organization/AchievementTimeline';
import { ClaimsReviewPage } from './pages/organization/ClaimsReviewPage';
import { EventStatusReportPage } from './pages/organization/ParkedSurfaces';
import { OrgAdministrationPage } from './pages/organization/OrgAdministrationPage';
import { CertificatesDashboard } from './pages/organization/certificates/CertificatesDashboard';
import { IssuedRegisterPage } from './pages/organization/certificates/IssuedRegisterPage';
import { TemplateGalleryPage } from './pages/organization/certificates/TemplateGalleryPage';
import { TemplatePreviewPage } from './pages/organization/certificates/TemplatePreviewPage';
import { CertificateDetailPage } from './pages/organization/certificates/CertificateDetailPage';
import { TeamsPage } from './pages/organization/TeamsPage';
import { RosterPage } from './pages/organization/RosterPage';
import { RollImportPage } from './pages/organization/RollImportPage';
import { PocsPage } from './pages/organization/PocsPage';
import { InvitationsPage } from './pages/organization/InvitationsPage';
import { OrgActivityPage } from './pages/organization/OrgActivityPage';
import { OrgStructurePage } from './pages/organization/OrgStructurePage';
import { OrgRolesPage } from './pages/organization/OrgRolesPage';
import { ModuleAccessPage } from './pages/organization/ModuleAccessPage';
import { ModuleGate } from './lib/permissions';

// Officiating
import { OfficialFixturesPage } from './pages/official/OfficialFixturesPage';
import { MatchConsolePage } from './pages/official/MatchConsolePage';

// Unified landing pages (the 5 nav sections)
import { ParticipantDashboard } from './pages/participant/ParticipantDashboard';
import { ParticipantEventPage } from './pages/participant/ParticipantEventPage';
import { ParticipantMatchesPage } from './pages/participant/ParticipantMatchesPage';
import { ParticipantMatchPage } from './pages/participant/ParticipantMatchPage';
import { ParticipantAwardsPage, ParticipantClaimsPage } from './pages/participant/ParticipantAchievementsPage';
import { ParticipantAchievementsLayout, ParticipantTimelinePage } from './pages/participant/ParticipantAchievementsLayout';
import { LifetimeRecordPage } from './pages/participant/LifetimeRecordPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { MyChampionshipsPage } from './pages/MyChampionshipsPage';
import { HostPage } from './pages/HostPage';

import { DesignShowcase } from './pages/DesignShowcase';
import { NotificationsPage } from './pages/NotificationsPage';
import { PlatformResource } from './pages/platform/PlatformResource';
import { PlatformRolesPage } from './pages/platform/PlatformRolesPage';
import { PlatformOverview } from './pages/platform/PlatformOverview';
import { PlatformUsersPage } from './pages/platform/PlatformUsersPage';
import { PlatformInstitutionsPage } from './pages/platform/PlatformInstitutionsPage';
import { PlatformDemoRequestsPage } from './pages/platform/PlatformDemoRequestsPage';
import { PlatformFeedbackPage } from './pages/platform/PlatformFeedbackPage';
import { PlatformDemosPage } from './pages/platform/PlatformDemosPage';
import { ChampionshipMatrixImportPage } from './pages/platform/ChampionshipMatrixImportPage';
import { PublicChampionshipPage } from './pages/public/PublicChampionshipPage';
import { VerifyCertificatePage } from './pages/public/VerifyCertificatePage';
import { VerifyLookupPage } from './pages/public/VerifyLookupPage';
import { InviteAcceptPage } from './pages/InviteAcceptPage';

// Where "home" is depends on which product this person is in (J1-E7-S1). Someone who
// runs an institution lands in it rather than on a participant profile they may have
// no matches on at all.
function HomeRedirect() {
  const { activeRole } = useAuth();
  const { workspace } = useWorkspace();
  if (activeRole === 'system') return <Navigate to={roleHome(activeRole)} replace />;
  return <Navigate to={workspaceHome(workspace)} replace />;
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
        {/* A person's Achievements area - the same three views the institution has
            (AchievementsLayout), scoped to one person instead of a whole place. */}
        <Route path="/profile/achievements" element={<ParticipantAchievementsLayout />}>
          <Route index element={<ParticipantTimelinePage />} />
          <Route path="awards" element={<ParticipantAwardsPage />} />
          <Route path="claims" element={<ParticipantClaimsPage />} />
        </Route>
        {/* The permanent record (J4-E2). Read-only by design - there is no edit route. */}
        <Route path="/profile/record" element={<LifetimeRecordPage />} />
        <Route path="/people/:userId/record" element={<LifetimeRecordPage />} />
        <Route path="/profile/matches" element={<ParticipantMatchesPage />} />
        <Route path="/profile/matches/:fixtureId" element={<ParticipantMatchPage />} />
        <Route path="/profile/championships/:championshipId" element={<ParticipantEventPage />} />

        {/* Organizations */}
        <Route path="/organizations" element={<OrganizationsPage />} />
        {/* The institution home (J1-E7) - the operator's command centre. `/overview`
            was a second landing page beside it; its checklist moved onto Home and the
            old path redirects, because saved links and invitation emails still use it. */}
        <Route path="/organizations/:orgId/home" element={<OrgHomePage />} />
        <Route path="/organizations/:orgId/overview" element={<Navigate to="../home" replace relative="path" />} />
        {/* Wave 4 surfaces. Records and reports are module-gated the same way the rest is. */}
        {/* Achievements is three views of one record: the timeline is the landing
            view, per the design; the Hall of Fame and the claims queue sit beside it. */}
        <Route path="/organizations/:orgId/achievements" element={<ModuleGate module="records"><AchievementsLayout /></ModuleGate>}>
          <Route index element={<AchievementTimeline />} />
          <Route path="hall-of-fame" element={<OrgAchievementsPage />} />
          <Route path="claims" element={<ClaimsReviewPage />} />
        </Route>
        <Route path="/organizations/:orgId/reports" element={<ModuleGate module="reports"><OrgReportsPage /></ModuleGate>} />
        {/* Certificates is four screens, not one: the manager's dashboard, the register,
            the template gallery, and a single certificate. Ordered so the literal
            segments win over :certId. */}
        <Route path="/organizations/:orgId/certificates" element={<ModuleGate module="records"><CertificatesDashboard /></ModuleGate>} />
        <Route path="/organizations/:orgId/certificates/register" element={<ModuleGate module="records"><IssuedRegisterPage /></ModuleGate>} />
        <Route path="/organizations/:orgId/certificates/templates" element={<ModuleGate module="records"><TemplateGalleryPage /></ModuleGate>} />
        <Route path="/organizations/:orgId/certificates/templates/:templateId" element={<ModuleGate module="records"><TemplatePreviewPage /></ModuleGate>} />
        <Route path="/organizations/:orgId/certificates/:certId" element={<ModuleGate module="records"><CertificateDetailPage /></ModuleGate>} />
        <Route path="/organizations/:orgId/administration" element={<ModuleGate module="administration"><OrgAdministrationPage /></ModuleGate>} />
        {/* Module-gated (J6-E2-S2): a direct link to something the institution
            has switched off for this audience gets a plain "not available" page,
            never a raw error or a silently empty screen. */}
        <Route path="/organizations/:orgId/teams" element={<ModuleGate module="teams"><TeamsPage /></ModuleGate>} />
        <Route path="/organizations/:orgId/teams/:teamId" element={<ModuleGate module="teams"><RosterPage /></ModuleGate>} />
        {/* There is one people directory, and it is the People tab. `/students`
            was a third view of the same institution (team-grouped, which is what
            the Teams tab already does) and it could not show anyone who was not
            on a squad - so an imported roll of 2,000 was invisible in it. */}
        {/* One directory, not three (J1-E5). `relative="path"` matters: these routes are
            flat siblings, so the default route-relative ".." resolves against the layout
            and lands on "/members", which does not exist - the catch-all then bounced
            anyone following an old link to their own profile. */}
        <Route path="/organizations/:orgId/students" element={<Navigate to="../members" replace relative="path" />} />
        <Route path="/organizations/:orgId/students/import" element={<ModuleGate module="people"><RollImportPage /></ModuleGate>} />
        <Route path="/organizations/:orgId/members" element={<ModuleGate module="people"><PocsPage /></ModuleGate>} />
        <Route path="/organizations/:orgId/invitations" element={<ModuleGate module="people"><InvitationsPage /></ModuleGate>} />
        <Route path="/organizations/:orgId/activity" element={<ModuleGate module="administration"><OrgActivityPage /></ModuleGate>} />
        <Route path="/organizations/:orgId/structure" element={<OrgStructurePage />} />
        <Route path="/organizations/:orgId/roles" element={<OrgRolesPage />} />
        <Route path="/organizations/:orgId/modules" element={<ModuleAccessPage />} />

        {/* Discover + Championships + Host */}
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/championships" element={<MyChampionshipsPage />} />
        <Route path="/host" element={<HostPage />} />
        <Route path="/championships/new" element={<CreateEventWizard />} />
        <Route path="/championships/:eventId" element={<EventLayout />}>
          <Route index element={<EventDashboard />} />
          <Route path="setup" element={<EventSetupPage />} />
          <Route path="import" element={<EventImportPage />} />
          <Route path="team" element={<EventOrganisersPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="participants" element={<EventParticipantsPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="live" element={<LivePage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="standings" element={<StandingsPage />} />
          {/* Parked: J2-E8's figures are built and tested, its screen is not. */}
          <Route path="status" element={<EventStatusReportPage />} />
          <Route path="settings" element={<EventSettingsPage />} />
        </Route>

        {/* Officiating */}
        <Route path="/officiating" element={<OfficialFixturesPage />} />
        <Route path="/score/:fixtureId" element={<MatchConsolePage />} />

        {/* Platform (system admin only) */}
        <Route path="/platform/overview" element={<RequireRole roles={SYSTEM}><PlatformOverview /></RequireRole>} />
        <Route path="/platform/users" element={<RequireRole roles={SYSTEM}><PlatformUsersPage /></RequireRole>} />
        <Route path="/platform/demo-requests" element={<RequireRole roles={SYSTEM}><PlatformDemoRequestsPage /></RequireRole>} />
        <Route path="/platform/feedback" element={<RequireRole roles={SYSTEM}><PlatformFeedbackPage /></RequireRole>} />
        <Route path="/platform/demos" element={<RequireRole roles={SYSTEM}><PlatformDemosPage /></RequireRole>} />
        <Route path="/platform/organizations" element={<RequireRole roles={SYSTEM}><PlatformInstitutionsPage /></RequireRole>} />
        <Route path="/platform/import-setup" element={<RequireRole roles={SYSTEM}><ChampionshipMatrixImportPage /></RequireRole>} />
        {/* Before the /platform/:key catch-all, which would otherwise render the
            generic CRUD screen for "roles" and its raw-JSON textarea. */}
        <Route path="/platform/roles" element={<RequireRole roles={SYSTEM}><PlatformRolesPage /></RequireRole>} />
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
  const { ctx, loading, justLoggedIn, clearJustLoggedIn, activeRole, landingPath } = useAuth();

  // Consume the one-shot login flag once we've acted on it (below).
  useEffect(() => { if (justLoggedIn) clearJustLoggedIn(); }, [justLoggedIn, clearJustLoggedIn]);

  // Every route match is resolved BEFORE the first early return below. Interleaving
  // hooks with returns changes the hook order between renders as the URL changes,
  // which is exactly the bug React's rules-of-hooks exists to prevent.
  const publicMatch = useMatch('/c/:token');
  const verifyMatch = useMatch('/verify/:token');
  const verifyLookup = useMatch('/verify');
  const inviteMatch = useMatch('/invite/:token');

  // Public, view-only share link - rendered with no sidebar/login, regardless of
  // whether the visitor is signed in (so the link works for anyone).
  if (publicMatch?.params.token) return <PublicChampionshipPage token={publicMatch.params.token} />;

  // Certificate verification (J4-E8). Ahead of every auth check for the same reason
  // the share link is: the people who most need to verify a certificate - an employer,
  // another institution - have no account here and never will.
  if (verifyMatch?.params.token) return <VerifyCertificatePage token={verifyMatch.params.token} />;
  // Reached from a desktop with a printed certificate in hand, rather than from a
  // phone that has already scanned the code.
  if (verifyLookup) return <VerifyLookupPage />;

  // An invitation link has to work for someone who has never signed in - and equally
  // for someone already signed in as somebody else, hence ahead of the ctx check.
  if (inviteMatch?.params.token && !justLoggedIn) return <InviteAcceptPage token={inviteMatch.params.token} />;

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
  // session's last-visited URL never renders - unless the sign-in named somewhere
  // better (a domain-matched code lands on the organisation just joined). Initial
  // token refresh skips this.
  if (justLoggedIn) return <Navigate to={landingPath ?? roleHome(activeRole)} replace />;
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
