/* Site-wide data: where the app lives, the nav, social proof, sports.
   Marketing copy is verbatim from the EOS wireframes; anything added here is
   marked with a comment. */

/* ---------------------------------------------------------------------------
   THE APP LINK.
   Sign in and sign up point at the real product, not at a marketing form.
   `apps/web` AuthPage reads `?mode=signup` off the query string to open on the
   sign-up tab, so "Start free" lands people directly on account creation.

   THIS SITE AND THE APP NOW SHIP AS ONE DEPLOY. This marketing site is the root
   of the domain and `apps/web` is served from /app — see the repo's netlify.toml
   and tools/assemble-site.mjs. So in a production build the link is RELATIVE:
   same origin, no hostname to get wrong, and a staging deploy works with no flag
   set because the app is always at /app of whatever host served this page.

   IT IS RELATIVE IN DEVELOPMENT TOO. This dev server (5173) proxies /app to the
   apps/web dev server (5174), so there is one origin in development laid out like
   the deploy - no hostname, no port, nothing to differ between the two.

   VITE_APP_URL overrides it — point it at a different host's app if you ever need
   to run this site against a remote deploy.
   --------------------------------------------------------------------------- */
export const APP_URL = import.meta.env.VITE_APP_URL || '/app'

const APP = APP_URL

export const SIGN_IN = `${APP}/login`
export const SIGN_UP = `${APP}/login?mode=signup`

/* ---------------------------------------------------------------------------
   THE API. Only the "Book a demo" form uses it: POST /api/demo-requests, which
   is mounted BEFORE the API's auth gate precisely so an anonymous visitor can
   submit. Leads land in the demo_requests table and are triaged by a platform
   super-admin at ${APP_URL}/platform/demo-requests.

   Same shape as apps/web's `lib/api.ts` (VITE_API_URL + '/api'), and the same
   dev default, so a local `npm run dev` talks to the local API with nothing set.

   THERE IS DELIBERATELY NO PRODUCTION FALLBACK. VITE_API_URL is baked in at
   build time, and the production API is an API Gateway host that lives in the
   deploy's environment, not in this repo. Guessing one here would be worse than
   having none: the form would look like it submitted and every lead would be
   POSTed into the void. Unset in a production build, API_URL is null, and the
   demo form says so instead of pretending to succeed.
   --------------------------------------------------------------------------- */
const API_ORIGIN = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:4000' : '')

export const API_URL = API_ORIGIN ? `${API_ORIGIN}/api` : null

export const CONTACT = {
  email: 'play@sportagon.in',
  phone: '+91 72760 88888',
  phoneHref: 'tel:+917276088888',
  whatsapp: 'https://wa.me/917276088888',
  instagram: 'https://www.instagram.com/sportagon',
  linkedin: 'https://www.linkedin.com/company/sportagon-india',
  hours: 'Monday to Saturday, working hours IST',
}

export const nav = {
  /* [label, href, icon]. There was a fourth column of descriptions; the menus
     render label and icon only now, so it has gone rather than sitting unused
     and drifting out of date. */
  product: [
    ['Overview', '/', 'compass'],
    ['Features', '/features', 'settings'],
    ['Live Scoring', '/live-scoring', 'broadcast'],
    ['Reports & Analytics', '/reports', 'chart'],
  ],
  solutions: [
    ['Schools', '/schools', 'school'],
    ['Colleges & Universities', '/colleges', 'university'],
    ['Corporate Sports Events', '/corporate', 'building'],
    ['Tournament Organizers', '/tournament-organizers', 'trophy'],
  ],
  flat: [
    ['For Players', '/players'],
    ['Pricing', '/pricing'],
    ['Contact', '/contact'],
  ],
}

/* Sportagon's own track record — the strongest trust signal on the page,
   and the reason an institution believes EOS was built by people who have
   actually run events. Taken from the wireframes' aboutFacts. */
