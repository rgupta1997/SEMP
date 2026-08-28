import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { CapabilityKey } from '@semp/entitlements';
import { useAuth } from '../../lib/auth';
import { useWorkspace } from '../../lib/useWorkspace';
import { PageHeader, Spinner, SURFACE, cn } from '../../components/ui';
import { CapabilityLock } from '../../components/CapabilityLock';
import { MembersPanel } from './admin/MembersPanel';
import { RolesPanel } from './admin/RolesPanel';
import { OrgProfilePanel } from './admin/OrgProfilePanel';
import { AuditLogPanel } from './admin/AuditLogPanel';
import { PolicyPanel } from './admin/PolicyPanel';
import { BillingPanel } from './admin/BillingPanel';

// Administration (PG-28).
//
// A tab rail, not a row of pills: there are seven of them and they are settings
// rather than views, so a vertical list that can grow is the right shape.
//
// Which tabs appear is decided twice, exactly as the nav is. ROLE_ADMIN says whether
// the tab exists for this role at all - a Billing Admin has no business seeing that
// Campuses & Units is a thing. The capability gate then decides whether the tab
// OPENS, and a gated tab is shown carrying a PLAN chip rather than hidden.
//
// Note the prototype implements seven tabs; the page map lists ten. SSO, Integrations
// and Data & Privacy appear in ROLE_ADMIN and in no tab list, so they are not built
// here either - a tab that renders nothing is worse than one that is honestly absent.

interface Tab {
  key: string;
  label: string;
  needs?: CapabilityKey;
}

const TABS: Tab[] = [
  { key: 'profile', label: 'Organization Profile' },
  { key: 'members', label: 'Members' },
  { key: 'roles', label: 'Roles & Permissions' },
  { key: 'billing', label: 'Billing & Subscription' },
  { key: 'security', label: 'Security' },
  { key: 'audit', label: 'Audit Logs', needs: 'audit_logs' },
];

/** Which tabs each role may reach. `null` means all of them. */
const ROLE_ADMIN: Record<string, string[] | null> = {
  owner: null,
  super_admin: null,
  // Security is the Owner's alone: it is org-wide policy (2FA enforcement, IP
  // allowlist, session length), so an administrator who can be appointed - and
  // removed - by the Owner should not be able to relax the rules that bind them.
  org_admin: ['profile', 'members', 'roles', 'audit'],
  // NOT 'members'. A Sports Admin holds neither `org.member.manage` nor
  // `role.manage`, so that tab opened a screen whose every control - approve a join
  // request, give a role, suspend one - returned a 403. Deciding who belongs to the
  // institution and who administers it are the two things this role is deliberately
  // outside of; the people it DOES work with are on Players, which it reaches.
  sports_admin: ['profile', 'audit'],
  billing_admin: ['profile', 'billing'],
  reporting_admin: ['profile'],
  viewer: [],
};

// Written with theme tokens rather than the inline hex this file used to carry.
// The rail was `background: '#fff'` and `color: '#374459'`, which meant that in dark
// mode the whole of Administration - profile, campuses, members, roles, billing,
// security, audit - rendered as a white card on a near-black canvas. Every screen in
// this section sits behind this rail, so it was the single highest-leverage place to
// fix the theme.

export function AdminPage() {
  const { orgId = '' } = useParams();
  const { ctx } = useAuth();
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();

  const org = ws.contexts.find((c) => c.id === orgId);
  const roleCodes = org?.roleCodes ?? [];

  const visible = useMemo(() => {
    const codes = roleCodes.filter((c) => c in ROLE_ADMIN);
    if (codes.length === 0) return [];
    // Union across every role held, and an unrestricted role opens all of them.
    if (codes.some((c) => ROLE_ADMIN[c] === null)) return TABS;
    const allowed = new Set(codes.flatMap((c) => ROLE_ADMIN[c] ?? []));
    return TABS.filter((t) => allowed.has(t.key));
  }, [roleCodes.join(',')]);

  if (ws.loading) return <Spinner />;

  if (visible.length === 0) {
    return (
      <>
        <PageHeader title="Administration" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Your role in this organisation does not include any administration areas.
        </p>
      </>
    );
  }

  const wanted = params.get('tab');
  const active = visible.find((t) => t.key === wanted) ?? visible[0];
  const locked = !!active.needs && !ws.granted.has(active.needs);

  const orgName = ctx?.organizations?.find((m: any) => m.organization_id === orgId)?.organization?.name;

  return (
    <>
      <PageHeader title="Administration" subtitle={orgName ?? undefined} />

      <div className="flex flex-wrap items-start gap-[18px]">
        {/* ---- the rail ---- */}
        <nav
          aria-label="Administration sections"
          className={cn('w-full flex-none p-2.5 sm:w-[214px]', SURFACE)}
        >
          {visible.map((t) => {
            const isActive = t.key === active.key;
            const isLocked = !!t.needs && !ws.granted.has(t.needs);
            return (
              <button
                key={t.key}
                onClick={() => setParams({ tab: t.key })}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-[10px] border-none px-3 py-2.5 text-left text-[13.5px] font-semibold transition-colors duration-150',
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'bg-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                <span className="flex-1">{t.label}</span>
                {isLocked && (
                  <span className="rounded font-mono text-[8.5px] bg-eos-warn-soft px-[5px] py-[2px] text-eos-warn dark:bg-amber-900/40 dark:text-amber-300">
                    PLAN
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* ---- the body ---- */}
        <div className="flex min-w-0 flex-1 basis-[420px] flex-col gap-4">
          {locked ? <CapabilityLock capability={active.needs!} title={active.label} /> : (
            <>
              {active.key === 'profile' && <OrgProfilePanel orgId={orgId} />}
              {active.key === 'members' && <MembersPanel orgId={orgId} />}
              {active.key === 'roles' && <RolesPanel orgId={orgId} />}
              {active.key === 'billing' && <BillingPanel orgId={orgId} />}
              {active.key === 'security' && <PolicyPanel kind="security" orgId={orgId} />}
              {active.key === 'audit' && <AuditLogPanel orgId={orgId} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}
