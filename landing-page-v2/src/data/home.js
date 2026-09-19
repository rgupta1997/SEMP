/* Home page copy. Verbatim from the EOS wireframes unless a comment says
   otherwise — this is reviewed marketing copy, so don't paraphrase it here. */

export const hero = {
  eyebrow: 'Multi-sport tournament management',
  h1: 'Run your entire sports event from one operating system',
  lead: 'Sportagon EOS brings registrations, teams, fixtures, live scoring, standings, results, certificates and event reports together, so organizers can operate better tournaments with less manual work.',
  note: ['No credit card required', 'Participants never pay', 'Guided onboarding available'],
}

/* Ordered, not interchangeable: these are the four stages at which an event
   loses its record, and the section is the page's actual sales pitch — so each
   one carries the cost of the problem AND the line that answers it. Anything
   longer than a line here and the reader stops scanning.

   [icon, tone, title, what happens, what it costs, what EOS does instead] */
export const problems = [
  [
    'scatter', 'amber', 'Scattered entries',
    'Entries arrive in forms, sheets and chat threads that never agree.',
    'Four sources of truth',
    'One participant record, from entry to certificate.',
  ],
  [
    'duplicate', 'rose', 'Everything entered twice',
    'Registration, fixtures, scoring and certificates each get a manual pass.',
    '4× the data entry',
    'Enter it once; every screen reads the same row.',
  ],
  [
    'bell-off', 'violet', 'Changes nobody sees',
    'A rescheduled match reaches half the teams and none of the officials.',
    'Half the teams miss it',
    'One change notifies every team and official.',
  ],
  [
    'clock', 'teal', 'Results days late',
    'Standings, medal tallies and certificates land after everyone has left.',
    'Days, not minutes',
    'Standings move the moment a score is saved.',
  ],
]


/* Twelve capabilities exist. Home shows six and links out.
   [emoji, title, what it does, what it removes, what you get back] */
export const featuresHome = [
  ['settings', 'Event and sport configuration', 'Set up the event, its sports, categories and formats in one place.', 'setup repeated in a new sheet for every sport', 'one configuration every screen reads from'],
  ['clipboard-list', 'Participant registration', 'Collect entries against a sport, category and age group.', 'paper forms and manual re-entry', 'a clean participant list from day one'],
  ['shield', 'Team and roster management', 'Build teams, confirm rosters and assign captains.', 'roster checks done by memory and message', 'eligible teams, confirmed before match day'],
  ['calendar', 'Fixtures and scheduling', 'Generate fixtures, draws and brackets and allocate venues and slots.', 'clash-hunting across venue sheets', 'a schedule that holds when things change'],
  ['broadcast', 'Live scoring', 'Officials record scores from the venue as matches finish.', 'inconsistent scoring across officials', 'results the moment the match ends'],
  ['medal', 'Results and standings', 'Results feed points tables, brackets and medal tallies.', 'standings recalculated by hand', 'standings that are always current'],
]

/* ===== the journey =========================================================

   ONE ORDERED WALK THROUGH THE PRODUCT, not a gallery. This section used to be
   a five-slide coverflow, which put four of the five screens behind a gesture
   and said nothing about the order they are met in. Running an event IS a
   sequence, and the sequence is the argument: one record is carried from the
   template you start from to the certificate a player still holds three years
   later, and nothing is entered twice on the way.

   `phase` groups the steps in the rail, so fourteen entries scan as four
   stages. `shot` must name a key in data/site.js `shots` — an unknown name
   renders an empty frame rather than throwing.

   `meta` is three short label/value pairs per step, not prose: the screenshot
   beside it is doing the describing. */

export const journeyPhases = [
  { id: 'org', title: 'The institution' },
  { id: 'set-up', title: 'Set up an event' },
  { id: 'run', title: 'Run it' },
  { id: 'publish', title: 'Publish it' },
  { id: 'record', title: 'Keep the record' },
]

