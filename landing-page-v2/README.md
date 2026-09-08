# Sportagon EOS — marketing site

React + Vite. All **13 pages** built, wired to the real product for sign in and
sign up, and illustrated with **sixteen real screenshots of EOS**, not mockups —
the home page walks the whole product, institution first, in the order an
organiser meets it.

```bash
npm install
npm run dev            # http://localhost:5173  <- the ROOT of the site
npm run build
npm run shoot          # every route x 3 viewports; fails on console errors,
                       # horizontal overflow, broken images and stray 404s
```

This dev server is the site root, and it **proxies `/app` to the `apps/web` dev
server on 5174**, so one origin in development is laid out exactly like the
deploy: marketing at `/`, product at `/app`. Run both (`npm run dev` from the
repo root starts the API and both front ends) and open `http://localhost:5173`.

`npm run shoot` prints only failures unless `VERBOSE=1`.

## Sign in / sign up are real

`src/data/site.js` points both at the product:

| Link | Goes to |
|---|---|
| Sign in | `${APP_URL}/login` |
| Start free | `${APP_URL}/login?mode=signup` |

`apps/web`'s `AuthPage` reads `?mode=signup` off the query string and opens on
the sign-up tab, so "Start free" lands people straight on Create-your-account
rather than on a sign-in form they then have to switch away from.

**`APP_URL` is `/app` — relative, in every mode.** The app is served from the
same origin as this site (see "This site is the deploy" below), in development
too, so there is no hostname or port to get wrong and nothing that can differ
between local and production.

`VITE_APP_URL` overrides it, for the one case that needs a hostname — running
this site locally against a remote deploy's app:

```bash
VITE_APP_URL=https://events.sportagon.in/app npm run dev
```

**These links navigate in the same tab.** They continue a flow into the
product; `target="_blank"` there strands the visitor with two tabs mid-signup.
Only genuine external references (Instagram, LinkedIn, WhatsApp) open a new
tab.

## The hero

Copy left-aligned; the dashboard screenshot is the **faded background**, bleeding
in from the right rather than sitting in a framed panel below the copy.

**It obeys the page gutter.** `--gutter` is one token used by `.wrap` for its
padding *and* by the hero image for its offset, so the image's right edge lands
on exactly the same margin as the copy's left edge — measured at 190px each side
at 1440px, 24px each side on a phone. They cannot drift apart, because there is
only one value.

Note absolutely positioned children resolve against the **padding box**, so the
gutter has to be subtracted explicitly rather than inherited.

**The image is barely faded** — `0.92` in light, `0.62` in dark. The first pass
ran it at `0.5` behind a heavy two-stop scrim and it read as a wash; the entire
point of putting the product here is that it is legible. Contrast is protected
by geometry instead: the copy column caps at `31rem` and the image starts where
it ends, so the scrim only has to cover the left 40% and can clear entirely by
56%. A short 18% dissolve on the image's left edge stops it reading as a pasted
rectangle.

**Below 980px** the image moves to the bottom of the hero at `0.22`, still
gutter-aligned, with a vertical scrim over the copy.

The hero image is **decorative in this role** — `alt=""` and the whole layer is
`aria-hidden`. The readable, captioned screenshots are in the "actual software"
section below it.

## The screenshots

`public/shots/*.webp` are **sixteen** genuine captures of EOS running an event,
taken with `apps/web/tools/shoot.mjs` against the bench data. They are the most
persuasive thing on the page, so:

- They render inside a browser frame (`Shot` in `components/blocks.jsx`). A bare
  image reads as an illustration; the frame says "this is software".
- The frame's address bar shows the **real route** each screen lives at. That
  has to stay honest — it is the one part of the frame a visitor can check
  against the product after signing up.
- **WebP, at quality 0.82.** Sixteen PNGs was ~2MB; the same set is ~770KB, and
  on flat UI the difference is invisible. `tools/webp.mjs` does the conversion
  with the Chromium Playwright already installs, so this stays free of a native
  image dependency:

  ```bash
  node tools/webp.mjs <dir-of-pngs> --out public/shots
  ```

