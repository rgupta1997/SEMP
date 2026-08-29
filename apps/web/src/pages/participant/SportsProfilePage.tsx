import { useState } from 'react';
import { Check, Copy, Lock, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useWorkspace } from '../../lib/useWorkspace';
import { Badge, Card, CardBody, PageHeader, Spinner, toast } from '../../components/ui';
import { ParticipantDashboard } from './ParticipantDashboard';
import { LifetimeRecordPage } from './LifetimeRecordPage';

// My Sports Profile (PG-12, F-046..F-050).
//
// The screen the whole Sportagon ID thesis rests on, so the split it draws matters
// more than the tabs do:
//
//   CONTROLLED  tagline, handle, preferred sports - the player's to say.
//   VERIFIED    participation, results, medals - written by locked scorecards and
//               editable by nobody, including the player and including the
//               institution that issued them.
//
// Rendering those as two visibly different things is the point. A profile where
// both look the same is a CV; a profile where the verified half is obviously not
// editable is a record.

const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

interface Identity {
  id: string;
  sportagon_id: string | null;
  name: string;
  email: string;
  officiates: boolean;
  email_verified: boolean;
  phone_verified: boolean;
  controlled: { handle: string | null; tagline: string | null; preferred_sports: string[]; avatar_url: string | null };
  privacy: { public_profile: boolean; public_stats: boolean; discoverable: boolean; verified_records_visible: boolean };
  public_url: string | null;
}

type TabKey = 'overview' | 'sports' | 'teams' | 'timeline' | 'statistics' | 'achievements' | 'certificates';

const TABS: Array<{ key: TabKey; label: string; needs?: 'advanced_stats' }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'sports', label: 'Sports' },
  { key: 'teams', label: 'Teams' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'statistics', label: 'Statistics', needs: 'advanced_stats' },
  { key: 'achievements', label: 'Achievements' },
  { key: 'certificates', label: 'Certificates' },
];


interface TeamRow {
  id: string; name: string; membership_role: string; jersey_number: number | null;
  sports?: { name: string } | null;
  organizations?: { name: string; short_name: string | null } | null;
  team_entries?: Array<{ championships?: { id: string; name: string; status: string } | null }>;
}

interface CertRow {
  id: string; serial: string; issued_at: string; revoked_at: string | null;
  organizations?: { name: string } | null; championships?: { name: string } | null;
}

const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #E1E7F0', borderRadius: 14, padding: 20,
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid #EFF2F7',
};
const emptyStyle: React.CSSProperties = { margin: 0, fontSize: 13.5, color: '#9BA9BE' };

/** Sports, derived from the squads this person is actually in. */
function SportsTab() {
  const { data, isLoading } = useApi<TeamRow[]>('/me/teams');
  if (isLoading) return <Spinner />;
  const rows = data ?? [];

  const bySport = new Map<string, { teams: number; orgs: Set<string>; events: number }>();
  for (const t of rows) {
    const key = t.sports?.name ?? 'Unspecified';
    const cur = bySport.get(key) ?? { teams: 0, orgs: new Set<string>(), events: 0 };
    cur.teams += 1;
    if (t.organizations?.name) cur.orgs.add(t.organizations.name);
    cur.events += (t.team_entries ?? []).length;
    bySport.set(key, cur);
  }

  return (
    <div style={cardStyle}>
      <h3 style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, margin: '0 0 4px' }}>Sports you play</h3>
      <p style={{ margin: '0 0 6px', fontSize: 13, color: '#6E7E96' }}>Taken from the squads you belong to.</p>
      {bySport.size === 0 ? <p style={emptyStyle}>No sports yet — join a squad and they appear here.</p>
        : [...bySport.entries()].map(([sport, v]) => (
          <div key={sport} style={rowStyle}>
            <span style={{ flex: 1, fontFamily: POP, fontWeight: 700, fontSize: 14 }}>{sport}</span>
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: '#6E7E96' }}>
              {v.teams} {v.teams === 1 ? 'team' : 'teams'} · {v.events} {v.events === 1 ? 'entry' : 'entries'}
            </span>
            <span style={{ fontSize: 12, color: '#9BA9BE', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[...v.orgs].join(', ')}
            </span>
          </div>
        ))}
    </div>
  );
}

