import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Download, ExternalLink, Eye, Lock, Pencil, ShieldCheck, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { useWorkspace } from '../../lib/useWorkspace';
import { Badge, Button, Card, CardBody, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, toast } from '../../components/ui';
import { SheetPreview, openDoc } from '../organization/certificates/shared';
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

// Mirrors the server's HANDLE regex (profile.routes.ts) so a bad handle is
// caught before the round trip - the server stays the actual authority.
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/;

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
  id: string; serial: string; issued_at: string; revoked_at: string | null; superseded_at: string | null;
  token: string;
  payload?: { title?: string | null; sport?: string | null; recipient_name?: string | null } | null;
  organizations?: { name: string } | null; championships?: { name: string } | null;
}

const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid var(--line)', borderRadius: 14, padding: 20,
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid #EFF2F7',
};
const emptyStyle: React.CSSProperties = { margin: 0, fontSize: 13.5, color: 'var(--faint)' };

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
      <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--muted)' }}>Taken from the squads you belong to.</p>
      {bySport.size === 0 ? <p style={emptyStyle}>No sports yet — join a squad and they appear here.</p>
        : [...bySport.entries()].map(([sport, v]) => (
          <div key={sport} style={rowStyle}>
            <span style={{ flex: 1, fontFamily: POP, fontWeight: 700, fontSize: 14 }}>{sport}</span>
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)' }}>
              {v.teams} {v.teams === 1 ? 'team' : 'teams'} · {v.events} {v.events === 1 ? 'entry' : 'entries'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--faint)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>{t.name}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {[t.organizations?.short_name ?? t.organizations?.name, t.sports?.name].filter(Boolean).join(' · ')}
              </span>
            </span>
            {t.jersey_number != null && (
              <span style={{ fontFamily: MONO, fontSize: 13, color: 'var(--brand)' }}>#{t.jersey_number}</span>
            )}
            <Badge tone={t.membership_role === 'captain' ? 'amber' : 'slate'}>{titleCase(t.membership_role)}</Badge>
          </div>
        ))}
    </div>
  );
}

const DetailLine = ({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) => (
  <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', padding: '3px 0' }}>
    <dt style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--faint)', flexShrink: 0 }}>{label}</dt>
    <dd style={{
      margin: 0, textAlign: 'right', minWidth: 0, color: 'var(--ink-2)',
      fontFamily: mono ? MONO : undefined, fontSize: mono ? 12 : 13,
    }}>{children}</dd>
  </div>
);

/**
 * The holder's own copy.
 *
 * A certificate you can see the status of but not open is a receipt, not a document -
 * so every row carries the two things a holder actually needs (the artefact itself,
 * and a link a stranger can check) and the facts behind them. All of it goes through
 * /me/certificates/:id/render, which authorises by ownership rather than by
 * institution: nobody has to ask an administrator for their own certificate.
 */