- **Loading is eager for the first three, lazy for the rest.** Eager everywhere
  was right when there were five; the journey section stacks sixteen down a
  ~20,000px page, and loading all of them up front spends the whole budget
  below the fold. Anything a visitor meets immediately still loads eagerly —
  an empty frame where the proof should be is worse than the bytes.
- `.shot-frame img` states `aspect-ratio: 1440 / 900` as well as the width and
  height attributes. Without it a lazy frame reserved no space until its image
  arrived, and an in-page anchor that had just been clicked drifted several
  hundred pixels while the images above it loaded.

### Refreshing them

The captures come from the **role bench** (`owner.nit@bench.test` /
`Bench@2026`), pinned to a championship that actually has data — the bench's
first organiser event is empty, which is why an unpinned run produced blank
event screens before:

```bash
cd ../apps/web
node tools/shoot.mjs --vp desktop --viewport-only \
  --event <a championship with completed fixtures> \
  --fixture <a live fixture, for the scoring console> \
  --out .shots/journey
```

`--org`, `--event`, `--fixture`, `--keep` and per-surface `act` hooks were added
to that harness for this: `act` is what gets the standings page onto its
**Points table** tab, since the medal tally is empty until results are locked
and the tab is not addressable by URL.

Then rename the ones you want to the keys in `data/site.js` and convert:

```bash
node tools/webp.mjs <renamed-dir> --out public/shots
```

**Set the bench organisation's colour to `#004AAD` before capturing.** EOS
derives its entire ramp from one per-tenant seed, so screenshots inherit
whatever colour that organisation is currently set to — the first pass of this
set came out maroon, and an earlier one purple, neither of which belongs on a
page built around Sportagon blue. Administration → Appearance, or
`PATCH /api/organizations/:id/settings/appearance`.

**Known gaps in the bench data, visible in the shots:** the people register and
the members list repeat a handful of generated names, and several bench
championships are named `ZZ … Probe`/`#test…`, which is why `org-events` and
`organizations` are not used here. Screens showing them need better seed data,
not a different design.

## The journey section

"Inside the product" is one ordered walk through sixteen screens —
`components/ProductJourney.jsx`, data in `data/home.js` (`journey`,
`journeyPhases`).

**It replaced a five-slide coverflow.** Two reasons. A carousel put four of the
five screens behind a gesture; and, more importantly, it presented the screens
as interchangeable views of one product when the actual claim is that each one
feeds the next — the institution's structure decides who may enter, setup feeds
the schedule, the schedule feeds the scoring console, the console feeds the
standings, the standings feed the certificates and the player's record. A
vertical walk is the only shape that says that.

The order is **the organisation first, then an event inside it**: the workspace,
its structure, its roll, who may do what, its squads — then create, set up, run,
publish, and the record that outlives the event.

**The highlight is driven by scroll position, not by an IntersectionObserver.**
The first version used an observer, which fires only when a step crosses the
root margin — so between two crossings the rail sat still while the page moved,
and the lit entry visibly disagreed with what was on screen. Position is what
the rail reflects, so position is what it reads, once per animation frame. The
active step is the last one whose top has passed a read line 150px down, which
means the highlight changes exactly as a step's own title clears the sticky nav.

Two smaller things that are load-bearing:

- **The rail scrolls itself**, by nudging `scrollTop`, when the lit entry falls
  outside its own capped box. `scrollIntoView` would have been shorter and also
  scrolls the *page*, fighting the scroll that got there.
- **The rail is desktop-only** (≥980px). Below that there is no column to spare
  beside a 1440-wide screenshot, and a sticky chip row would compete with the
  sticky nav for the top of the viewport. Each step's own header carries its
  number and its phase, which is the same information the rail was giving.

Still open: the shots are **desktop captures**, so on a phone they are legible
as "software" but not readable in detail. The harness can shoot `--vp phone`;
serving those to narrow viewports through `<picture>` is the obvious next step.