function TeamsTab() {
  const { data, isLoading } = useApi<TeamRow[]>('/me/teams');
  if (isLoading) return <Spinner />;
  const rows = data ?? [];
  return (
    <div style={cardStyle}>
      <h3 style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, margin: '0 0 6px' }}>Squads</h3>
      {rows.length === 0 ? <p style={emptyStyle}>You are not in a squad yet.</p>
        : rows.map((t) => (
          <div key={t.id} style={rowStyle}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#14233B' }}>{t.name}</span>
              <span style={{ display: 'block', fontSize: 12, color: '#6E7E96', marginTop: 2 }}>
                {[t.organizations?.short_name ?? t.organizations?.name, t.sports?.name].filter(Boolean).join(' · ')}
              </span>
            </span>
            {t.jersey_number != null && (
              <span style={{ fontFamily: MONO, fontSize: 13, color: '#004AAD' }}>#{t.jersey_number}</span>
            )}
            <Badge tone={t.membership_role === 'captain' ? 'amber' : 'slate'}>{t.membership_role}</Badge>
          </div>
        ))}
    </div>
  );
}

function CertificatesTab() {
  const { data, isLoading } = useApi<{ rows: CertRow[] }>('/me/certificates');
  if (isLoading) return <Spinner />;
  const rows = data?.rows ?? [];
  return (
    <div style={cardStyle}>
      <h3 style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, margin: '0 0 6px' }}>Certificates</h3>
      {rows.length === 0 ? <p style={emptyStyle}>Certificates issued to you will appear here.</p>
        : rows.map((c) => (
          <div key={c.id} style={rowStyle}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#14233B' }}>
                {c.championships?.name ?? 'Certificate'}
              </span>
              <span style={{ display: 'block', fontFamily: MONO, fontSize: 11, color: '#6E7E96', marginTop: 2 }}>
                {c.serial} · {c.organizations?.name ?? ''}
              </span>
            </span>
            {/* A revoked certificate is shown, not removed. Somebody may be holding
                a copy, and silence about it is worse than saying it was withdrawn. */}
            <Badge tone={c.revoked_at ? 'rose' : 'green'}>{c.revoked_at ? 'Revoked' : 'Issued'}</Badge>
          </div>
        ))}
    </div>
  );
}