function CertificateRow({ c }: { c: CertRow }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dead = !!(c.revoked_at || c.superseded_at);
  const verifyUrl = `${window.location.origin}/verify/${c.token}`;

  const copyVerify = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { toast.error('Could not copy the link', verifyUrl); }
  };

  return (
    <div style={{ borderTop: '1px solid #EFF2F7' }}>
      <div style={{ ...rowStyle, borderTop: 'none', flexWrap: 'wrap' }}>
        <span style={{ flex: '1 1 200px', minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>
            {c.payload?.title || c.championships?.name || 'Certificate'}
          </span>
          <span style={{ display: 'block', fontFamily: MONO, fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {c.serial} · {c.organizations?.name ?? ''}
          </span>
        </span>

        {/* A revoked certificate is shown, not removed. Somebody may be holding
            a copy, and silence about it is worse than saying it was withdrawn. */}
        <Badge tone={c.revoked_at ? 'rose' : c.superseded_at ? 'amber' : 'green'}>
          {c.revoked_at ? 'Revoked' : c.superseded_at ? 'Superseded' : 'Issued'}
        </Badge>

        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Button size="sm" variant="outline" onClick={() => openDoc(`/me/certificates/${c.id}/render`)}>
            <Eye size={13} aria-hidden />View
          </Button>
          <Button
            size="sm" variant="outline"
            onClick={() => openDoc(`/me/certificates/${c.id}/render?download=1`, { download: `${c.serial}.html` })}
          >
            <Download size={13} aria-hidden />Download
          </Button>
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            Details{open ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
          </Button>
        </span>
      </div>

      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start', padding: '4px 0 16px' }}>
          {/* The real render, at print geometry - so what is checked here is what
              prints, not a description of it. */}
          <SheetPreview path={`/me/certificates/${c.id}/render`} width={320} />

          <dl style={{ flex: '1 1 240px', minWidth: 0, margin: 0, fontSize: 13 }}>
            <DetailLine label="Serial" mono>{c.serial}</DetailLine>
            <DetailLine label="Issued to">{c.payload?.recipient_name ?? '—'}</DetailLine>
            <DetailLine label="Event">{c.championships?.name ?? '—'}</DetailLine>
            <DetailLine label="Sport">{c.payload?.sport ?? '—'}</DetailLine>
            <DetailLine label="Award">{c.payload?.title ?? '—'}</DetailLine>
            <DetailLine label="Issued by">{c.organizations?.name ?? '—'}</DetailLine>
            <DetailLine label="Issued on">{new Date(c.issued_at).toLocaleDateString()}</DetailLine>
            {c.revoked_at && <DetailLine label="Withdrawn">{new Date(c.revoked_at).toLocaleDateString()}</DetailLine>}

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {/* The public verify link, not a link into the app: sharing a certificate
                  means letting somebody else check it, and they have no account. */}
              <Button size="sm" variant="subtle" onClick={copyVerify}>
                {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                {copied ? 'Copied' : 'Copy verification link'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => window.open(`/verify/${c.token}`, '_blank', 'noopener')}>
                <ExternalLink size={13} aria-hidden />Verification page
              </Button>
            </div>
            {dead && (
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#B4405F' }}>
                This certificate no longer verifies. It still opens, stamped, so you can see what happened to it.
              </p>
            )}
          </dl>
        </div>
      )}
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
        : rows.map((c) => <CertificateRow key={c.id} c={c} />)}
    </div>
  );
}

const initials = (s: string) => s.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/**
 * Edits the whole CONTROLLED half in one place (tagline, preferred sports, handle) -
 * the three fields PATCH /me/identity has always accepted, with no UI anywhere
 * that called it before this. One modal rather than three inline editors: they are
 * one concept ("what I say about myself") and saving them together means one
 * request, one error state, one place to look.
 */
function EditProfileModal({ id, onClose, onSaved }: { id: Identity; onClose: () => void; onSaved: () => void }) {
  const [tagline, setTagline] = useState(id.controlled.tagline ?? '');
  const [sports, setSports] = useState<string[]>(id.controlled.preferred_sports);
  const [handleValue, setHandleValue] = useState(id.controlled.handle ?? '');
  const [handleError, setHandleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: sportsList } = useApi<Array<{ id: string; name: string }>>('/sports');

  const availableSports = (sportsList ?? []).filter((s) => !sports.includes(s.name));

  // A single action, not "pick then remember to click Add" - a picked value that
  // never gets clicked into the list is silently dropped on save with nothing
  // telling you it didn't count, which is exactly the shape of bug this replaces.
  const addSport = (name: string) => {
    if (!name || sports.length >= 12 || sports.includes(name)) return;
    setSports((prev) => [...prev, name]);
  };
  const removeSport = (name: string) => setSports((prev) => prev.filter((s) => s !== name));

  const save = async () => {
    const trimmedHandle = handleValue.trim().toLowerCase();
    // A handle already set is the profile's public address - clearing it here would
    // break a link somebody may already be holding, so this only ever adds or
    // corrects one, never removes it.
    if (trimmedHandle && !HANDLE_RE.test(trimmedHandle)) {
      setHandleError('Use 4-40 lowercase letters, numbers or hyphens');
      return;
    }
    setHandleError(null);
    setBusy(true);
    try {
      await api('PATCH', '/me/identity', {
        tagline: tagline.trim() || null,
        preferred_sports: sports,
        ...(trimmedHandle ? { handle: trimmedHandle } : {}),
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setHandleError(e?.message ?? 'Could not save changes');
    } finally { setBusy(false); }
  };

  return (
    <Modal
      title="Edit profile"
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      )}
    >
      <div className="grid gap-4">
        <Field label="Tagline" hint={`${tagline.length}/160 - a short line shown under your name.`}>
          <Textarea
            value={tagline}
            onChange={(e) => setTagline(e.target.value.slice(0, 160))}
            rows={2}
            placeholder="e.g. Right-arm off-spinner · Badminton doubles specialist"
          />
        </Field>

        {/* A plain div, not <Field>: Field wraps its content in a <label>, and a
            label containing SEVERAL interactive controls (every chip's remove
            button, plus the select below) makes the browser route a click
            anywhere in its empty space to the first one - so touching blank
            space near a chip was silently "clicking" that chip's remove button. */}
        <div className="mb-4 block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Preferred sports</span>
          {sports.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {sports.map((s) => (
                <Badge key={s} tone="slate">
                  <span className="flex items-center gap-1">
                    {s}
                    <button onClick={() => removeSport(s)} aria-label={`Remove ${s}`} className="cursor-pointer">
                      <X size={11} aria-hidden />
                    </button>
                  </span>
                </Badge>
              ))}
            </div>
          )}
          {sports.length < 12 && (
            // Picking a sport IS adding it - value stays reset to the placeholder
            // so choosing one always reads as "added another", not "now selected".
            <Select value="" onChange={(e) => addSport(e.target.value)} className="w-full">
              <option value="">Add a sport…</option>
              {availableSports.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </Select>
          )}
          <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
            {sports.length}/12 - sports you play, shown on your public profile.
          </span>
        </div>

        <Field label="Handle" hint="Becomes your public profile address: /p/your-handle - needed before your profile can go public.">
          <Input
            value={handleValue}
            onChange={(e) => { setHandleValue(e.target.value); setHandleError(null); }}
            placeholder="your-handle"
            maxLength={40}
            style={{ fontFamily: MONO }}
          />
          {handleError && <span className="mt-1 block text-xs text-rose-600 dark:text-rose-400">{handleError}</span>}
        </Field>
      </div>
    </Modal>
  );
}

function ProfileHeader({ id, onChanged }: { id: Identity; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [statsBusy, setStatsBusy] = useState(false);

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

  // A second, narrower gate under the profile toggle: public_profile shows the
  // identity card to a stranger, public_stats decides whether it also shows the
  // verified playing record (win/loss, medals, achievements). Only meaningful
  // once the profile itself is public, so it only renders alongside that toggle.
  const togglePublicStats = async () => {
    setStatsBusy(true);
    try {
      await api('PATCH', '/me/privacy', { public_stats: !id.privacy.public_stats });
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not change that');
    } finally { setStatsBusy(false); }
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
            width: 64, height: 64, borderRadius: 16, background: 'var(--brand)', color: '#fff',
            display: 'grid', placeItems: 'center', fontFamily: POP, fontWeight: 900, fontSize: 22,
          }}>{initials(id.name)}</span>

          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontFamily: POP, fontWeight: 900, fontSize: 24, margin: 0, letterSpacing: '-.02em' }}>{id.name}</h2>
              <button onClick={() => setEditOpen(true)} title="Edit profile" aria-label="Edit profile" style={{
                display: 'grid', placeItems: 'center', width: 26, height: 26, flexShrink: 0, cursor: 'pointer',
                borderRadius: 7, border: '1px solid var(--line)', background: '#fff', color: 'var(--muted)',
              }}>
                <Pencil size={12} aria-hidden />
              </button>
            </div>
            {id.controlled.tagline && (
              <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--ink-4)' }}>{id.controlled.tagline}</p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
              {/* The portable identity. Issued once and quoted everywhere - it is
                  what makes a record follow a person between institutions. */}
              <span style={{
                fontFamily: MONO, fontWeight: 700, fontSize: 12, letterSpacing: '.06em',
                padding: '4px 9px', borderRadius: 6, background: 'var(--brand-line)', color: 'var(--brand)',
              }}>{id.sportagon_id ?? 'ID pending'}</span>
              {id.officiates && <Badge tone="amber">Official</Badge>}
              {id.email_verified && id.phone_verified && <Badge tone="green">Verified contact</Badge>}
            </div>
            {id.controlled.preferred_sports.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {id.controlled.preferred_sports.map((s) => (
                  <span key={s} style={{
                    fontSize: 12, fontWeight: 500, padding: '3px 9px', borderRadius: 999,
                    border: '1px solid var(--line)', color: 'var(--ink-4)',
                  }}>{s}</span>
                ))}
              </div>
            )}
          </div>

          <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>
              {id.controlled.handle ? `@${id.controlled.handle}` : 'No handle set'}
            </span>

            {id.controlled.handle ? (
              <button onClick={togglePublic} disabled={busy} style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                padding: '8px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                border: `1px solid ${id.privacy.public_profile ? '#1E9E5A' : '#C8D2E0'}`,
                background: id.privacy.public_profile ? '#E4F6EC' : '#fff',
                color: id.privacy.public_profile ? '#1E6E45' : 'var(--ink-4)',
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
            ) : null}

            {id.controlled.handle && id.privacy.public_profile && (
              // Only worth showing once the profile itself is public - toggling
              // this while private would change a value nobody can see yet.
              <button onClick={togglePublicStats} disabled={statsBusy} style={{
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                border: 'none', background: 'none', padding: 0,
                fontSize: 11.5, color: id.privacy.public_stats ? '#1E6E45' : 'var(--muted)',
              }}>
                <span aria-hidden style={{
                  width: 24, height: 13, borderRadius: 999, position: 'relative', flexShrink: 0,
                  background: id.privacy.public_stats ? '#1E9E5A' : '#C8D2E0', transition: 'background .15s',
                }}>
                  <span style={{
                    position: 'absolute', top: 1.5, left: id.privacy.public_stats ? 12 : 1.5,
                    width: 10, height: 10, borderRadius: '50%', background: '#fff', transition: 'left .15s',
                  }} />
                </span>
                Show my stats publicly
              </button>
            )}

            {!id.controlled.handle && (
              // A handle is a URL, so it has to exist before the profile can go
              // public - the server refuses otherwise. Pointing straight at Edit
              // profile is what makes that fixable instead of a dead-end error.
              <button onClick={() => setEditOpen(true)} style={{
                fontSize: 11.5, color: 'var(--brand)', textAlign: 'right', maxWidth: 200,
                border: 'none', background: 'none', cursor: 'pointer', padding: 0,
              }}>
                Set a handle to make your profile public
              </button>
            )}

            {id.public_url && (
              <button onClick={copy} style={{
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', border: 'none',
                background: 'none', fontFamily: MONO, fontSize: 11.5, color: 'var(--brand)', padding: 0,
              }}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : id.public_url}
              </button>
            )}
          </div>
        </div>
      </CardBody>

      {editOpen && <EditProfileModal id={id} onClose={() => setEditOpen(false)} onSaved={onChanged} />}
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
        background: '#EFF2F7', color: 'var(--muted)', display: 'grid', placeItems: 'center',
      }}><Lock size={19} /></div>
      <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 18 }}>{label} needs advanced stats</div>
      <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 8, maxWidth: 400, marginInline: 'auto', lineHeight: 1.6 }}>
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
                border: `1px solid ${isActive ? 'var(--brand)' : 'var(--line)'}`,
                background: isActive ? 'var(--brand)' : '#fff',
                color: isActive ? '#fff' : 'var(--ink-4)',
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
          {/* Timeline and Achievements read the same lifetime record, but are no
              longer the same VIEW of it: Achievements keeps the Honours list
              (its whole point) plus the chronological history underneath;
              Timeline drops Honours so switching tabs actually shows something
              different, instead of two pills rendering identical content. */}
          {active.key === 'achievements' && <LifetimeRecordPage />}
          {active.key === 'timeline' && <LifetimeRecordPage hideHonours />}
          {active.key === 'sports' && <SportsTab />}
          {active.key === 'teams' && <TeamsTab />}
          {active.key === 'certificates' && <CertificatesTab />}
          {active.key === 'statistics' && <ParticipantDashboard />}
        </>
      )}
    </div>
  );
}
