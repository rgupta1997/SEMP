import { useEffect, useState, type ReactNode } from 'react';
import { SportStatsPanel } from '../../features/stats/SportStatsPanel';
import { AtSign, Award, BarChart3, Check, ChevronDown, ChevronUp, Copy, Download, ExternalLink, Eye, Globe, History, LayoutGrid, Lock, Medal, Pencil, Share2, ShieldCheck, Trophy, Users, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { JERSEY_NUMBER_MAX, JERSEY_NUMBER_MIN, isJerseyNumber } from '@semp/shared';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { usePageTitle } from '../../lib/pageTitle';
import { useWorkspace } from '../../lib/useWorkspace';
import { Button, EmptyState, Field, Input, Modal, PillPagination, Textarea, cn, toast } from '../../components/ui';
import { PickList } from '../../components/PickList';
import { SheetPreview, openDoc, downloadCertificate } from '../organization/certificates/shared';
import { ParticipantDashboard } from './ParticipantDashboard';
import { LifetimeRecordPage } from './LifetimeRecordPage';
import { publicUrl, openPublic } from '../../lib/native';
import { ViewTabs, TeamAvatar } from '../../features/schedule/ScheduleParts';
import { KitStripes } from '../../features/personal/MatchParts';
import { PlayerBadge } from '../../features/personal/PlayerBadge';
import { useSportIcon } from '../../features/personal/SportFilter';
import { HEX_CLIP, PERSONAL_NAVY, TEAL_TILE } from '../../features/personal/styles';
import type { CareerStatsData } from '../../components/participant/types';

// My Sports Profile (PG-12, F-046..F-050).
//
// The split this screen draws matters more than its tabs:
//   CONTROLLED  tagline, handle, preferred sports - the player's to say.
//   VERIFIED    participation, results, medals - written by locked scorecards and
//               editable by nobody, including the player and the issuing institution.
// A profile where both look the same is a CV; one where the verified half is
// obviously not editable is a record.

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
  controlled: { handle: string | null; tagline: string | null; preferred_sports: string[]; jersey_number: number | null; avatar_url: string | null };
  privacy: { public_profile: boolean; public_stats: boolean; discoverable: boolean; verified_records_visible: boolean };
  public_url: string | null;
}

type TabKey = 'overview' | 'sports' | 'teams' | 'timeline' | 'statistics' | 'achievements' | 'certificates';

const TABS: Array<{ key: TabKey; label: string; needs?: 'advanced_stats' }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'sports', label: 'Sports' },
  { key: 'teams', label: 'Teams' },
  { key: 'timeline', label: 'Timeline' },
  // Not gated: your own record of your own matches is not a premium feature.
  // Flagged Beta so a stats bug reads as one, not as the permanent record being wrong.
  { key: 'statistics', label: 'Statistics (Beta)' },
  { key: 'achievements', label: 'Achievements' },
  { key: 'certificates', label: 'Certificates' },
];

interface TeamRow {
  id: string; name: string; membership_role: string; jersey_number: number | null;
  sports?: { name: string; icon?: string | null } | null;
  organizations?: { name: string; short_name: string | null } | null;
  team_entries?: Array<{ championships?: { id: string; name: string; status: string } | null }>;
}

interface CertRow {
  id: string; serial: string; issued_at: string; revoked_at: string | null; superseded_at: string | null;
  token: string;
  payload?: { title?: string | null; sport?: string | null; recipient_name?: string | null } | null;
  organizations?: { name: string } | null; championships?: { name: string } | null;
}

const CARD = 'overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
const CARD_HEAD = 'flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800';
const CHIP = 'rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider';
const CHIP_SLATE = 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
const BTN_SM = 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-slate-200 text-slate-700 transition hover:ring-[var(--accent-deep)]/40 hover:text-[var(--accent-deep)] dark:text-slate-200 dark:ring-slate-700';
const PAGE_SIZE = 8;
const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

function CardTitle({ icon: Icon, title, sub }: { icon: typeof Users; title: string; sub?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-xl', TEAL_TILE)}><Icon size={16} aria-hidden /></span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{title}</span>
        {sub && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{sub}</span>}
      </span>
    </span>
  );
}

