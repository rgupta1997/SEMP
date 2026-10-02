import { useEffect, useState } from 'react';
import { Medal, Moon, ShieldCheck, Sun, Swords, Trophy } from 'lucide-react';
import { api } from '../../lib/api';
import { BrandMark } from '../../components/BrandMark';
import { Badge, Card, CardBody, CardHeader, Spinner, StatCard } from '../../components/ui';
import { useTheme } from '../../lib/theme';

// Public sports profile (F-026 extension) - outside the app shell and outside auth,
// same reasoning as VerifyCertificatePage: a profile someone chose to make public is
// only actually public if a stranger with no account can open it.
//
// Built from the SAME Card/StatCard/Badge components the authenticated Sports
// Profile page uses, rather than a bespoke look - a public mirror of a page should
// look like it came from the same product, not a different one.
//
// v1 ships one fixed set of fields, chosen by us rather than the profile owner -
// identity plus the verified record, nothing that belongs to anyone else (no
// roster, no opponents' contacts) and nothing private (no email/phone). Letting the
// owner pick per-field is a v2, tracked as follow-up rather than built here.

interface PublicProfile {
  name: string;
  handle: string;
  sportagon_id: string | null;
  tagline: string | null;
  avatar_url: string | null;
  preferred_sports: string[];
  officiates: boolean;
  verified_contact: boolean;
  // Present only when the owner has also turned on "Show my stats publicly" -
  // public_profile alone gets you the identity card, not the playing record.
  stats?: {
    events: number; won: number; lost: number; drew: number;
    medals: { gold: number; silver: number; bronze: number };
    total_medals: number; awards: number;
  };
  achievements?: Array<{ title: string; medal: 'gold' | 'silver' | 'bronze' | null; date: string; sport: string | null }>;
}

const MEDAL_RING = {
  gold: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  silver: 'bg-slate-200 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
  bronze: 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400',
} as const;

const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Switch to light view' : 'Switch to dark view'}
      title={dark ? 'Light view' : 'Dark view'}
      className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] text-[var(--muted)] transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
    >
      {dark ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
    </button>
  );
}

