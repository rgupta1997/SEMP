/* Copy for every page other than home and the four solution pages.
   Verbatim from the EOS wireframes. */

/* ---- Features: all twelve capabilities --------------------------------- */
export const capabilities = [
  ['settings', 'Event and sport configuration', 'Set up the event, its sports, categories and formats in one place.', 'setup repeated in a new sheet for every sport', 'one configuration every screen reads from'],
  ['clipboard-list', 'Participant registration', 'Collect entries against a sport, category and age group.', 'paper forms and manual re-entry', 'a clean participant list from day one'],
  ['shield', 'Team and roster management', 'Build teams, confirm rosters and assign captains.', 'roster checks done by memory and message', 'eligible teams, confirmed before match day'],
  ['calendar', 'Fixtures and scheduling', 'Generate fixtures, draws and brackets and allocate venues and slots.', 'clash-hunting across venue sheets', 'a schedule that holds when things change'],
  ['broadcast', 'Live scoring', 'Officials record scores from the venue as matches finish.', 'inconsistent scoring across officials', 'results the moment the match ends'],
  ['medal', 'Results and standings', 'Results feed points tables, brackets and medal tallies.', 'standings recalculated by hand', 'standings that are always current'],
  ['key', 'Roles and access control', 'Admins, organizers, captains and officials get scoped access.', 'one shared login and unclear ownership', 'defined responsibility at every level'],
  ['bell', 'Announcements and notifications', 'Send event updates and fixture changes from the event.', 'updates lost in group chats', 'participants who know what changed'],
  ['certificate', 'Digital certificates', 'Generate branded, QR-verified certificates from result records.', 'certificates typed the night before', 'recognition ready at prize distribution'],
  ['chart', 'Reports and analytics', 'Registration, participation, completion and performance reporting.', 'reports assembled after the event', 'a report you can hand over'],
  ['copy', 'Event templates and cloning', 'Save a format and reuse it for the next edition or client.', 'starting from zero each season', 'the next event set up in a fraction of the time'],
  ['stadium', 'Multi-sport event management', 'Run every sport of a championship inside one event.', 'a separate system or sheet per sport', 'one championship, one record'],
]

export const workflow = [
  'Configure the tournament',
  'Add sports and categories',
  'Register participants and teams',
  'Create and publish fixtures',
  'Record scores and results',
  'Update standings',
  'Communicate event updates',
  'Generate certificates',
  'Analyse participation and performance',
]

/* ---- Live scoring ------------------------------------------------------ */
export const scoringPoints = [
  ['smartphone', 'Score entry at the venue', 'Officials record match scores as they happen, on the device they have with them.'],
  ['link', 'One entry, everything updates', 'Results, points tables, brackets and participant records all read the same entry.'],
  ['settings', 'Per-sport configuration', 'Scoring structure follows the sport and the format you configured for it.'],
  ['traffic-light', 'Match states', 'Upcoming, live, awaiting score and completed are visible to organizers at a glance.'],
  ['megaphone', 'Published to participants', 'Participants see live and completed matches without asking an organizer.'],
  ['lock', 'Consistent records', 'Every official follows the same process, so the event record stays comparable.'],
]

export const matchStates = [
  ['Scheduled', 'Fixture published with venue, slot and reporting time.'],
  ['Live', 'An official has started scoring. Visible to participants as it happens.'],
  ['Awaiting score', 'The match finished but the result is not in yet — the state that usually goes missing.'],
  ['Completed', 'Result recorded. Standings, brackets and records update from it.'],
]

/* ---- Reports & analytics ---------------------------------------------- */
export const reportGroups = [
  ['users', 'Participation', 'Who entered, from where, and in what.', ['Total registrations', 'Sport-wise participation', 'Gender participation', 'Category distribution']],
  ['id-card', 'Teams and entries', 'How the field was made up.', ['Team participation', 'Institution or department entries', 'Roster sizes', 'Entry approvals']],
  ['trophy', 'Competition', 'What actually happened on the ground.', ['Match completion', 'Results by sport', 'Points and medal standings', 'Top performers']],
  ['package', 'Closure', 'What the event leaves behind.', ['Certificate records', 'Event summary report', 'Sport-wise summaries', 'Exportable data']],
]