export const journey = [
  {
    phase: 'org',
    shot: 'dashboard',
    title: 'The institution workspace',
    line: 'EOS starts with the institution, not with an event. Players, teams, championships running, entries awaiting approval, certificates pending, matches live right now, with the queue of things that actually need a decision at the top rather than buried in a list.',
    meta: [
      { label: 'Approvals', value: 'surfaced, not buried' },
      { label: 'Live matches', value: 'every sport at once' },
      { label: 'Trend', value: 'participation by season' },
    ],
  },
  {
    phase: 'org',
    shot: 'structure',
    title: 'Your structure, in your words',
    line: 'Campuses, schools, offices, houses, programmes, batches, named the way your institution names them. This is what a scoped role is granted against, and what competes against what in an internal championship.',
    meta: [
      { label: 'Your labels', value: 'campus, house, office, batch' },
      { label: 'Two levels', value: 'and who sits in each' },
      { label: 'Entrants', value: 'for internal events' },
    ],
  },
  {
    phase: 'org',
    shot: 'people',
    title: 'The roll, once',
    line: 'Upload the roll or add people one at a time. Each person gets a Sportagon ID that stays with them across teams, events and institutions, so next season starts from a register that already exists.',
    meta: [
      { label: 'Bulk upload', value: 'a whole roll at once' },
      { label: 'Verification', value: 'awaiting / verified / rejected' },
      { label: 'Sportagon ID', value: 'follows the player' },
    ],
  },
  {
    phase: 'org',
    shot: 'roles',
    title: 'Who can do what, exactly',
    line: 'A sports admin, a reporting admin, a captain, an official, a point of contact. Every role is a named set of permissions, granted over the whole institution, one campus, or a single event, so delegating work does not mean handing over the keys.',
    meta: [
      { label: 'Three scopes', value: 'institution, unit, event' },
      { label: 'Per permission', value: 'not one admin switch' },
      { label: 'Audit trail', value: 'who changed what' },
    ],
  },
  {
    phase: 'org',
    shot: 'teams',
    title: 'Squads, not spreadsheets',
    line: 'Build squads for the institution, a campus or a batch, confirm rosters and assign captains. A squad is entered into an event rather than rebuilt for it, so one team can play several championships.',
    meta: [
      { label: 'Three levels', value: 'institution, campus, batch' },
      { label: 'Rosters', value: 'confirmed before match day' },
      { label: 'Entries', value: 'one squad, many events' },
    ],
  },
  {
    phase: 'set-up',
    shot: 'create',
    title: 'Start from a template',
    line: 'Pick the shape of the event, a knockout, a league, heats, a mixed multi-sport meet, and the sports, disciplines, formats and scoring rules come filled in. Everything stays editable right up until registration opens.',
    meta: [
      { label: 'Five steps', value: 'shape to open registration' },
      { label: 'Templates', value: 'yours, or the catalogue' },
      { label: 'Reusable', value: 'last year, again' },
    ],
  },
  {
    phase: 'set-up',
    shot: 'setup',
    title: 'Sports, disciplines and formats',
    line: 'Every sport in the event carries its own disciplines, categories, format and venue. Configured once, in one place, and read by every screen after it, the schedule, the scoring console, the points table, the certificate.',
    meta: [
      { label: 'Per discipline', value: 'format and scoring rule' },
      { label: '27 sports', value: 'each with its own scoring' },
      { label: 'Set once', value: 'read everywhere' },
    ],
  },
  {
    phase: 'run',
    shot: 'event',
    title: 'The event workspace',
    line: 'Each event gets its own workspace: a setup checklist that says what is still missing, its own organising team, and a read-only public link you can share with anyone before a single person signs in.',
    meta: [
      { label: 'Checklist', value: 'draft to open, tracked' },
      { label: 'Scoped roles', value: 'organiser, official, captain' },
      { label: 'Public link', value: 'shareable, no login' },
    ],
  },
  {
    phase: 'run',
    shot: 'schedule',
    title: 'Fixtures and draws, generated',
    line: 'Draws, brackets, groups and heats are generated from the format, with venues and slots allocated across them. The grid carries every home-versus-away result, so a whole draw reads at a glance.',
    meta: [
      { label: 'Generated', value: 'from the format, not by hand' },
      { label: 'Grid or list', value: 'whichever you read faster' },
      { label: 'Reschedules', value: 'reach everyone at once' },
    ],
  },
  {
    phase: 'run',
    shot: 'scoring',
    title: 'Scored at the venue, ball by ball',
    line: 'Officials score from a phone at the ground. Cricket counts deliveries, extras and wickets; racquet sports count points and games; the rest take a final score. The scorecard is the record, not a note to be typed up afterwards.',
    meta: [
      { label: 'Detailed or manual', value: 'per match, per official' },
      { label: 'Live', value: 'visible as it happens' },
      { label: 'Undo', value: 'a mis-tap is not a crisis' },
    ],
  },
  {
    phase: 'run',
    shot: 'results',
    title: 'Reviewed, then locked',
    line: 'Finished matches queue for review. Locking is the moment a result becomes official, publishing the standings, feeding the certificates and writing to the player record, and it takes a deliberate action, in bulk or one match at a time.',
    meta: [
      { label: 'Queue', value: 'awaiting review, being played' },
      { label: 'Lock in bulk', value: 'or match by match' },
      { label: 'Locked', value: 'cannot be quietly edited' },
    ],
  },
  {
    phase: 'publish',
    shot: 'standings',
    title: 'Standings that compute themselves',
    line: 'Points tables, brackets and medal tallies are derived from completed fixtures under each discipline’s own scoring rule. Nobody maintains a standings sheet, and no version of the table disagrees with the results.',
    meta: [
      { label: 'Derived', value: 'from completed fixtures only' },
      { label: 'Per rule', value: 'each discipline scores its own way' },
      { label: 'Medals or points', value: 'both, one tap apart' },
    ],
  },
  {
    phase: 'publish',
    shot: 'announcements',
    title: 'Everyone hears it at once',
    line: 'Announcements go to the audience you choose, everyone, or only captains, officials or points of contact, and land in one feed per person, across every championship they belong to. No parallel chat group to keep in sync.',
    meta: [
      { label: 'Targeted', value: 'by role, not by group chat' },
      { label: 'One feed', value: 'every event a person is in' },
      { label: 'Reactions', value: 'you can see it landed' },
    ],
  },
  {
    phase: 'publish',
    shot: 'certificates',
    title: 'Certificates from locked results',
    line: 'Certificates are generated from results rather than typed from them, the name, the placing, the event and the date come off the locked scorecard. Every one carries a QR code that still verifies years later.',
    meta: [
      { label: 'Templates', value: 'every tile a real render' },
      { label: 'From results', value: 'no re-entry, no typos' },
      { label: 'QR-verified', value: 'checkable long after' },
    ],
  },
  {
    phase: 'record',
    shot: 'reports',
    title: 'The report the board asks for',
    line: 'Participation, performance, peer benchmark and impact, all derived from locked results, so the figures are the ones officials actually recorded. Broken down by sport, programme and campus, with a six-season trend to sit against.',
    meta: [
      { label: 'Breakdowns', value: 'by sport and programme' },
      { label: 'History', value: 'six-season trend' },
      { label: 'Export', value: 'for the board and the file' },
    ],
  },
  {
    phase: 'record',
    shot: 'profile',
    title: 'The player keeps the record',
    line: 'Championships, matches, a win-loss record and verified achievements, computed from locked scorecards. A result written by a locked scorecard cannot be edited or hidden, not by the player, and not by the institution that issued it.',
    meta: [
      { label: 'Verified', value: 'cannot be edited or hidden' },
      { label: 'Certificates', value: 'QR-verifiable, years later' },
      { label: 'Public profile', value: 'the player turns it on' },
    ],
  },
]