// The handle arrives as a PROP, not from useParams: this page renders outside the
// <Route> tree (ahead of every auth check), so there is no route context to read
// params from - useParams would silently hand back undefined.
export function PublicProfilePage({ handle }: { handle?: string }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!handle) return;
    let live = true;
    setProfile(null); setNotFound(false); setFailed(false);
    api<PublicProfile>('GET', `/public/profiles/${handle}`)
      .then((p) => { if (live) setProfile(p); })
      .catch((e) => { if (!live) return; if (e?.status === 404) setNotFound(true); else setFailed(true); });
    return () => { live = false; };
  }, [handle]);

  // The chrome around it - logo, theme toggle - renders the same way whatever
  // state the page is in, so a slow connection reads as "this app is loading a
  // page" rather than "did this link even go anywhere real". Only the content
  // underneath it changes. Backgrounds use the app's own --canvas token in light
  // mode (that token has no dark variant of its own, so dark mode falls back to
  // the same slate-950 every other Tailwind-styled page in this product uses).
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="flex min-h-screen flex-col bg-[var(--canvas)] dark:bg-slate-950">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--line)] bg-white px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900">
        <BrandMark height={22} />
        <ThemeToggle />
      </header>
      {children}
    </div>
  );

  if (!handle || notFound) {
    return (
      <Shell>
        <main className="mx-auto flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
            <ShieldCheck size={24} aria-hidden />
          </div>
          <h1 className="mt-5 text-xl font-bold text-[var(--ink-2)] dark:text-slate-100">Profile not found</h1>
          <p className="mt-2 max-w-sm text-sm text-[var(--muted)] dark:text-slate-300">
            Either this handle does not exist, or its owner has not made their profile public.
          </p>
        </main>
      </Shell>
    );
  }

  if (failed) {
    return (
      <Shell>
        <main className="mx-auto flex flex-1 items-center justify-center px-6 text-center">
          <p className="max-w-sm text-sm text-[var(--muted)] dark:text-slate-300">
            We could not reach the profile service. That is a problem at our end - please try again shortly.
          </p>
        </main>
      </Shell>
    );
  }

  if (!profile) {
    return (
      <Shell>
        <main className="flex flex-1 items-center justify-center px-6 py-20">
          <Spinner label="Loading profile…" />
        </main>
      </Shell>
    );
  }

  const p = profile;

  return (
    <Shell>
      <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8 sm:px-6 sm:py-12">
        {/* Identity - same shape as the authenticated ProfileHeader card (solid
            brand-coloured avatar tile, bold name, badges, sport chips), just
            without any control a stranger has no business seeing. */}
        <Card>
          <CardBody className="sm:px-6 sm:pt-6 sm:pb-6">
            <div className="flex flex-wrap items-start gap-5">
              {p.avatar_url ? (
                <img
                  src={p.avatar_url} alt=""
                  className="h-16 w-16 shrink-0 rounded-2xl object-cover sm:h-20 sm:w-20"
                />
              ) : (
                <div
                  aria-hidden
                  className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[var(--brand)] text-2xl font-black text-white sm:h-20 sm:w-20 sm:text-3xl"
                >
                  {initials(p.name) || <ShieldCheck size={26} />}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-black tracking-tight text-[var(--ink-2)] dark:text-slate-100">{p.name}</h1>
                {p.tagline && <p className="mt-1 text-sm text-[var(--ink-4)] dark:text-slate-300">{p.tagline}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {p.sportagon_id && (
                    <span className="rounded-md bg-[var(--brand-line)] px-2.5 py-1 font-mono text-xs font-bold tracking-wide text-[var(--brand)] dark:bg-brand-500/15 dark:text-brand-300">
                      {p.sportagon_id}
                    </span>
                  )}
                  {p.officiates && <Badge tone="amber"><Swords size={12} aria-hidden />Official</Badge>}
                  {p.verified_contact && <Badge tone="green"><ShieldCheck size={12} aria-hidden />Verified contact</Badge>}
                </div>

                {p.preferred_sports.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {p.preferred_sports.map((s) => (
                      <span
                        key={s}
                        className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs font-medium text-[var(--ink-4)] dark:border-slate-700 dark:text-slate-300"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Verified record - only present when the owner has also turned on
            "Show my stats publicly"; public_profile alone gets the identity
            card above, not this. Uses the same StatCard tile as every stats
            surface in the product (Standings, My Game, the org dashboard). */}
        {p.stats && p.achievements ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Verified events" value={p.stats.events} />
              <StatCard label="Won / Lost / Drew" value={`${p.stats.won}/${p.stats.lost}/${p.stats.drew}`} />
              <StatCard
                label="Medals" value={p.stats.total_medals}
                hint={p.stats.total_medals > 0 ? `${p.stats.medals.gold}G · ${p.stats.medals.silver}S · ${p.stats.medals.bronze}B` : undefined}
              />
              <StatCard label="Awards" value={p.stats.awards} />
            </div>

            <Card>
              <CardHeader title="Honours" subtitle="Every medal, placement and award, each tied to a verified result." />
              <CardBody className="pt-0">
                {p.achievements.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-xl bg-slate-50 py-10 text-center text-sm text-[var(--faint)] dark:bg-slate-800/50 dark:text-slate-500">
                    <Trophy size={22} aria-hidden />
                    Nothing verified yet.
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {p.achievements.map((a, i) => (
                      <li key={i} className="flex items-center gap-3 py-3">
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${a.medal ? MEDAL_RING[a.medal] : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}`}>
                          <Medal size={16} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-[var(--ink-2)] dark:text-slate-100">{a.title}</span>
                          <span className="block text-xs text-[var(--muted)] dark:text-slate-400">
                            {[a.sport, new Date(a.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </>
        ) : (
          <Card>
            <CardBody className="text-center text-sm text-[var(--faint)]">
              This player has kept their verified stats private.
            </CardBody>
          </Card>
        )}

        <p className="pt-1 text-center text-[11px] text-[var(--faint)] dark:text-slate-600">
          This record is verified by Sportagon and cannot be edited by its owner.
        </p>
      </main>
    </Shell>
  );
}