## Tokens

Self-contained in `src/styles/site.css`, with values mirroring `apps/web`
exactly — brand `#004AAD`, Poppins display, **Hanken Grotesk** body, JetBrains
Mono data. Deliberately not importing from the app: this deploys on its own and
must not break because a product build broke.

The body face matters: an earlier draft used Figtree, which meant the same
paragraph rendered in a different typeface either side of the login.

## Link discipline: label must match destination

Every in-content link was auditing badly. Three examples that shipped and had
to be fixed:

| Label | Went to | Why it was wrong |
|---|---|---|
| "See how EOS connects the whole workflow" | `/features` | that page opens on twelve capabilities, not the workflow |
| the four solution cards on home | `/schools` etc. | **clicked and went nowhere.** Two separate causes, both found by `npm run audit` and neither visible by eye — see below |
| "See all 12 in one list" | `/features` | the carousel beside it already showed all twelve |
| "See the six structures" | `/features` | the structures section is on the **same page**, further down |

The rule now: **link out only when the destination has content this page does
not.** If the section already shows everything, the link either scrolls to the
relevant section on this page (`/#capabilities`, `/#structures`) or points at
genuine extra detail (`/features#workflow`).

Two things this needs to keep working:

- **`ScrollToTop` honours the hash.** It used to force `scrollTo(0, 0)` on every
  navigation, which silently broke every in-page anchor — the link fired and the
  page jumped to the top.
- **`section[id] { scroll-margin-top: 88px }`.** Without it `scrollIntoView`
  lands the section's top edge at viewport 0, i.e. its heading sits *under* the
  sticky nav, and the link looks like it overshot.

### Carousel cards that could not be clicked

The four Solutions cards on home are links. Three of the four did nothing when
clicked. Sampling an 81-point grid over each card's box: **the centred card is
hit 81 times out of 81, every other card zero.**

Two causes, stacked:

1. **Pointer capture on `pointerdown`.** The frame took capture immediately, so
   `pointerup` retargeted to the frame and the browser fired `click` there
   rather than on the `<a>` under the finger. Capture is now deferred until the
   drag passes `DRAG_SLOP` (6px), which leaves a tap as an ordinary click.
2. **A rotated card is not hit-testable.** Off-centre cards are transformed in
   3D and a real pointer event over one lands on `.cf-track` behind it, whatever
   `elementFromPoint` says. No per-card handler can fire, so no per-card handler
   could have fixed it. `onFrameClick` resolves the click by **x coordinate**
   instead: centred card → let the `<a>` navigate; side card → swallow the click
   and bring that card to the middle, which is what a coverflow should do
   anyway, and which also stops a click aimed at one card reaching the link of
   the card overlapping it.

**A four-card ring always has one card you cannot click.** `paint()` fades a
card to opacity 0 at half a turn out and parks it outside the frame — with four
cards that is one of them at all times. It is reachable by the chevrons or the
pagination dots, and `npm run audit` now takes that route (centre via the dot,
then click) rather than reporting a false failure. Worth knowing before adding
a fifth audience or dropping to three.

### Arriving mid-page

Landing on the right section is not the same as the reader knowing they did.
`/features#workflow` scrolled correctly and still read badly: section 2 of 5,
dropped in with no sense of what was skipped or what was below, looking like an
arbitrary slice of a page about something else. The fix was orientation, not
deleting the other four sections.

- **`components/PageNav.jsx`** — a second sticky rail listing the page's
  sections, numbered and scrollspy-lit, so an arrival reads as "2 of 5". It
  measures `.nav` and publishes `--nav-h`; the rail's `top` and the anchors'
  `scroll-margin-top` both read that, so a nav height change cannot desync them.
  On a phone the rail scrolls sideways and keeps the lit item in view.
- **`data-landed`** — `ScrollToTop` marks the section a hash landed on for 2s
  and `.section[data-landed]` fades an accent edge in and out once. Skipped
  under `prefers-reduced-motion`.
