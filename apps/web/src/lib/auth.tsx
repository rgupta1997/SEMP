import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from './api';

// Every login is a `user`; `system` is the platform super-admin shell. There are
// no per-account-type shells any more - what a user can do is derived per
// championship (championship_roles) and per organization (organizations).
export type AppRole = 'system' | 'user';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  avatar_url?: string | null;
  is_super_admin: boolean;
  organization_id: string | null;
  // Set on admin-provisioned logins; forces a password reset on first sign-in.
  must_change_password?: boolean;
}

// What /auth/identify tells the screen about an email address, before any credential
// is typed: which institution owns its domain (non-null only when the domain is
// claimed AND verified), and whether an account already exists - which is what
// decides between asking for a password and walking them through signing up.
export interface IdentifyResult {
  organization: {
    id: string; name: string; short_name: string | null;
    logo_url: string | null; city: string | null; kind: string; verified: boolean;
  } | null;
  registered: boolean;
  auth_methods: string[];
}

// A one-time code proves ownership of an address. It is not a way in - it gates
// creating an account and setting a forgotten password.
export type VerificationPurpose = 'signup' | 'password_reset';

// /auth/otp/request. `dev_code` is present only while AUTH_EMAIL_BYPASS is on -
// email delivery isn't wired yet (module 02), so the code comes back in-band.
export interface OtpRequestResult {
  sent: boolean;
  expires_at?: string;
  dev_code?: string;
  bypass?: boolean;
}

export interface ChampionshipRef { id: string; name: string; slug: string; status: string }
export interface ChampionshipRole { id: string; championship_id: string; championship: ChampionshipRef; role: { id: string; name: string } }
export interface Membership { id: string; team_id: string; role: string; jersey_number: number | null; team: any }
export interface Organization {
  id: string; name: string; short_name?: string | null; code?: string | null;
  city?: string | null; logo_url?: string | null;
  // Tenancy (EOS): 'community' | 'institution' | 'personal'. `verified` drives the
  // Verified badge and is only ever set by a platform super-admin.
  kind?: string; verified?: boolean;
}
export interface OrgMembership { id: string; organization_id: string; organization: Organization; role: string; status: string; joined_at: string }

export interface AuthContext {
  user: AuthUser;
  organization: Organization | null;
  organizations: OrgMembership[];
  official_championship_ids: string[];
  championship_roles: ChampionshipRole[];
  memberships: Membership[];
  /**
   * Modules this person can reach, per organisation id (J6-E2). Sent with the
   * context so navigation is correct on the first paint rather than flickering
   * a link away a moment after it renders.
   */
  modules?: Record<string, string[]>;
}

