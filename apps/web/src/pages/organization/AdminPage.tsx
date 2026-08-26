import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { CapabilityKey } from '@semp/entitlements';
import { useAuth } from '../../lib/auth';
import { useWorkspace } from '../../lib/useWorkspace';
import { PageHeader, Spinner } from '../../components/ui';
import { CapabilityLock } from '../../components/CapabilityLock';
import { MembersPanel } from './admin/MembersPanel';
import { RolesPanel } from './admin/RolesPanel';
import { OrgProfilePanel } from './admin/OrgProfilePanel';
import { AuditLogPanel } from './admin/AuditLogPanel';
import { CampusesPanel } from './admin/CampusesPanel';
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
  { key: 'campuses', label: 'Campuses & Units', needs: 'multi_campus' },
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
  org_admin: ['profile', 'campuses', 'members', 'roles', 'security', 'audit'],
  sports_admin: ['profile', 'members', 'campuses', 'audit'],
  billing_admin: ['profile', 'billing'],
  reporting_admin: ['profile'],
  viewer: [],
};

const C = { line: '#E1E7F0', line2: '#C8D2E0', warn: '#E9920B', warnSoft: '#FCF0DB', fg4: '#6E7E96' };
const MONO = "'JetBrains Mono',ui-monospace,monospace";
const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";

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
        <p style={{ fontSize: 14, color: C.fg4 }}>
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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        {/* ---- the rail ---- */}
        <div style={{
          flex: '0 0 214px', minWidth: 170, background: '#fff',
          border: `1px solid ${C.line}`, borderRadius: 14, padding: 10,
        }}>
          {visible.map((t) => {
            const isActive = t.key === active.key;
            const isLocked = !!t.needs && !ws.granted.has(t.needs);
            return (
              <button
                key={t.key}
                onClick={() => setParams({ tab: t.key })}
                aria-current={isActive ? 'page' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', cursor: 'pointer',
                  padding: '10px 12px', borderRadius: 10, border: 'none', textAlign: 'left',
                  fontSize: 13.5, fontWeight: 600,
                  background: isActive ? '#004AAD' : 'transparent',
                  color: isActive ? '#fff' : '#374459',
                }}
              >
                <span style={{ flex: 1 }}>{t.label}</span>
                {isLocked && (
                  <span style={{
                    fontFamily: MONO, fontSize: 8.5, padding: '2px 5px', borderRadius: 4,
                    background: C.warnSoft, color: C.warn,
                  }}>PLAN</span>
                )}
              </button>
            );
          })}
        </div>

        {/* ---- the body ---- */}
        <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {locked ? <CapabilityLock capability={active.needs!} title={active.label} /> : (
            <>
              {active.key === 'profile' && <OrgProfilePanel orgId={orgId} />}
              {active.key === 'campuses' && <CampusesPanel orgId={orgId} />}
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