const ListSkeleton = () => (
  <div className="grid gap-3 sm:grid-cols-2" role="status" aria-label="Loading">
    {[0, 1, 2, 3].map((i) => <span key={i} className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}
  </div>
);

/** Sports, derived from the squads this person is actually in. */
function SportsTab() {
  const { data, isLoading } = useApi<TeamRow[]>('/me/teams');
  const iconOf = useSportIcon();
  const [page, setPage] = useState(0);
  if (isLoading) return <ListSkeleton />;
  const rows = data ?? [];

  const bySport = new Map<string, { icon: string | null; teams: number; orgs: Set<string>; events: number }>();
  for (const t of rows) {
    const key = t.sports?.name ?? 'Unspecified';
    const cur = bySport.get(key) ?? { icon: t.sports?.icon ?? null, teams: 0, orgs: new Set<string>(), events: 0 };
    cur.teams += 1;
    if (t.organizations?.name) cur.orgs.add(t.organizations.name);
    cur.events += (t.team_entries ?? []).length;
    bySport.set(key, cur);
  }
  const sports = [...bySport.entries()];
  if (sports.length === 0) return <EmptyState icon={<Award size={22} />} title="No sports yet" description="Join a squad and the sports you play appear here." />;
  const shown = sports.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 dark:text-slate-400">Taken from the squads you belong to.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map(([sport, v]) => (
          <div key={sport} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#0a1630] text-2xl" aria-hidden>{v.icon || iconOf(sport)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-black text-slate-900 dark:text-slate-100">{sport}</span>
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{[...v.orgs].join(', ') || 'No organisation'}</span>
            </span>
            <span className="flex shrink-0 gap-3 text-center">
              {([['Teams', v.teams], ['Entries', v.events]] as const).map(([k, n]) => (
                <span key={k}><span className="block text-lg font-black tabular-nums text-slate-900 dark:text-slate-100">{n}</span><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{k}</span></span>
              ))}
            </span>
          </div>
        ))}
      </div>
      <PillPagination page={page} pageCount={Math.ceil(sports.length / PAGE_SIZE)} total={sports.length} pageSize={PAGE_SIZE} onPage={setPage} noun="sport" />
    </div>
  );
}

