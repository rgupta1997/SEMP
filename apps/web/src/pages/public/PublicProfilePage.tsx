import { useEffect, useState } from 'react';
import { Award, CalendarCheck, Medal, Moon, ShieldCheck, Sun, Swords, Trophy } from 'lucide-react';
import { api } from '../../lib/api';
import { BrandMark } from '../../components/BrandMark';
import { Spinner } from '../../components/ui';
import { useTheme } from '../../lib/theme';

// Public sports profile (F-026 extension) - outside the app shell and outside auth,
// same reasoning as VerifyCertificatePage: a profile someone chose to make public is
// only actually public if a stranger with no account can open it.
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

function StatTile({ icon: Icon, label, value, hint, accent }: {
  icon: typeof Trophy; label: string; value: string | number; hint?: string; accent: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className={`mb-3 grid h-9 w-9 place-items-center rounded-xl ${accent}`}>
        <Icon size={17} aria-hidden />
      </div>
      <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      {hint && <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</div>}
    </div>
  );
}

// The handle arrives as a PROP, not from useParams: this page renders outside the
// <Route> tree (ahead of every auth check), so there is no route context to read
// params from - useParams would silently hand back undefined.
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Switch to light view' : 'Switch to dark view'}
      title={dark ? 'Light view' : 'Dark view'}
      className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
    >
      {dark ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
    </button>
  );
}

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

  // The chrome around it - logo, product badge, theme toggle - renders the same
  // way whatever state the page is in, so a slow connection reads as "this app is
  // loading a page" rather than "did this link even go anywhere real". Only the
  // content underneath it changes.
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900">
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
          <h1 className="mt-5 text-xl font-bold text-slate-900 dark:text-slate-100">Profile not found</h1>
          <p className="mt-2 max-w-sm text-sm text-slate-600 dark:text-slate-300">
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
          <p className="max-w-sm text-sm text-slate-600 dark:text-slate-300">
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
        {/* Identity */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="h-20 bg-gradient-to-r from-[#0E7C82] via-[#4F63D2] to-[#8B5CF6] sm:h-24" />
          <div className="px-6 pb-6">
            <div className="-mt-10 flex flex-wrap items-end justify-between gap-4 sm:-mt-12">
              {p.avatar_url ? (
                <img
                  src={p.avatar_url} alt=""
                  className="h-20 w-20 shrink-0 rounded-2xl border-4 border-white object-cover shadow-md dark:border-slate-900 sm:h-24 sm:w-24"
                />
              ) : (
                <div
                  aria-hidden
                  className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border-4 border-white bg-gradient-to-br from-[#0E7C82] to-[#6D28D9] text-2xl font-black text-white shadow-md dark:border-slate-900 sm:h-24 sm:w-24 sm:text-3xl"
                >
                  {initials(p.name) || <ShieldCheck size={26} />}
                </div>
              )}
              {p.sportagon_id && (
                <span className="mb-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] font-bold tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {p.sportagon_id}
                </span>
              )}
            </div>

            <div className="mt-4 min-w-0">
              <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">{p.name}</h1>
              <p className="mt-0.5 font-mono text-[13px] text-slate-500 dark:text-slate-400">@{p.handle}</p>
              {p.tagline && <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-slate-600 dark:text-slate-300">{p.tagline}</p>}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {p.officiates && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                    <Swords size={12} aria-hidden />Official
                  </span>
                )}
                {p.verified_contact && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                    <ShieldCheck size={12} aria-hidden />Verified contact
                  </span>
                )}
                {p.preferred_sports.map((s) => (
                  <span key={s} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Verified record - only present when the owner has also turned on
            "Show my stats publicly"; public_profile alone gets the identity
            card above, not this. */}
        {p.stats && p.achievements ? (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile icon={CalendarCheck} label="Verified events" value={p.stats.events} accent="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400" />
              <StatTile icon={Swords} label="Won / Lost / Drew" value={`${p.stats.won} / ${p.stats.lost} / ${p.stats.drew}`} accent="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400" />
              <StatTile
                icon={Medal} label="Medals" value={p.stats.total_medals} accent="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
                hint={p.stats.total_medals > 0 ? `${p.stats.medals.gold}G · ${p.stats.medals.silver}S · ${p.stats.medals.bronze}B` : undefined}
              />
              <StatTile icon={Award} label="Awards" value={p.stats.awards} accent="bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400" />
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Honours</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Every medal, placement and award, each tied to a verified result.</p>

              {p.achievements.length === 0 ? (
                <div className="mt-6 flex flex-col items-center gap-2 rounded-xl bg-slate-50 py-10 text-center text-sm text-slate-400 dark:bg-slate-800/50 dark:text-slate-500">
                  <Trophy size={22} aria-hidden />
                  Nothing verified yet.
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                  {p.achievements.map((a, i) => (
                    <li key={i} className="flex items-center gap-3 py-3">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${a.medal ? MEDAL_RING[a.medal] : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}`}>
                        <Medal size={16} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{a.title}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {[a.sport, new Date(a.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <section className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500">
            This player has kept their verified stats private.
          </section>
        )}

        <p className="pt-1 text-center text-[11px] text-slate-400 dark:text-slate-600">
          This record is verified by Sportagon and cannot be edited by its owner.
        </p>
      </main>
    </Shell>
  );
}