export const summaryBlocks = [
  ['Event profile', 'Dates, venues, sports, categories and the teams or institutions that took part.'],
  ['Participation numbers', 'Registrations and confirmed entries, broken down by sport, category and gender.'],
  ['Competition record', 'Matches scheduled, matches completed, and results as recorded by officials.'],
  ['Standings', 'Points tables, medal tallies and house or department positions at close.'],
  ['Recognition', 'Top performers and the certificates issued against the event.'],
  ['Notes for next time', 'The configuration used, saved as a template for the next edition.'],
]

export const reportFlow = [
  ['Data enters once', 'Registration, rosters and fixtures are captured during setup.'],
  ['Officials record results', 'Scores go in at the venue as matches finish.'],
  ['Reports build themselves', 'Every report reads the same event record, live.'],
  ['Export and hand over', 'Close the event and send the summary to whoever needs it.'],
]

/* ---- For players ------------------------------------------------------- */
export const playerPillars = [
  ['id-card', 'Lifetime sporting record', 'One profile holds every event, match, result and medal, from school meets to club tournaments, for as long as the player keeps playing.'],
  ['juggle', 'Multi-sport by default', 'A player who plays badminton in winter and athletics in summer keeps both in the same record, not in two systems.'],
  ['trend-up', 'Insights from real matches', 'Participation, results and progress over seasons, drawn from what officials actually recorded.'],
  ['broadcast', 'Live matches to follow', 'Live scores, upcoming fixtures and completed results for the events a player is in, and the ones they follow.'],
  ['shield', 'Verified achievements', 'QR-verified certificates and medals stay attached to the record, ready to download years later.'],
  ['compass', 'One source of event information', 'Reporting times, venue, category and fixture changes come from the event, not a group chat.'],
]

export const recordItems = [
  'Every event entered, by season and sport',
  'Match history with results and opponents',
  'Medals, standings and top-performer entries',
  'QR-verified certificates, downloadable any time',
  'Teams, houses and institutions played for',
  'A record that survives changing school, college or club',
]

export const followItems = [
  'Live scores as officials publish them',
  'Fixtures with venue and reporting time',
  'Results and standings the moment they are updated',
  'Follow a child, a sibling or a team',
  'Announcements and schedule changes from the organizer',
]

export const insightItems = [
  'Events played per season',
  'Sports and categories played',
  'Matches played, won and completed',
  'Results over time',
  'Standings and points history',
  'Medals and podium finishes',
  'Team and roster history',
  'Certificates earned',
]

export const parentItems = [
  ['Know where and when', 'Fixtures, venue and reporting time for your child’s matches, without chasing a teacher or coordinator.'],
  ['Watch the score, not the chat', 'Live and completed match results as the officials record them.'],
  ['Keep the achievements', 'Certificates and medal records stay in one place through school and beyond.'],
]

export const playerJourney = [
  ['Your organizer runs the event on EOS', 'School, college, company or club sets up the tournament.'],
  ['Register through the event', 'Entry against a sport, category and team where applicable.'],
  ['Play and get recorded', 'Officials record scores; results and standings publish from the same entry.'],
  ['Keep the record', 'Matches, standings and certificates stay in your profile for the next season and the next sport.'],
]

export const playerFaqs = [
  ['Do players need to pay for EOS?', 'The player side comes with the event. The organizing institution holds the plan.'],
  ['What happens to my record if I change school or club?', 'The record belongs to the player profile, so it carries across institutions, sports and seasons.'],
  ['Can my family follow my matches?', 'Published fixtures, live scores and results are visible to anyone the participant shares the event with.'],
  ['How do I get my certificate?', 'Certificates issued for an event are available from the profile and are QR-verifiable.'],
  ['Can a parent manage a young player’s profile?', 'Consent and guardian-managed profiles follow the organizer’s registration rules. Final wording to be confirmed with Sportagon.'],
  ['My organizer does not use EOS. What now?', 'Share the platform with them, or ask us to contact them directly through the demo form.'],
]