interface AuthState {
  ctx: AuthContext | null;
  loading: boolean;
  availableRoles: AppRole[];
  activeRole: AppRole;
  setActiveRole: (r: AppRole) => void;
  login: (email: string, password: string) => Promise<void>;
  // Email-first entry. `identify` decides which door; `requestOtp`/`verifyOtp`
  // prove ownership of the address; `completeSignup`/`resetPassword` are what
  // actually establish a session.
  identify: (email: string) => Promise<IdentifyResult>;
  requestOtp: (email: string, purpose: VerificationPurpose) => Promise<OtpRequestResult>;
  verifyOtp: (email: string, code: string, purpose: VerificationPurpose) => Promise<VerifyOtpResult>;
  completeSignup: (body: CompleteSignupBody) => Promise<CompletedAuth>;
  // Used by the invitation accept page, which lives outside the app shell and does
  // its own POST - it hands the response here to become a session.
  applyInviteSession: (res: { token: string } & AuthContext, landingPath?: string) => void;
  resetPassword: (verificationToken: string, password: string) => Promise<CompletedAuth>;
  changePassword: (newPassword: string, currentPassword?: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => void;
  // True right after an explicit login/signup so the router can land on the
  // role's home instead of the previous session's last-visited URL. (Not set on
  // initial token refresh, so deep links opened while signed in still work.)
  justLoggedIn: boolean;
  clearJustLoggedIn: () => void;
  // Where that login should land, when it isn't the role's default home (e.g. a
  // domain-matched sign-in goes to the organisation the person just joined).
  landingPath: string | null;
}

// A verified code buys a ten-minute ticket, not a session. The ticket is what the
// next step - choosing a password - redeems.
export interface VerifyOtpResult {
  verification_token: string;
  organization: { id: string; name: string; logo_url: string | null; verified: boolean } | null;
}

// What completing signup (or a reset) gives back, on top of the session itself.
//
// `matched_organization` is the institution that claimed this email's domain - a
// suggestion, NOT somewhere the person has been placed. Signing up never grants
// membership; `requestJoin` is how they ask for it, and an admin approves.
export interface CompletedAuth {
  matched_organization: { id: string; name: string; logo_url: string | null; verified: boolean } | null;
  is_new_account: boolean;
  // Sends a join request to the matched institution, using the session this result
  // carries. Safe to call before `apply` - it establishes the token first.
  requestJoin: () => Promise<void>;
  // Establishes the session. DEFERRED on purpose: the moment auth context exists,
  // AppRoutes unmounts the sign-in page and redirects, so a "welcome to <org>"
  // screen would never get to render. The page calls this when the user moves on,
  // optionally naming where to land instead of the role's default home.
  apply: (landingPath?: string) => void;
}

export interface CompleteSignupBody {
  verification_token: string; name: string; phone: string; password: string;
}

const ACTIVE_ROLE_KEY = 'semp_active_role';

// Super admins can toggle between the platform shell and the regular user shell;
// everyone else only ever sees the user shell.
function rolesFor(ctx: AuthContext): AppRole[] {
  return ctx.user.is_super_admin ? ['system', 'user'] : ['user'];
}

const Ctx = createContext<AuthState>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ctx, setCtx] = useState<AuthContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRoleState] = useState<AppRole>('user');
  const [justLoggedIn, setJustLoggedIn] = useState(false);
  const [landingPath, setLandingPath] = useState<string | null>(null);

  const applyContext = (c: AuthContext) => {
    setCtx(c);
    const roles = rolesFor(c);
    const stored = localStorage.getItem(ACTIVE_ROLE_KEY) as AppRole | null;
    setActiveRoleState(stored && roles.includes(stored) ? stored : roles[0]);
  };

  const refresh = async () => {
    const c = await api<AuthContext>('GET', '/auth/me');
    applyContext(c);
  };

  useEffect(() => {
    if (!tokenStore.get()) { setLoading(false); return; }
    refresh().catch(() => tokenStore.clear()).finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api<{ token: string } & AuthContext>('POST', '/auth/login', { email, password });
    tokenStore.set(res.token);
    localStorage.removeItem(ACTIVE_ROLE_KEY);
    qc.clear(); // drop the previous user's cached queries so nothing leaks across sessions
    applyContext(res);
    setJustLoggedIn(true);
  };

  // Step 1 of email-first sign-in: which organisation owns this address's domain?
  // Pre-session and side-effect free, so it is safe to call as the user types.
  const identify = (email: string) => api<IdentifyResult>('POST', '/auth/identify', { email });

  // Step 2: send the one-time code for the purpose in hand.
  const requestOtp = (email: string, purpose: VerificationPurpose) =>
    api<OtpRequestResult>('POST', '/auth/otp/request', { email, purpose });

  // Step 3: check the code. A wrong one throws, so the caller can stay on the code
  // screen; a right one returns the ticket the final step redeems.
  const verifyOtp = (email: string, code: string, purpose: VerificationPurpose) =>
    api<VerifyOtpResult>('POST', '/auth/otp/verify', { email, code, purpose });

  // Shared tail of every flow that ends in a session. `apply` is deferred so the
  // welcome screen gets to render before AppRoutes redirects (see CompletedAuth).
  const completed = (res: { token: string } & AuthContext & Omit<CompletedAuth, 'apply' | 'requestJoin'>): CompletedAuth => ({
    matched_organization: res.matched_organization,
    is_new_account: res.is_new_account,
    requestJoin: async () => {
      const org = res.matched_organization;
      if (!org) return;
      // The token has to be in place for this call, but applying the whole context
      // would redirect away mid-request - so set just the credential and let the
      // caller decide when to move on.
      tokenStore.set(res.token);
      await api('POST', `/organizations/${org.id}/join`);
    },
    apply: (landingPath?: string) => {
      tokenStore.set(res.token);
      localStorage.removeItem(ACTIVE_ROLE_KEY);
      qc.clear();
      applyContext(res);
      setLandingPath(landingPath ?? null);
      setJustLoggedIn(true);
    },
  });

  const applyInviteSession = (res: { token: string } & AuthContext, landingPath?: string) => {
    tokenStore.set(res.token);
    localStorage.removeItem(ACTIVE_ROLE_KEY);
    qc.clear();
    applyContext(res);
    setLandingPath(landingPath ?? null);
    setJustLoggedIn(true);
  };

  // Step 4a: name, phone and a password of their own. The address rides in the
  // ticket, so it cannot be swapped between verifying and registering.
  const completeSignup = async (body: CompleteSignupBody): Promise<CompletedAuth> =>
    completed(await api('POST', '/auth/signup/complete', body));

  // Step 4b: a new password after a forgotten one, which also signs them in.
  const resetPassword = async (verificationToken: string, password: string): Promise<CompletedAuth> =>
    completed(await api('POST', '/auth/reset-password', { verification_token: verificationToken, password }));

  // Set a new password for the signed-in user. On a forced first-login reset the
  // current password isn't required (they just authenticated). Returns the fresh
  // context, which clears must_change_password.
  const changePassword = async (newPassword: string, currentPassword?: string) => {
    const c = await api<AuthContext>('POST', '/auth/change-password', {
      new_password: newPassword,
      ...(currentPassword ? { current_password: currentPassword } : {}),
    });
    applyContext(c);
    // A forced first-login reset clears the gate; land on the role's home rather
    // than whatever URL was active before, mirroring a fresh login.
    setJustLoggedIn(true);
  };

  const setActiveRole = (r: AppRole) => {
    localStorage.setItem(ACTIVE_ROLE_KEY, r);
    setActiveRoleState(r);
  };

  const logout = () => {
    tokenStore.clear();
    localStorage.removeItem(ACTIVE_ROLE_KEY);
    qc.clear(); // wipe cached data so the next user starts clean
    setCtx(null);
    setJustLoggedIn(false);
    setLandingPath(null);
  };

  const availableRoles = useMemo(() => (ctx ? rolesFor(ctx) : []), [ctx]);

  return (
    <Ctx.Provider value={{ ctx, loading, availableRoles, activeRole, setActiveRole, login, identify, requestOtp, verifyOtp, completeSignup, resetPassword, applyInviteSession, changePassword, refresh, logout, justLoggedIn, landingPath, clearJustLoggedIn: () => { setJustLoggedIn(false); setLandingPath(null); } }}>
      {children}
    </Ctx.Provider>
  );
}

export const ROLE_LABELS: Record<AppRole, string> = {
  system: 'System Admin',
  user: 'My Workspace',
};
