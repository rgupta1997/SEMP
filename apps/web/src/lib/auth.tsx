import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from './api';

export type AppRole = 'system' | 'organiser' | 'institution' | 'official' | 'participant';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  avatar_url?: string | null;
  is_super_admin: boolean;
  account_type: string;
  institution_id: string | null;
}

export interface EventRef { id: string; name: string; slug: string; status: string }
export interface EventRole { id: string; event_id: string; event: EventRef; role: { id: string; name: string } }
export interface Membership { id: string; team_id: string; role: string; jersey_number: number | null; team: any }
export interface Institution { id: string; name: string; short_name?: string | null; code?: string | null; city?: string | null; logo_url?: string | null }

export interface AuthContext {
  user: AuthUser;
  institution: Institution | null;
  event_roles: EventRole[];
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
  refresh: () => Promise<void>;
  logout: () => void;
}

export interface SignupBody {
  name: string; email: string; password: string; phone?: string;
  account_type: 'organiser' | 'institution' | 'official' | 'participant';
  institution_id?: string; institution_name?: string;
}

const ROLE_PRIORITY: AppRole[] = ['system', 'organiser', 'institution', 'official', 'participant'];
const ACTIVE_ROLE_KEY = 'semp_active_role';

function rolesFor(ctx: AuthContext): AppRole[] {
  const set = new Set<AppRole>();
  if (ctx.user.is_super_admin) {
    // Super admins can preview every shell.
    return [...ROLE_PRIORITY];
  }
  // A POC (institution account) administers their institution and never plays;
  // they are deliberately kept out of the participant shell.
  const isPoc = ctx.user.account_type === 'institution';
  const t = ctx.user.account_type as AppRole;
  if (['organiser', 'institution', 'official', 'participant'].includes(t)) set.add(t);
  if (ctx.event_roles.some((r) => r.role.name === 'Organiser')) set.add('organiser');
  // The institution (admin) shell is for POCs (account_type 'institution', added
  // above) and team captains only — NOT for every participant who merely belongs
  // to an institution. Otherwise a POC-created participant could open the admin UI.
  if (ctx.memberships.some((m) => m.role === 'captain' || m.role === 'vice_captain')) set.add('institution');
  if (ctx.event_roles.some((r) => r.role.name === 'Official')) set.add('official');
  if (!isPoc) set.add('participant'); // every non-POC user is at least a participant
  return ROLE_PRIORITY.filter((r) => set.has(r));
}

const Ctx = createContext<AuthState>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ctx, setCtx] = useState<AuthContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRoleState] = useState<AppRole>('participant');

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
  };

  const signup = async (body: SignupBody) => {
    const res = await api<{ token: string } & AuthContext>('POST', '/auth/signup', body);
    tokenStore.set(res.token);
    localStorage.removeItem(ACTIVE_ROLE_KEY);
    qc.clear();
    applyContext(res);
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
  };

  const availableRoles = useMemo(() => (ctx ? rolesFor(ctx) : []), [ctx]);

  return (
    <Ctx.Provider value={{ ctx, loading, availableRoles, activeRole, setActiveRole, login, signup, refresh, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export const ROLE_LABELS: Record<AppRole, string> = {
  system: 'System Admin',
  organiser: 'Organiser',
  institution: 'Institution',
  official: 'Official',
  participant: 'Participant',
};