const initials = (s: string) => s.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function ProfileHeader({ id, onChanged }: { id: Identity; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const togglePublic = async () => {
    setBusy(true);
    try {
      await api('PATCH', '/me/privacy', { public_profile: !id.privacy.public_profile });
      onChanged();
    } catch (e: any) {
      // The API refuses to publish without a handle rather than inventing one -
      // a handle is a name people see, and picking it for someone is a poor
      // first impression. Surface that reason instead of a generic failure.
      toast.error(e?.message ?? 'Could not change that');
    } finally { setBusy(false); }
  };

  const copy = async () => {
    if (!id.public_url) return;
    await navigator.clipboard.writeText(`${window.location.origin}${id.public_url}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Card>
      {/* The hero panel carries a 64px tile and a 24px name, so it gets the wider
          inset - 20px reads as cramped against something that large. */}
      <CardBody className="sm:px-6 sm:pt-6 sm:pb-6">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          <span aria-hidden style={{
            width: 64, height: 64, borderRadius: 16, background: '#004AAD', color: '#fff',
            display: 'grid', placeItems: 'center', fontFamily: POP, fontWeight: 900, fontSize: 22,
          }}>{initials(id.name)}</span>

          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <h2 style={{ fontFamily: POP, fontWeight: 900, fontSize: 24, margin: 0, letterSpacing: '-.02em' }}>{id.name}</h2>
            {id.controlled.tagline && (
              <p style={{ margin: '4px 0 0', fontSize: 14, color: '#4F5F77' }}>{id.controlled.tagline}</p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
              {/* The portable identity. Issued once and quoted everywhere - it is
                  what makes a record follow a person between institutions. */}
              <span style={{
                fontFamily: MONO, fontWeight: 700, fontSize: 12, letterSpacing: '.06em',
                padding: '4px 9px', borderRadius: 6, background: '#DFEAFB', color: '#004AAD',
              }}>{id.sportagon_id ?? 'ID pending'}</span>
              {id.officiates && <Badge tone="amber">Official</Badge>}
              {id.email_verified && id.phone_verified && <Badge tone="green">Verified contact</Badge>}
            </div>
          </div>

          <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <button onClick={togglePublic} disabled={busy} style={{
              display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              padding: '8px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600,
              border: `1px solid ${id.privacy.public_profile ? '#1E9E5A' : '#C8D2E0'}`,
              background: id.privacy.public_profile ? '#E4F6EC' : '#fff',
              color: id.privacy.public_profile ? '#1E6E45' : '#4F5F77',
            }}>
              <span aria-hidden style={{
                width: 30, height: 16, borderRadius: 999, position: 'relative',
                background: id.privacy.public_profile ? '#1E9E5A' : '#C8D2E0', transition: 'background .15s',
              }}>
                <span style={{
                  position: 'absolute', top: 2, left: id.privacy.public_profile ? 16 : 2,
                  width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left .15s',
                }} />
              </span>
              {id.privacy.public_profile ? 'Public profile on' : 'Profile is private'}
            </button>

            {id.public_url && (
              <button onClick={copy} style={{
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', border: 'none',
                background: 'none', fontFamily: MONO, fontSize: 11.5, color: '#004AAD', padding: 0,
              }}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : id.public_url}
              </button>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/** The rule F-026 calls the trust anchor, rendered as a fact rather than a switch.
 *  `visible` comes from the server's own VERIFIED_RECORDS_VISIBLE constant
 *  (id.privacy.verified_records_visible) rather than being assumed here, so this
 *  banner can never say something the backend doesn't actually back up. */
function VerifiedRecordsNotice({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div style={{
      display: 'flex', gap: 11, alignItems: 'flex-start', padding: '13px 15px',
      borderRadius: 10, background: '#E4F6EC', border: '1px solid #C7E9D5',
    }}>
      <ShieldCheck size={17} style={{ flex: '0 0 auto', color: '#1E9E5A', marginTop: 1 }} />
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1E6E45' }}>Verified records are always visible</div>
        <div style={{ fontSize: 12.5, color: '#33604A', marginTop: 2, lineHeight: 1.55 }}>
          Results written by a locked scorecard cannot be edited or hidden — not by you, and not by the
          institution that issued them. That is what makes them worth something.
        </div>
      </div>
    </div>
  );
}

function LockedTab({ label }: { label: string }) {
  return (
    <div style={{
      background: '#fff', border: '1px dashed #C8D2E0', borderRadius: 14,
      padding: 44, textAlign: 'center',
    }}>
      <div aria-hidden style={{
        width: 42, height: 42, margin: '0 auto 14px', borderRadius: 11,
        background: '#EFF2F7', color: '#6E7E96', display: 'grid', placeItems: 'center',
      }}><Lock size={19} /></div>
      <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 18 }}>{label} needs advanced stats</div>
      <p style={{ fontSize: 13.5, color: '#6E7E96', marginTop: 8, maxWidth: 400, marginInline: 'auto', lineHeight: 1.6 }}>
        Your participation, results and certificates are all included. Detailed career statistics and a
        sports CV need <span style={{ fontFamily: MONO, fontSize: 12 }}>advanced_stats</span>.
      </p>
    </div>
  );
}

export function SportsProfilePage() {
  const [params, setParams] = useSearchParams();
  const { data: id, isLoading, refetch } = useApi<Identity>('/me/identity');
  const ws = useWorkspace();

  if (isLoading || !id) return <Spinner />;

  const active = (TABS.find((t) => t.key === params.get('tab')) ?? TABS[0]);
  const locked = !!active.needs && !ws.granted.has(active.needs);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 60 }}>
      <PageHeader title="My sports profile" subtitle="Who you are, and what the record says you have done." />

      <ProfileHeader id={id} onChanged={() => refetch()} />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const isLocked = !!t.needs && !ws.granted.has(t.needs);
          const isActive = t.key === active.key;
          return (
            <button key={t.key} onClick={() => setParams({ tab: t.key })}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                padding: '7px 13px', borderRadius: 999, fontSize: 13.5, fontWeight: 600,
                border: `1px solid ${isActive ? '#004AAD' : '#E1E7F0'}`,
                background: isActive ? '#004AAD' : '#fff',
                color: isActive ? '#fff' : '#4F5F77',
              }}>
              {t.label}
              {isLocked && <Lock size={11} style={{ opacity: 0.75 }} />}
            </button>
          );
        })}
      </div>

      {locked ? <LockedTab label={active.label} /> : (
        <>
          {active.key === 'overview' && (
            <>
              <VerifiedRecordsNotice visible={id.privacy.verified_records_visible} />
              <ParticipantDashboard />
            </>
          )}
          {/* Timeline and Achievements are two readings of the same lifetime
              record - the page badges provisional rows on both. */}
          {(active.key === 'timeline' || active.key === 'achievements') && <LifetimeRecordPage />}
          {active.key === 'sports' && <SportsTab />}
          {active.key === 'teams' && <TeamsTab />}
          {active.key === 'certificates' && <CertificatesTab />}
          {active.key === 'statistics' && <ParticipantDashboard />}
        </>
      )}
    </div>
  );
}