export const audiences = [
  ['school', 'Schools', 'Manage annual sports meets, house competitions and inter-school tournaments with structured registrations, categories, results and certificates.', 'Schools', '/schools'],
  ['university', 'Colleges and Universities', 'Operate multi-sport campus tournaments involving departments, institutions, teams, venues and points tables.', 'Colleges & Universities', '/colleges'],
  ['building', 'Corporate Sports Events', 'Run employee leagues and engagement events with better communication, participation tracking and reporting.', 'Corporate Sports Events', '/corporate'],
  ['trophy', 'Tournament Organizers', 'Create a structured, repeatable operating system for managing tournaments across clients, sports and locations.', 'Tournament Organizers', '/tournament-organizers'],
]

/* The organization is the buyer, so this list says what they get rather than
   naming a category. Each line is grounded in a capability that exists —
   see `capabilities` in data/pages.js — not in an aspiration.

   The participant list below stays single-line on purpose: the two audiences
   are not equally weighted on a page whose job is to sell to institutions. */
export const orgBenefits = [
  ['One system for the whole championship', 'Every sport, category and age group of one event lives in a single record instead of a file per sport.'],
  ['A week of coordination back', 'Fixtures, draws and venue slots are generated and re-generated, so a change does not mean rebuilding the schedule by hand.'],
  ['Results that are final when the match ends', 'Officials score at the venue and standings, brackets and medal tallies read that same entry.'],
  ['Clear responsibility at every level', 'Admins, organizers, captains and officials each get scoped access, so nothing runs on one shared login.'],
  ['A report you can hand to leadership', 'Registration, participation and completion reporting is ready at close of play, not assembled the following week.'],
  ['Next season set up in an afternoon', 'Save the format once and reuse it for the next edition, the next campus or the next client.'],
  ['A record that outlives the event', 'Results, certificates and participation history stay verifiable long after the ground is packed up.'],
]