- **Two correction passes.** `scrollIntoView` commits to a number before the
  page has finished moving: the browser's own fragment scroll races it on a cold
  load, and lazy images re-flow underneath it. A cold `/features#workflow`
  settled 53px high — under the rail — while the identical click from home
  landed right. `ScrollToTop` re-measures at ~700ms and again at 1400ms and
  corrects any drift, reading the offset from the element's own
  `scroll-margin-top`. All five anchors now land identically on both viewports.

The **scrollspy line is the anchor's own `scroll-margin-top`**, not a constant.
A section a hash just scrolled to comes to rest exactly at its scroll-margin, so
any line above that lights the *previous* section at the one moment the rail
most needs to be right.

`npm run audit` (`tools/audit.mjs`) is that checker. It drives Playwright over
every route, scrolls each one so lazy images decode, records console and page
errors, then **clicks every in-content link** and reports where it actually
landed — the destination's h1 and text volume for a route link, the scroll
delta for an anchor. It flags a link that does nothing, a hash that is dropped
or does not scroll, an external link without `target="_blank"`, a page under
700 characters, a duplicate id and a broken image. Full machine-readable output
lands in `.audit.json`.

## Density

The first build was too loose. The pass that fixed it, for reference if the
page ever drifts back:

| | Was | Now |
|---|---|---|
| `.section` padding | 80px | 48px |
| `.s-head` margin-bottom | 40px | 24px |
| `.s-head h2` measure | 34ch | 42ch |
| `.cell` padding | 32px | 20px |
| `.ichip` | 38px | 34px |
| body line-height | 1.65 | 1.55 |
| carousel section | 1137px | ~700px |

Two structural fixes mattered more than any of those numbers:

- **`.cards` is `align-items: start`.** `.card .tlink` used `margin-top: auto`
  to align links across a row, but grid stretches every card to the tallest, so
  a card with two lines of copy got a block of nothing above its link. Cards
  that are not being compared don't need a shared baseline. `.cards--3`
  (pricing) is the deliberate exception — plans *are* read against each other.
- **The carousel's `meta` is one inline row, not a table.** As a 3-row table
  with its own border it was 133px on its own, which is most of why the section
  read as oversized.

## Icons, and where emoji are allowed

**Abstract concepts use the SVG set in `components/Icon.jsx`, rendered in a
brand-tinted chip (`IconChip`).** Emoji were tried across the whole site first
and looked raw:

- every glyph a different palette and stroke weight, so a grid of twelve read as
  twelve unrelated stickers rather than a set
- rendered differently on every OS — Windows' Segoe set is far cruder than
  Apple's, and the page was designed on one and viewed on the other
- illegible at 26px: `📡` came out a grey scribble, `🧬` a pink squiggle for
  "cloning", `🏟️` a smudge, `🗓️` a blue-grey blob
- none of them could take the brand colour, so they fought the palette
- `🔁` didn't render at all on Windows — an empty blue box

**No emoji survive.** The sports list was the last holdout — `⚽ 🏀 🏏 🏸 🏓 ♟️`
looked like the clearest possible mark and needed no legend — but it fell to
the same three objections, plus one of its own: Unicode has no Kho-Kho,
Throwball or Carrom glyph, and Athletics, Kho-Kho and Throwball all came out as
near-identical running figures. Sports now carry a drawn, brand-tinted mark from
`components/SportIcon.jsx`, keyed by the `name` field in `data/site.js`.

If you add a sport, add its `name` to SportIcon and check the mark is (a)
legible at 19px and (b) **distinct from every other entry**.

Every decorative glyph carries `aria-hidden`; the label beside it does the
talking.

## Layout