export const facts = [
  ['10+', 'years running sports events'],
  ['500+', 'sports events managed'],
  ['20+', 'acres of sports infrastructure built'],
]

/* The fifteen sports configured out of the box.
   `name` is the SportIcon key, `sport` the label.

   `top` is a percentage down the panel; `right: true` puts the tile on the
   right of the centre channel; `out` is a FRACTION (0-1) of the room between
   the channel edge and the page gutter — see --fs-room in site.css.

   TWO TILES PER VERTICAL BAND, one near the channel and one near the gutter.
   The first attempt put all eight down a single column, which needs ~690px of
   panel and made the section fill the screen at 100% zoom. Tiles at very
   different `out` cannot touch even at the same `top`, so pairing them halves
   the height the panel needs.

   Constraints the numbers must satisfy, all learned from the overlap check:
     - two tiles sharing a band need `out` at least ~0.6 apart
     - bands stay ~24% apart, and inside 8-88%, or tiles clip the panel edge
   `delay` is unrelated to source order; equal steps made them bob in a wave. */
export const sports = [
  // left: four bands, inner + outer
  { name: 'cricket',     sport: 'Cricket',      top: 9,  out: 0.04, delay: 0,    scale: 1.1 },
  { name: 'football',    sport: 'Football',     top: 13, out: 0.82, delay: 1.7,  scale: 0.9 },
  { name: 'basketball',  sport: 'Basketball',   top: 35, out: 0.16, delay: 0.6,  scale: 0.9 },
  { name: 'volleyball',  sport: 'Volleyball',   top: 31, out: 0.95, delay: 2.4,  scale: 1.05 },
  { name: 'badminton',   sport: 'Badminton',    top: 60, out: 0.02, delay: 0.3,  scale: 0.85 },
  { name: 'tabletennis', sport: 'Table Tennis', top: 64, out: 0.74, delay: 1.2,  scale: 1.05 },
  { name: 'athletics',   sport: 'Athletics',    top: 86, out: 0.2,  delay: 2.9,  scale: 0.95 },
  { name: 'carrom',      sport: 'Carrom',       top: 82, out: 0.9,  delay: 0.9,  scale: 0.85 },

  // right: four bands
  { name: 'hockey',      sport: 'Hockey',       top: 9,  out: 0.06, delay: 2.1, right: true, scale: 1.1 },
  { name: 'swimming',    sport: 'Swimming',     top: 14, out: 0.86, delay: 0.5, right: true, scale: 0.95 },
  { name: 'chess',       sport: 'Chess',        top: 34, out: 0.18, delay: 1.5, right: true, scale: 0.85 },
  { name: 'kabaddi',     sport: 'Kabaddi',      top: 31, out: 0.92, delay: 2.6, right: true, scale: 1.05 },
  { name: 'khokho',      sport: 'Kho-Kho',      top: 61, out: 0.08, delay: 0.8, right: true, scale: 0.9 },
  { name: 'throwball',   sport: 'Throwball',    top: 65, out: 0.8,  delay: 1.9, right: true, scale: 1.05 },
  { name: 'pickleball',  sport: 'Pickleball',   top: 86, out: 0.5,  delay: 0.2, right: true, scale: 0.95 },
]

/* A live-activity strip. Illustrative of what the platform carries, and
   labelled as example activity rather than passed off as a live feed. */
export const ticker = [
  ['live', 'Football SF · Riverside FC 2 – Hilltop Utd 1 · 68′'],
  ['res', 'Badminton U-17 girls final decided in three games'],
  ['new', 'A new inter-college championship went live on EOS today'],
  ['res', 'QR-verified certificates issued at close of play'],
  ['live', 'Athletics · 200m heats in progress across 3 tracks'],
  ['new', 'Built from Sportagon experience delivering 500+ sports events'],
]