export const partBenefits = [
  'Clear registration information',
  'Published fixtures',
  'Match and result visibility',
  'Timely announcements',
  'Standings and achievements',
  'Digital certificates',
  'One reliable source of event information',
]

export const faqs = [
  ['What is Sportagon EOS?', 'Sportagon EOS is an end-to-end multi-sport tournament management platform. It holds registrations, teams, fixtures, live scoring, standings, results, communication, certificates and reports for one event in one system.'],
  ['What is tournament management software?', 'Software that carries a tournament from configuration through registration, scheduling, scoring and reporting, replacing spreadsheets, paper scorecards and message-group coordination.'],
  ['Who can use Sportagon EOS?', 'Schools, colleges, universities, corporates, sports associations, clubs, academies, event companies and professional tournament organizers.'],
  ['Can EOS manage multiple sports in one tournament?', 'Yes. A single event can hold many sports, each with its own categories, format and fixtures.'],
  ['Does EOS manage teams and participants?', 'Participants register against sports and categories; teams and rosters are managed with defined limits and roles.'],
  ['Does EOS support live scoring?', 'Officials record scores during the match. Results, standings and participant records update from the same entry. Scoring behaviour is configured per sport.'],
  ['Can EOS generate digital certificates?', 'Branded, QR-verified certificates are generated from result and participation records.'],
  ['Can tournament formats be customized?', 'Formats and competition structures are configured per sport based on event requirements. EOS does not claim automated scoring for every sport.'],
]

/* The six competition structures.

   `img` is the visualiser shown by <FormatDeck>. These are the only
   ILLUSTRATIONS on the site — everywhere else the images are real product
   captures. They earn the exception because a bracket, a group-into-playoff
   flow and a heat progression are structures, not screens: a screenshot of one
   shows a list of fixtures, which is exactly what a reader cannot tell apart.
   Sourced 16:9 and re-encoded to WebP (~40KB each) from the original PNGs in
   stitch_tournament_format_visualizer/. */
export const structures = [
  {
    name: 'League',
    tag: 'Round robin',
    note: 'Every team plays every other team, with points, tie-breaks and a running table.',
    knobs: ['Points per result', 'Tie-break rules', 'Rounds', 'Table columns'],
    img: '/formats/league.webp',
    alt: 'A round-robin league table: rank, team, games played, wins, losses, draws and points, sorted by points',
  },
  {
    name: 'Knockout',
    tag: 'Single elimination',
    note: 'Single elimination through a bracket, with seeding and byes handled at draw time.',
    knobs: ['Draw size', 'Seeding', 'Byes', 'Third-place match'],
    img: '/formats/knockout.webp',
    alt: 'A single-elimination bracket running from round one through to a champion, each tie showing its score',
  },
  {
    name: 'Groups + playoffs',
    tag: 'Two stages',
    note: 'Group stage first, then a bracket for the teams that qualify.',
    knobs: ['Group count', 'Qualifiers per group', 'Cross-group pairing', 'Playoff rounds'],
    img: '/formats/groups.webp',
    alt: 'Four group tables on the left feeding a quarter-final, semi-final and final bracket on the right',
  },
  {
    name: 'Heats and finals',
    tag: 'Timed or measured',
    note: 'Timed or measured events that progress from heats and semis to a final.',
    knobs: ['Heat allocation', 'Progression rule', 'Lanes or positions', 'Result unit'],
    img: '/formats/heats.webp',
    alt: 'Racing heats with recorded times progressing to a medal podium',
  },
  {
    name: 'Individual draw',
    tag: 'Singles and doubles',
    note: 'Singles, doubles or mixed events run as a draw within a category.',
    knobs: ['Category', 'Draw type', 'Best of', 'Consolation draw'],
    img: '/formats/draw.webp',
    alt: 'A seeded 1v1 draw of sixteen players closing on a championship match, with the round labels beneath',
  },
  {
    name: 'Team event',
    tag: 'Aggregated',
    note: 'Individual contests aggregated into a single team result.',
    knobs: ['Boards or matches', 'Aggregation rule', 'Squad size', 'Substitutions'],
    img: '/formats/team.webp',
    alt: 'Two team crests facing off above a bracket of crests resolving to one championship result',
  },
]
