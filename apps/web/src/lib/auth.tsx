import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from './api';
import { supabase } from './supabase';

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

export interface ChampionshipRef { id: string; name: string; slug: string; status: string }
export interface ChampionshipRole { id: string; championship_id: string; championship: ChampionshipRef; role: { id: string; name: string } }
export interface Membership { id: string; team_id: string; role: string; jersey_number: number | null; team: any }
export interface Organization { id: string; name: string; short_name?: string | null; code?: string | null; city?: string | null; logo_url?: string | null }
export interface OrgMembership { id: string; organization_id: string; organization: Organization; role: string; status: string; joined_at: string }

export interface AuthContext {
  user: AuthUser;
  organization: Organization | null;
  organizations: OrgMembership[];
  official_championship_ids: string[];
  championship_roles: ChampionshipRole[];
  memberships: Membership[];
}

interface AuthState {
  ctx: AuthContext | null;
  loading: boolean;
  availableRoles: AppRole[];
  activeRole: AppRole;
  setActiveRole: (r: AppRole) => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (body: SignupBody) => Promise<void>;
  changePassword: (newPassword: string, currentPassword?: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => void;
  // True right after an explicit login/signup so the router can land on the
  // role's home instead of the previous session's last-visited URL. (Not set on
  // initial token refresh, so deep links opened while signed in still work.)
  justLoggedIn: boolean;
  clearJustLoggedIn: () => void;
}

export interface SignupBody {
  name: string; email: string; password: string; phone?: string;
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
    // Supabase is created before login, when its custom access-token callback
    // cannot authenticate. Refresh it now so the first Realtime channel join
    // carries this user's token rather than the anon key.
    await supabase.realtime.setAuth();
    localStorage.removeItem(ACTIVE_ROLE_KEY);
    qc.clear(); // drop the previous user's cached queries so nothing leaks across sessions
    applyContext(res);
    setJustLoggedIn(true);
  };

  const signup = async (body: SignupBody) => {
    const res = await api<{ token: string } & AuthContext>('POST', '/auth/signup', body);
    tokenStore.set(res.token);
    await supabase.realtime.setAuth();
    localStorage.removeItem(ACTIVE_ROLE_KEY);
    qc.clear();
    applyContext(res);
    setJustLoggedIn(true);
  };

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
  };

  const availableRoles = useMemo(() => (ctx ? rolesFor(ctx) : []), [ctx]);

  return (
    <Ctx.Provider value={{ ctx, loading, availableRoles, activeRole, setActiveRole, login, signup, changePassword, refresh, logout, justLoggedIn, clearJustLoggedIn: () => setJustLoggedIn(false) }}>
      {children}
    </Ctx.Provider>
  );
}

export const ROLE_LABELS: Record<AppRole, string> = {
  system: 'System Admin',
  user: 'My Workspace',
};