/* Real product screenshots, taken from the running app with the screenshot
   harness. Illustrative event data, not a customer's.

   WebP, not PNG. The journey section carries fourteen of these; as PNG that was
   ~1.8MB of screenshots. At 0.82 the same set is ~660KB - what the five PNGs
   cost on their own - with no visible difference on flat UI. Regenerate with
   `node tools/webp.mjs <dir> --out public/shots`.

   `url` is the real route each screen lives at, shown in the frame's address
   bar. It has to stay honest: it is the one part of the frame a visitor can
   check against the product after signing up.

   THE FIVE ORIGINAL KEYS - dashboard, people, reports, profile, event - are
   referenced by /features, /reports and the four solution pages. Renaming one
   silently empties a Shot frame, because `Shot` returns null for an unknown
   name rather than throwing. */
export const shots = {
  dashboard: { src: '/shots/dashboard.webp', url: 'events.sportagon.in/app/organizations/…/overview', alt: 'The EOS organisation dashboard: players, teams, championships running, approvals waiting, and a participation trend' },
  structure: { src: '/shots/structure.webp', url: 'events.sportagon.in/app/organizations/…/campuses', alt: 'Campuses and batches in EOS, each row showing how many people, teams and events belong to it' },
  roles: { src: '/shots/roles.webp', url: 'events.sportagon.in/app/organizations/…/admin?tab=roles', alt: 'Roles and permissions in EOS: each role with its scope and the individual permissions it grants' },
  create: { src: '/shots/create.webp', url: 'events.sportagon.in/app/championships/new', alt: 'Step 1 of the EOS create-event wizard: choosing a championship structure from saved templates, filtered by sport and format' },
  setup: { src: '/shots/setup.webp', url: 'events.sportagon.in/app/championships/…/setup', alt: 'Event setup in EOS: each sport with its format and its disciplines, and the season, venue and invite tabs beside it' },
  people: { src: '/shots/people.webp', url: 'events.sportagon.in/app/organizations/…/students', alt: 'The people register in EOS, filtered by verification status, with campus, batch and Sportagon ID per person' },
  teams: { src: '/shots/teams.webp', url: 'events.sportagon.in/app/organizations/…/teams', alt: 'Teams in EOS grouped as organisation, campus and batch squads, each showing its sport, entries and member count' },
  event: { src: '/shots/event.webp', url: 'events.sportagon.in/app/championships/…', alt: 'An event workspace in EOS: the setup checklist at five of six done, then seasons, sports, teams, approvals and venues' },
  schedule: { src: '/shots/schedule.webp', url: 'events.sportagon.in/app/championships/…/schedule', alt: 'The fixtures grid for a cricket draw in EOS, every home-versus-away cell carrying its result' },
  scoring: { src: '/shots/scoring.webp', url: 'events.sportagon.in/app/score/…', alt: 'The EOS live scoring console for a cricket match: score, over, striker, non-striker, bowler and ball-by-ball buttons' },
  results: { src: '/shots/results.webp', url: 'events.sportagon.in/app/championships/…/results', alt: 'Results in EOS: finished matches awaiting review, the bulk lock action, and each match with its score and status' },
  standings: { src: '/shots/standings.webp', url: 'events.sportagon.in/app/championships/…/standings', alt: 'The championship points table in EOS, computed from completed fixtures, with played, won, drawn, lost and points per campus' },
  announcements: { src: '/shots/announcements.webp', url: 'events.sportagon.in/app/notifications', alt: 'The EOS notification feed: announcements from each championship a person belongs to, with emoji reactions' },
  certificates: { src: '/shots/certificates.webp', url: 'events.sportagon.in/app/organizations/…/certificates/templates', alt: 'Certificate templates in EOS, every tile a real render, each with a QR code for verification' },
  reports: { src: '/shots/reports.webp', url: 'events.sportagon.in/app/organizations/…/reports', alt: 'EOS participation reporting: unique participants, events, matches played, and participants broken down by sport and by programme' },
  profile: { src: '/shots/profile.webp', url: 'events.sportagon.in/app/profile', alt: 'A player sports profile in EOS showing championships, matches, win-loss record and verified achievements' },
}