function TeamsTab() {
  const { data, isLoading } = useApi<TeamRow[]>('/me/teams');
  const iconOf = useSportIcon();
  const [page, setPage] = useState(0);
  if (isLoading) return <ListSkeleton />;
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState icon={<Users size={22} />} title="You are not in a squad yet" description="The squads you play for appear here." />;
  const shown = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((t) => {
          const captain = t.membership_role === 'captain';
          const events = (t.team_entries ?? []).map((e) => e.championships?.name).filter(Boolean) as string[];
          return (
            <div key={t.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <span className="relative shrink-0">
                <TeamAvatar name={t.name} short={t.organizations?.short_name} />
                <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-white text-[11px] shadow ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700" aria-hidden>{t.sports?.icon || iconOf(t.sports?.name)}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{t.name}</span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{[t.organizations?.short_name ?? t.organizations?.name, t.sports?.name].filter(Boolean).join(' · ')}</span>
                {events.length > 0 && <span className="block truncate text-[11px] text-slate-400" title={events.join(', ')}>{events.join(' · ')}</span>}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className={cn('inline-flex items-center gap-1', CHIP, captain ? 'bg-[var(--accent)] text-slate-950' : CHIP_SLATE)}>
                  {captain && <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-slate-950 text-[8px] text-[var(--accent)]" aria-hidden>C</span>}
                  {titleCase(t.membership_role)}
                </span>
                {t.jersey_number != null && <span className="rounded-md bg-[#0a1630] px-1.5 py-0.5 text-[11px] font-black tabular-nums text-white" title="Squad shirt number">#{t.jersey_number}</span>}
              </span>
            </div>
          );
        })}
      </div>
      <PillPagination page={page} pageCount={Math.ceil(rows.length / PAGE_SIZE)} total={rows.length} pageSize={PAGE_SIZE} onPage={setPage} noun="squad" />
    </div>
  );
}

const DetailLine = ({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) => (
  <div className="flex justify-between gap-3 py-1">
    <dt className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
    <dd className={cn('min-w-0 text-right text-slate-700 dark:text-slate-200', mono ? 'text-xs' : 'text-[13px]')} style={mono ? { fontFamily: MONO } : undefined}>{children}</dd>
  </div>
);

/**
 * The holder's own copy: the certificate itself, a link a stranger can check, and the facts
 * behind them. All of it goes through /me/certificates/:id/render, authorised by ownership.
 */
function CertificateRow({ c }: { c: CertRow }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dead = !!(c.revoked_at || c.superseded_at);
  const verifyUrl = publicUrl(`/verify/${c.token}`);

  const copyVerify = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { toast.error('Could not copy the link', verifyUrl); }
  };

  return (
    <div className="border-t border-slate-100 first:border-t-0 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', dead ? 'bg-slate-100 text-slate-400 dark:bg-slate-800' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300')}><Award size={18} aria-hidden /></span>
        <span className="min-w-0 flex-[1_1_200px]">
          <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{c.payload?.title || c.championships?.name || 'Certificate'}</span>
          <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400" style={{ fontFamily: MONO }}>{c.serial} · {c.organizations?.name ?? ''}</span>
        </span>
        {/* A revoked certificate is shown, not removed: someone may hold a copy. */}
        <span className={cn(CHIP, c.revoked_at ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200' : c.superseded_at ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200')}>
          {c.revoked_at ? 'Revoked' : c.superseded_at ? 'Superseded' : 'Issued'}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={BTN_SM} onClick={() => openDoc(`/me/certificates/${c.id}/render`)}><Eye size={13} aria-hidden />View</button>
          <button type="button" className={BTN_SM} onClick={() => downloadCertificate(`/me/certificates/${c.id}/render`, c.serial, 'pdf')}><Download size={13} aria-hidden />PDF</button>
          <button type="button" className={BTN_SM} onClick={() => downloadCertificate(`/me/certificates/${c.id}/render`, c.serial, 'png')}><Download size={13} aria-hidden />PNG</button>
          <button type="button" className={BTN_SM} aria-expanded={open} onClick={() => setOpen((v) => !v)}>Details{open ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}</button>
        </span>
      </div>

      {open && (
        <div className="flex flex-wrap items-start gap-5 bg-slate-50/70 px-4 py-4 dark:bg-slate-800/30">
          {/* The real render, at print geometry - what is checked here is what prints. */}
          <SheetPreview path={`/me/certificates/${c.id}/render`} width={320} />
          <dl className="min-w-0 flex-[1_1_240px]">
            <DetailLine label="Serial" mono>{c.serial}</DetailLine>
            <DetailLine label="Issued to">{c.payload?.recipient_name ?? '-'}</DetailLine>
            <DetailLine label="Event">{c.championships?.name ?? '-'}</DetailLine>
            <DetailLine label="Sport">{c.payload?.sport ?? '-'}</DetailLine>
            <DetailLine label="Award">{c.payload?.title ?? '-'}</DetailLine>
            <DetailLine label="Issued by">{c.organizations?.name ?? '-'}</DetailLine>
            <DetailLine label="Issued on">{new Date(c.issued_at).toLocaleDateString()}</DetailLine>
            {c.revoked_at && <DetailLine label="Withdrawn">{new Date(c.revoked_at).toLocaleDateString()}</DetailLine>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {/* The public verify link: sharing a certificate means letting someone without an account check it. */}
              <button type="button" className={BTN_SM} onClick={copyVerify}>{copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}{copied ? 'Copied' : 'Copy verification link'}</button>
              <button type="button" className={BTN_SM} onClick={() => openPublic(`/verify/${c.token}`)}><ExternalLink size={13} aria-hidden />Verification page</button>
            </div>
            {dead && <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">This certificate no longer verifies. It still opens, stamped, so you can see what happened to it.</p>}
          </dl>
        </div>
      )}
    </div>
  );
}

function CertificatesTab() {
  const { data, isLoading } = useApi<{ rows: CertRow[] }>('/me/certificates');
  const [page, setPage] = useState(0);
  if (isLoading) return <ListSkeleton />;
  const rows = data?.rows ?? [];
  if (rows.length === 0) return <EmptyState icon={<Award size={22} />} title="No certificates yet" description="Certificates issued to you will appear here." />;
  const shown = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return (
    <div className="space-y-3">
      <section className={CARD}>
        <div className={CARD_HEAD}><CardTitle icon={Award} title="Certificates" sub={plural(rows.length, 'certificate')} /></div>
        {shown.map((c) => <CertificateRow key={c.id} c={c} />)}
      </section>
      <PillPagination page={page} pageCount={Math.ceil(rows.length / PAGE_SIZE)} total={rows.length} pageSize={PAGE_SIZE} onPage={setPage} noun="certificate" />
    </div>
  );
}

/**
 * Edits the whole CONTROLLED half in one place (tagline, preferred sports, shirt number,
 * handle): one concept, one request, one error state.
 */
function EditProfileModal({ id, onClose, onSaved }: { id: Identity; onClose: () => void; onSaved: () => void }) {
  const [tagline, setTagline] = useState(id.controlled.tagline ?? '');
  const [sports, setSports] = useState<string[]>(id.controlled.preferred_sports);
  const [handleValue, setHandleValue] = useState(id.controlled.handle ?? '');
  const [handleError, setHandleError] = useState<string | null>(null);
  const [jersey, setJersey] = useState(id.controlled.jersey_number?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const { data: sportsList } = useApi<Array<{ id: string; name: string }>>('/sports');

  const availableSports = (sportsList ?? []).filter((s) => !sports.includes(s.name));

  // Debounced live availability check, skipped for the current handle or a malformed one.
  const [debouncedHandle, setDebouncedHandle] = useState(handleValue);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedHandle(handleValue), 400);
    return () => clearTimeout(t);
  }, [handleValue]);
  const normalizedHandle = debouncedHandle.trim().toLowerCase();
  const currentHandle = (id.controlled.handle ?? '').toLowerCase();
  const shouldCheckHandle = normalizedHandle.length > 0 && normalizedHandle !== currentHandle && HANDLE_RE.test(normalizedHandle);
  const { data: availability, isFetching: checkingHandle } = useApi<{ available: boolean }>(
    shouldCheckHandle ? `/me/identity/handle-availability?handle=${encodeURIComponent(normalizedHandle)}` : null,
  );
  const handleTaken = shouldCheckHandle && availability?.available === false;

  // Picking IS adding: a picked value that never gets clicked in would be silently dropped.
  const addSport = (name: string) => {
    if (!name || sports.length >= 12 || sports.includes(name)) return;
    setSports((prev) => [...prev, name]);
  };
  const removeSport = (name: string) => setSports((prev) => prev.filter((s) => s !== name));

  const save = async () => {
    const trimmedHandle = handleValue.trim().toLowerCase();
    // A set handle is the profile's public address, so this only adds or corrects one, never removes it.
    if (trimmedHandle && !HANDLE_RE.test(trimmedHandle)) {
      setHandleError('Use 4-40 lowercase letters, numbers or hyphens');
      return;
    }
    if (trimmedHandle && trimmedHandle === normalizedHandle && handleTaken) {
      setHandleError('That handle is already taken');
      return;
    }
    const jerseyNumber = jersey.trim() === '' ? null : Number(jersey);
    if (jerseyNumber != null && !isJerseyNumber(jerseyNumber)) {
      setHandleError(`Jersey number must be a whole number from ${JERSEY_NUMBER_MIN} to ${JERSEY_NUMBER_MAX}`);
      return;
    }
    setHandleError(null);
    setBusy(true);
    try {
      await api('PATCH', '/me/identity', {
        tagline: tagline.trim() || null,
        preferred_sports: sports,
        jersey_number: jerseyNumber,
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
          <Textarea value={tagline} onChange={(e) => setTagline(e.target.value.slice(0, 160))} rows={2}
            placeholder="e.g. Right-arm off-spinner · Badminton doubles specialist" />
        </Field>

        {/* A plain div, not <Field>: a <label> around several controls routes stray clicks to the first chip's remove button. */}
        <div className="mb-4 block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Preferred sports</span>
          {sports.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {sports.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2.5 py-1 text-xs font-bold text-[var(--accent-deep)] dark:text-[var(--accent)]">
                  {s}
                  <button type="button" onClick={() => removeSport(s)} aria-label={`Remove ${s}`} className="rounded-full p-0.5 hover:bg-[var(--accent)]/25"><X size={11} aria-hidden /></button>
                </span>
              ))}
            </div>
          )}
          {sports.length < 12 && (
            // Value stays empty, so choosing one always reads as "added another", not "now selected".
            <PickList value="" onChange={addSport} placeholder="Add a sport…" searchPlaceholder="Search sports" ariaLabel="Add a sport"
              options={availableSports.map((s) => ({ value: s.name, label: s.name }))} />
          )}
          <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">{sports.length}/12 - sports you play, shown on your public profile.</span>
        </div>

        <Field label="Jersey number" hint="Your usual number. Scorers see it on the team sheet and can change it for a single match.">
          <Input type="number" inputMode="numeric" min={JERSEY_NUMBER_MIN} max={JERSEY_NUMBER_MAX} value={jersey}
            onChange={(e) => { setJersey(e.target.value); setHandleError(null); }}
            placeholder="e.g. 10" className="w-28" style={{ fontFamily: MONO }} data-qa="profile-jersey" />
        </Field>

        <Field label="Handle" hint="Becomes your public profile address: /p/your-handle - needed before your profile can go public.">
          <Input value={handleValue} onChange={(e) => { setHandleValue(e.target.value); setHandleError(null); }}
            placeholder="your-handle" maxLength={40} style={{ fontFamily: MONO }} />
          {handleError ? (
            <span className="mt-1 block text-xs text-rose-600 dark:text-rose-400">{handleError}</span>
          ) : shouldCheckHandle && checkingHandle ? (
            <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">Checking availability…</span>
          ) : handleTaken ? (
            <span className="mt-1 block text-xs text-rose-600 dark:text-rose-400">That handle is already taken</span>
          ) : shouldCheckHandle && availability?.available ? (
            <span className="mt-1 block text-xs text-emerald-600 dark:text-emerald-400">Available</span>
          ) : null}
        </Field>
      </div>
    </Modal>
  );
}

/** An on/off row for the visibility pop-up. */
function SwitchRow({ on, label, hint, onClick, disabled }: { on: boolean; label: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} disabled={disabled}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-800 dark:hover:bg-slate-800/40">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{label}</span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>
      </span>
      <span aria-hidden className={cn('relative h-5 w-9 shrink-0 rounded-full transition', on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </span>
    </button>
  );
}

/** Who can see the profile: the two switches, the public link, and the rule verified records live by. */
function VisibilityModal({ id, onClose, onChanged, onEdit, onShare, copied }: {
  id: Identity; onClose: () => void; onChanged: () => void; onEdit: () => void; onShare: () => void; copied: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [statsBusy, setStatsBusy] = useState(false);
  const togglePublic = async () => {
    setBusy(true);
    try {
      await api('PATCH', '/me/privacy', { public_profile: !id.privacy.public_profile });
      onChanged();
    } catch (e: any) {
      // The API refuses to publish without a handle rather than inventing one; say why.
      toast.error(e?.message ?? 'Could not change that');
    } finally { setBusy(false); }
  };
  // Narrower gate: whether the public page also shows the verified record.
  const togglePublicStats = async () => {
    setStatsBusy(true);
    try {
      await api('PATCH', '/me/privacy', { public_stats: !id.privacy.public_stats });
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not change that');
    } finally { setStatsBusy(false); }
  };
  return (
    <Modal title="Profile visibility" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-3">
        {id.controlled.handle ? (
          <>
            <SwitchRow on={id.privacy.public_profile} disabled={busy} onClick={togglePublic} label="Public profile"
              hint={id.privacy.public_profile ? 'Anyone with the link can see it' : 'Only you can see it'} />
            {/* Only once public - while private it changes nothing anyone sees. */}
            {id.privacy.public_profile && (
              <SwitchRow on={id.privacy.public_stats} disabled={statsBusy} onClick={togglePublicStats} label="Show my stats"
                hint="Results, medals and records on the public page" />
            )}
            {id.public_url && (
              <button type="button" onClick={onShare} className="flex w-full items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-left text-xs text-[var(--accent-deep)] hover:bg-slate-100 dark:bg-slate-800/50 dark:text-[var(--accent)]" style={{ fontFamily: MONO }}>
                {copied ? <Check size={14} className="shrink-0" /> : <Copy size={14} className="shrink-0" />}<span className="truncate">{copied ? 'Link copied' : publicUrl(id.public_url)}</span>
              </button>
            )}
          </>
        ) : (
          // A handle is the profile's address, so it has to exist before the profile can go public.
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
            Your profile is private. Pick a handle to give it a public address.
            <button type="button" onClick={() => { onClose(); onEdit(); }} className="mt-2 flex items-center gap-1 text-[13px] font-bold text-[var(--accent-deep)] dark:text-[var(--accent)]"><AtSign size={14} aria-hidden />Set a handle</button>
          </div>
        )}
        {/* F-026's trust anchor, as a fact rather than a switch. The server says whether it holds. */}
        {id.privacy.verified_records_visible && (
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900/80 dark:bg-emerald-500/10 dark:text-emerald-200/80">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <span><span className="font-black text-emerald-800 dark:text-emerald-200">Verified records always show.</span> Results written by a locked scorecard cannot be edited or hidden - not by you, and not by the institution that issued them.</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

function AthleteBanner({ id, onEdit, onShare, copied, onChanged }: { id: Identity; onEdit: () => void; onShare: () => void; copied: boolean; onChanged: () => void }) {
  const iconOf = useSportIcon();
  const [visOpen, setVisOpen] = useState(false);
  const isPublic = !!id.controlled.handle && id.privacy.public_profile;
  const words = id.name.trim().split(/\s+/);
  const first = words.length > 1 ? words.slice(0, -1).join(' ') : '';
  const last = words[words.length - 1] ?? id.name;
  const mark = id.controlled.jersey_number != null ? String(id.controlled.jersey_number) : words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <section className={cn('relative overflow-hidden rounded-3xl text-white shadow-xl', PERSONAL_NAVY)}>
      <KitStripes />
      {/* The shirt number (or initials) as a giant watermark behind the portrait. */}
      <span aria-hidden className="pointer-events-none absolute -right-2 top-1/2 -translate-y-1/2 select-none text-[110px] font-black leading-none tracking-tighter text-white/[0.05] sm:text-[160px]">{mark}</span>
      <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--accent)] via-[var(--accent-deep)] to-transparent" />

      <div className="relative flex items-start justify-between gap-2 px-5 pt-4 sm:px-7">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
          Sportagon athlete <span className="text-white/35">·</span> <span style={{ fontFamily: MONO }}>{id.sportagon_id ?? 'ID pending'}</span>
        </span>
        <div className="flex flex-wrap justify-end gap-2">
          {/* One button for who can see the profile; the switches live in its pop-up. */}
          <button type="button" onClick={() => setVisOpen(true)} title="Manage who can see your profile"
            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 transition',
              isPublic ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/40 hover:bg-emerald-400/25' : 'bg-white/10 text-white/85 ring-white/20 hover:bg-white/20')}>
            {isPublic ? <Globe size={13} aria-hidden /> : <Lock size={13} aria-hidden />}{isPublic ? 'Public' : 'Private'}
          </button>
          <button type="button" onClick={onEdit} aria-label="Edit profile"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold ring-1 ring-white/20 transition hover:bg-white/20">
            <Pencil size={13} aria-hidden /><span className="max-sm:hidden">Edit profile</span>
          </button>
          {id.public_url ? (
            <button type="button" onClick={onShare} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-black text-slate-950 transition hover:brightness-105">
              {copied ? <Check size={13} aria-hidden /> : <Share2 size={13} aria-hidden />}{copied ? 'Copied' : 'Share'}
            </button>
          ) : !id.controlled.handle && (
            // A handle is a URL, so it has to exist before the profile can go public.
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-black text-slate-950 transition hover:brightness-105">
              <AtSign size={13} aria-hidden />Set a handle
            </button>
          )}
        </div>
      </div>

      {visOpen && <VisibilityModal id={id} onClose={() => setVisOpen(false)} onChanged={onChanged} onEdit={onEdit} onShare={onShare} copied={copied} />}

      {/* Bottom padding is the stats ribbon's landing strip. */}
      <div className="relative flex items-center gap-5 px-5 pb-12 pt-2 sm:px-7 sm:pb-14">
        <div className="min-w-0 flex-1">
          {first && <div className="text-lg font-light leading-none text-white/80 sm:text-xl">{first}</div>}
          <h1 className="mt-1 break-words text-3xl font-black uppercase leading-[0.95] tracking-tight sm:text-4xl">{last}</h1>
          {id.controlled.tagline
            ? <p className="mt-1.5 max-w-xl text-sm text-white/75">{id.controlled.tagline}</p>
            : <button type="button" onClick={onEdit} className="mt-1.5 text-xs text-white/40 hover:text-[var(--accent)]">+ Add a tagline</button>}
          {/* The bio line: shirt, handle, contact, visibility. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
            <span>Shirt <b className="text-white">{id.controlled.jersey_number != null ? `#${id.controlled.jersey_number}` : '-'}</b></span>
            <span style={{ fontFamily: MONO }}>{id.controlled.handle ? <b className="text-white">@{id.controlled.handle}</b> : 'No handle'}</span>
            <span className="inline-flex items-center gap-1">{id.email_verified && id.phone_verified ? <><ShieldCheck size={12} className="text-emerald-400" aria-hidden /><b className="text-white">Verified</b></> : `${[id.email_verified && 'Email', id.phone_verified && 'Phone'].filter(Boolean).join(', ') || 'Not'} verified`}</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {id.officiates && <span className={cn(CHIP, 'bg-amber-400 text-amber-950')}>Official</span>}
            {id.controlled.preferred_sports.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold ring-1 ring-white/15"><span aria-hidden>{iconOf(s)}</span>{s}</span>
            ))}
            {id.controlled.preferred_sports.length === 0 && <button type="button" onClick={onEdit} className="rounded-full border border-dashed border-white/25 px-2.5 py-1 text-xs text-white/50 hover:text-white">+ Add your sports</button>}
          </div>
        </div>
        <span className="relative shrink-0 max-sm:hidden">
          <span aria-hidden className="absolute inset-0 -m-6 rounded-full bg-[var(--accent)]/20 blur-3xl" />
          <PlayerBadge name={id.name} photo={id.controlled.avatar_url} number={id.controlled.jersey_number} size="lg" />
        </span>
      </div>

    </section>
  );
}

/** The win-rate ring: W, D and L as arcs of one circle, the rate in the middle. */
function WinRing({ w, d, l }: { w: number; d: number; l: number }) {
  const total = w + d + l;
  const R = 34; const C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = [[w, '#10b981'], [d, '#94a3b8'], [l, '#f43f5e']] as const;
  return (
    <span className="relative grid h-14 w-14 shrink-0 place-items-center" title="Win rate">
      <svg viewBox="0 0 80 80" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={R} fill="none" strokeWidth="10" className="stroke-slate-100 dark:stroke-slate-800" />
        {total > 0 && arcs.map(([n, color], i) => {
          const len = (n / total) * C;
          const el = <circle key={i} cx="40" cy="40" r={R} fill="none" stroke={color} strokeWidth="10" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />;
          offset += len;
          return el;
        })}
      </svg>
      <span className="text-center">
        <span className="block text-[13px] font-black tabular-nums text-slate-900 dark:text-slate-100">{total ? `${Math.round((w / total) * 100)}%` : '-'}</span>
      </span>
    </span>
  );
}

/** The career in numbers, floating over the banner's foot like a broadcast score ribbon. */
function StatsRibbon({ stats }: { stats?: CareerStatsData }) {
  const w = stats?.wins ?? 0; const d = stats?.draws ?? 0; const l = stats?.losses ?? 0;
  const figures: Array<[string, number, string]> = [
    ['Wins', w, 'text-emerald-600 dark:text-emerald-400'], ['Draws', d, 'text-slate-500 dark:text-slate-300'], ['Losses', l, 'text-rose-500'],
    ['Events', stats?.total_events ?? 0, 'text-slate-900 dark:text-slate-100'], ['Matches', stats?.total_matches ?? 0, 'text-slate-900 dark:text-slate-100'],
  ];
  return (
    <section className="relative z-10 mx-3 -mt-8 flex flex-wrap items-center gap-x-2 gap-y-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900 sm:mx-7 sm:-mt-8 sm:flex-nowrap">
      <span className="flex shrink-0 items-center gap-2"><WinRing w={w} d={d} l={l} /><span className="text-[10px] font-bold uppercase leading-tight tracking-[0.14em] text-slate-400">Win<br />rate</span></span>
      <div className="grid min-w-0 flex-1 grid-cols-3 gap-y-3 sm:grid-cols-5">
        {figures.map(([k, v, tone]) => (
          <div key={k} className="min-w-0 border-l border-slate-100 px-3 dark:border-slate-800 sm:px-5">
            <div className={cn('text-xl font-black leading-tight tabular-nums', tone)}>{v}</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{k}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const TAB_ICON: Record<TabKey, typeof Users> = {
  overview: LayoutGrid, sports: Medal, teams: Users, timeline: History, statistics: BarChart3, achievements: Trophy, certificates: Award,
};

/** The profile's sections as a vertical menu (a chip row on phones). */
function SectionNav({ active, onPick, isLocked }: { active: TabKey; onPick: (k: TabKey) => void; isLocked: (t: typeof TABS[number]) => boolean }) {
  return (
    <nav aria-label="Profile sections" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-col lg:gap-0.5 lg:overflow-visible lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:p-2 lg:pb-2 dark:lg:border-slate-800 dark:lg:bg-slate-900 [&::-webkit-scrollbar]:hidden">
      {TABS.map((t) => {
        const Icon = TAB_ICON[t.key];
        const on = t.key === active;
        return (
          <button key={t.key} type="button" onClick={() => onPick(t.key)} aria-current={on ? 'page' : undefined}
            className={cn('group flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold transition lg:rounded-xl',
              on ? 'bg-[#0a1630] text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900 lg:bg-transparent lg:ring-0 lg:hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:lg:hover:bg-slate-800/50')}>
            <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg max-lg:hidden', on ? 'bg-[var(--accent)] text-slate-950' : TEAL_TILE)}><Icon size={15} aria-hidden /></span>
            <span className="flex-1 text-left">{t.label}</span>
            {isLocked(t) && <Lock size={12} className="opacity-60" aria-hidden />}
            {on && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] max-lg:hidden" />}
          </button>
        );
      })}
    </nav>
  );
}

function LockedTab({ label }: { label: string }) {
  return (
    <EmptyState icon={<Lock size={20} />} title={`${label} needs advanced stats`}
      description="Your participation, results and certificates are all included. Detailed career statistics and a sports CV need advanced_stats." />
  );
}

function PageSkeleton() {
  const bar = 'block animate-pulse rounded-full';
  return (
    <div className="pb-16" role="status" aria-label="Loading">
      <div className={cn('rounded-3xl px-8 pb-28 pt-8', PERSONAL_NAVY)}>
        <span className={cn(bar, 'h-2.5 w-52 bg-white/10')} />
        <div className="mt-6 flex items-center justify-between gap-6">
          <div className="flex-1 space-y-3"><span className={cn(bar, 'h-6 w-32 bg-white/10')} /><span className={cn(bar, 'h-12 w-72 max-w-full bg-white/10')} /><span className={cn(bar, 'h-6 w-56 bg-white/10')} /></div>
          <span className="h-[132px] w-[116px] shrink-0 animate-pulse bg-white/10 max-sm:hidden" style={{ clipPath: HEX_CLIP }} />
        </div>
      </div>
      <div className="relative mx-8 -mt-14 h-28 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900" />
      <div className="mt-6 grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <span className="block h-80 animate-pulse rounded-2xl border border-slate-200 bg-white max-lg:h-10 dark:border-slate-800 dark:bg-slate-900" />
        <span className="block h-80 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
      </div>
    </div>
  );
}

export function SportsProfilePage() {
  usePageTitle('My Sports Profile');
  const [params, setParams] = useSearchParams();
  const { data: id, isLoading, refetch } = useApi<Identity>('/me/identity');
  // Same query the Overview reads, so the stats ribbon costs no extra request.
  const { data: dashboard } = useApi<{ stats: CareerStatsData }>('/me/dashboard');
  const ws = useWorkspace();
  const [editOpen, setEditOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (isLoading || !id) return <PageSkeleton />;

  const active = (TABS.find((t) => t.key === params.get('tab')) ?? TABS[0]);
  const isLocked = (t: typeof TABS[number]) => !!t.needs && !ws.granted.has(t.needs);
  const locked = isLocked(active);
  const share = async () => {
    if (!id.public_url) return;
    await navigator.clipboard.writeText(publicUrl(id.public_url));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="pb-16">
      <AthleteBanner id={id} onEdit={() => setEditOpen(true)} onShare={share} copied={copied} onChanged={() => refetch()} />
      <StatsRibbon stats={dashboard?.stats} />

      {/* Sections down the left like a profile's menu; the record fills the right. */}
      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
          <SectionNav active={active.key} onPick={(k) => setParams({ tab: k })} isLocked={isLocked} />
        </aside>

        <div className="min-w-0 space-y-4">
          <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">{active.label}</h2>
          {locked ? <LockedTab label={active.label} /> : (
            <>
              {active.key === 'overview' && <ParticipantDashboard />}
              {/* Same lifetime record, each section its own half: Achievements the honours, Timeline the history. */}
              {active.key === 'achievements' && <LifetimeRecordPage hideTimeline />}
              {active.key === 'timeline' && <LifetimeRecordPage hideHonours />}
              {active.key === 'sports' && <SportsTab />}
              {active.key === 'teams' && <TeamsTab />}
              {active.key === 'certificates' && <CertificatesTab />}
              {active.key === 'statistics' && <SportStatsPanel />}
            </>
          )}
        </div>
      </div>

      {editOpen && <EditProfileModal id={id} onClose={() => setEditOpen(false)} onSaved={() => refetch()} />}
    </div>
  );
}
