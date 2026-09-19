// Every localStorage/sessionStorage read and write outside auth.tsx and
// useWorkspace.ts (those two coordinate around one shared 'semp_context:' key
// prefix and already explain, in place, why they can't import from here without
// creating a circular import) - pulled into one file so a call site reuses a
// named function instead of touching the Storage API and a raw key string
// directly. Every write is wrapped for private-mode browsers, which throw on
// `setItem` rather than silently no-op.

const AUTH_TOKEN_KEY = 'semp_token';
const THEME_KEY = 'semp_theme';
const SIDEBAR_RAILED_KEY = 'semp_sidebar_railed';

/** The signed-in session token. Also read directly (not via api.ts's `api()`
 *  helper) by anything fetching an authenticated document, e.g. a certificate
 *  render - see apps/web/src/pages/organization/certificates/shared.tsx. */
export const authToken = {
  get: (): string | null => localStorage.getItem(AUTH_TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(AUTH_TOKEN_KEY, token),
  clear: (): void => localStorage.removeItem(AUTH_TOKEN_KEY),
};

/** The header every authenticated fetch outside `api()` needs. */
export const authHeader = (): { Authorization: string } => ({ Authorization: `Bearer ${authToken.get() ?? ''}` });

export const themeStorage = {
  get: (): string | null => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } },
  set: (theme: string): void => { try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ } },
};

/** The desktop sidebar's collapsed/expanded rail state - a workspace
 *  preference, not a per-page one. */
export const sidebarRailed = {
  get: (): boolean => { try { return localStorage.getItem(SIDEBAR_RAILED_KEY) === '1'; } catch { return false; } },
  set: (railed: boolean): void => { try { localStorage.setItem(SIDEBAR_RAILED_KEY, railed ? '1' : '0'); } catch { /* private mode */ } },
};

/** A generic collapsed/expanded flag under a caller-supplied key - e.g. one
 *  "Getting started" card's storageKey prop, distinct per role/page. */
export const collapsedFlag = {
  get: (key: string): boolean => { try { return localStorage.getItem(key) === '1'; } catch { return false; } },
  set: (key: string, collapsed: boolean): void => { try { localStorage.setItem(key, collapsed ? '1' : '0'); } catch { /* private mode */ } },
};

const newTeamIdsKey = (orgId: string) => `bulk-new-team-ids:${orgId}`;

/** Teams created by a bulk wizard action, kept only for this browser session
 *  so a "New" badge can tell them apart from teams the wizard reused - not
 *  persisted server-side, since it's a viewing aid for whoever just ran the
 *  wizard, not a fact about the team. */
export const newTeamIds = {
  read: (orgId: string): Set<string> => {
    try { return new Set(JSON.parse(sessionStorage.getItem(newTeamIdsKey(orgId)) ?? '[]')); } catch { return new Set(); }
  },
  save: (orgId: string, ids: Iterable<string>): void => {
    try { sessionStorage.setItem(newTeamIdsKey(orgId), JSON.stringify([...ids])); } catch { /* private mode etc. */ }
  },
};