```
src/
  main.jsx           router mount
  App.jsx            13 routes + scroll restoration
  data/
    site.js          app links, nav, social proof, sports, screenshots
    home.js          home page, incl. `journey` / `journeyPhases`
    solutions.js     the four audience pages
    pages.js         features, scoring, reports, players, pricing, demo, contact
  components/
    Brand.jsx        theme-aware wordmark (blue on light, white on dark)
    Icon.jsx         SVG UI glyphs
    Nav.jsx          dropdowns with descriptions + mobile drawer
    blocks.jsx       Section, SHead, Shot, Proof, Ticker, Cells, Checks,
                     Steps, Split, Faq, Cta, TLink
    ProductJourney.jsx  the sixteen-screen walk on the home page
    Footer.jsx
  pages/
    Home.jsx
    Product.jsx      Features, LiveScoring, Reports
    Solutions.jsx    SolutionsHub + SolutionPage (one template, four pages)
    Misc.jsx         Players, Pricing, Demo, Contact, NotFound
  styles/site.css
```

## Traps already hit here

- **`.wrap` + a narrower `max-width` on the same element centres it.** `.wrap`
  carries `margin: 0 auto`; co-classing a narrow width inherits those auto
  margins instead of left-aligning. Nest, don't co-class.
- **A concise-arrow `useEffect` body returns its value to React**, which then
  calls it as the cleanup function. `useEffect(() => window.scrollTo(0,0), [])`
  crashes every page. Use a block body.
- **`fetchPriority` must be lowercase** on React 18; the camelCase prop arrived
  in React 19 and is dropped with a console warning.
- **A `position: sticky` header re-paints into every band of a Playwright
  fullPage stitch.** `tools/shoot.mjs` pins `.nav` static for the capture, or
  the nav appears half-way down the screenshot on top of real content.
- **Screenshot after images settle, not before.** The harness scrolls the page,
  waits for images (bounded — a lazy image that never enters the viewport fires
  neither `load` nor `error`), then captures.

## This site is the deploy

**It is the root of the domain, and `apps/web` is served from `/app`.** One
Netlify site, two builds, merged by `tools/assemble-site.mjs` at the repo root:

```
dist/          <- landing-page-v2/dist   (this site)
dist/app/      <- apps/web/dist          (the product)
dist/_redirects                          (generated)
```

```bash
npm run build:site           # repo root: both builds, then assemble
node tools/verify-site.mjs   # loads the result in a real browser
```

**Every URL the app used to own at the root is 301'd to `/app`** - the prefix
list lives in `tools/assemble-site.mjs`. Four of them matter more than the rest:
`/verify` (printed as a QR code on issued certificates, and unreissuable), `/c`
(share links), `/p` (public profiles) and `/login` (in every invite email). Those
go to people with no account and no way to guess a replacement URL, so
`verify-site.mjs` checks them on every run.

Sign in / Start free are therefore **same-origin and relative** (`/app/login`),
not a link to another host — in development as well as in production, because
this dev server proxies `/app` to the `apps/web` dev server.

### The demo form submits

`POST /api/demo-requests` -> the `demo_requests` table -> super-admin view at
`/app/platform/demo-requests`. That endpoint is mounted before the API's auth
gate, so an anonymous visitor can post to it and no credentials are involved.

**`VITE_API_URL` must be set on the deploy** (the same variable `apps/web`
needs; no trailing slash, no `/api`). There is deliberately no production
fallback: a guessed API host would make the form look like it worked while every
lead went nowhere. Unset, the form says it is not configured rather than
confirming.

The form's field keys are not the table's column names - see the mapping comment
in `src/pages/Misc.jsx`. It matters, because `createDemoRequestSchema` is a plain
`z.object()`: a key it does not know is **stripped silently and answered 201**.
Add a field to this form and you must add it to that schema, or the answer is
discarded with no error anywhere.

## Still not done

- The old static site at `../landing-page/` is untouched, and is now dead code -
  nothing builds or publishes it.

## If this ever merges INTO apps/web as one bundle

It does not need to: the two ship as one deploy without sharing a bundle, which
is the whole reason the split above works. If you ever do merge them, `apps/web`
defines ~90 of its own CSS variables and its `--sport-*` accents collide with
names used here. Vite makes every imported stylesheet global, so this site's CSS
cannot simply be imported into the app - scope it under one root class first,
generated rather than hand-copied.