/* ---- Pricing ----------------------------------------------------------- */
export const plans = [
  {
    name: 'Free',
    icon: 'seed',
    note: 'No credit card required',
    who: 'Set up your first event yourself, with no call and no card.',
    cta: 'Start free',
    action: 'signup',
    lines: ['Core event setup and registration', 'Fixtures, results and standings', 'Participants never pay, on any plan', 'Email support'],
  },
  {
    name: 'Pro',
    icon: 'rocket',
    note: 'Priced per event or per year',
    who: 'For organizations that need control, communication and reporting across a season.',
    cta: 'Book a 20-minute demo',
    action: 'demo',
    featured: true,
    lines: ['Everything in Free', 'Roles and access control', 'Announcements and notifications', 'Digital certificates and reports'],
  },
  {
    name: 'Enterprise',
    icon: 'bank',
    note: 'Quoted per deployment',
    who: 'For large institutions, multi-venue tournaments and multi-location deployments.',
    cta: 'Talk to sales',
    action: 'contact',
    lines: ['Everything in Pro', 'Multi-location deployment', 'White-label options', 'Dedicated onboarding and support'],
  },
]

export const priceFactors = [
  ['ruler', 'Event scale', 'Participants, teams and how many sports the event carries.'],
  ['calendar', 'How often you run', 'A single tournament, a season, or an annual calendar of events.'],
  ['pin', 'Venues and locations', 'One ground, a campus, or events across several cities.'],
  ['palette', 'Deployment', 'Standard EOS or a white-labelled instance under your own brand.'],
]

export const pricingFaqs = [
  ['Do I need to talk to sales to try EOS?', 'No. Start free at events.sportagon.in, set up an event and see the product before any conversation.'],
  ['Do participants pay anything?', 'No. Participants never pay on any plan. The organizing institution holds the plan.'],
  ['How is a paid plan quoted?', 'Against your event scale, number of sports, participants, venues and how many events you run in a year.'],
  ['Is there a contract for a single event?', 'Talk to us with your event dates and we will scope it as a single event or an annual arrangement.'],
  ['What happens after I enquire?', 'An EOS specialist reviews your requirement and sends a proposal after the walkthrough, within one working day.'],
]

/* Questions buyers raise that the copy does not yet answer. Kept visible so
   they get written rather than quietly dropped. */
export const buyerQuestions = [
  'Who owns participant data, and how is minor data handled',
  'What happens if venue connectivity drops mid-match',
  'Who configures the first event, and is onboarding included',
  'What support is available on tournament day',
  'Can existing participant data be imported, and results exported',
  'What access do officials and coordinators get',
]

/* ---- Demo -------------------------------------------------------------- */
export const demoPromises = [
  'A 20-minute walkthrough mapped to your event, not a generic tour',
  'Answers on formats, categories and scoring for your sports',
  'A proposal after the call if you want one',
  'No account is created and no software is installed',
]

export const orgTypes = [
  'School', 'College', 'University', 'Corporate', 'Sports club or academy',
  'Sports association', 'Event management company', 'Tournament organizer', 'Other',
]

export const demoFields = [
  { key: 'name', label: 'Full name', ph: 'Your name', type: 'text', required: true },
  { key: 'email', label: 'Work email', ph: 'name@organization.in', type: 'email', required: true },
  { key: 'phone', label: 'Phone number', ph: '+91', type: 'tel', required: true },
  { key: 'org', label: 'Organization name', ph: 'School, college, company or club', type: 'text', required: true },
  { key: 'orgType', label: 'Organization type', type: 'select', required: true },
  { key: 'city', label: 'City', ph: 'City', type: 'text' },
  { key: 'date', label: 'Expected event date', ph: 'DD / MM / YYYY', type: 'text' },
  { key: 'sports', label: 'Approx. number of sports', ph: 'e.g. 8', type: 'number' },
  { key: 'participants', label: 'Approx. number of participants', ph: 'e.g. 600', type: 'number' },
  { key: 'source', label: 'How did you hear about EOS', ph: 'Optional', type: 'text' },
]

/* ---- Contact ----------------------------------------------------------- */
export const contactCards = [
  ['mail', 'Sales and proposals', 'play@sportagon.in', 'Demos, proposals and pricing for institutions and organizers.'],
  ['phone', 'Phone', '+91 72760 88888', 'Monday to Saturday, working hours IST.'],
  ['lock', 'Existing EOS users', 'Sign in to your workspace', 'Event support for a tournament already running on EOS.'],
]
