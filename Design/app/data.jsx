/* global window */
// Sportagon - domain data: sports registry, teams, fixtures with live state.

// Sport registry. accent = CSS var; archetype drives the console + scoreboard renderers.
const SPORTS = {
  basketball: { key: "basketball", name: "Basketball", short: "BBL", accent: "var(--sport-basketball)", hue: 52, mono: "B", archetype: "clock", segLabel: "Q", segMax: 4, unit: "PTS" },
  football:   { key: "football", name: "Football", short: "FBL", accent: "var(--sport-football)", hue: 256, mono: "F", archetype: "clock", segLabel: "H", segMax: 2, unit: "GOALS" },
  volleyball: { key: "volleyball", name: "Volleyball", short: "VBL", accent: "var(--sport-volleyball)", hue: 28, mono: "V", archetype: "sets", segLabel: "SET", segMax: 5, unit: "SETS" },
  tennis:     { key: "tennis", name: "Tennis", short: "TEN", accent: "var(--sport-tennis)", hue: 122, mono: "T", archetype: "tennis", segLabel: "SET", segMax: 3, unit: "SETS" },
  badminton:  { key: "badminton", name: "Badminton", short: "BAD", accent: "var(--sport-badminton)", hue: 300, mono: "Bd", archetype: "rally", segLabel: "GAME", segMax: 3, unit: "GAMES" },
  cricket:    { key: "cricket", name: "Cricket", short: "CRK", accent: "var(--sport-cricket)", hue: 145, mono: "C", archetype: "cricket", segLabel: "INN", segMax: 2, unit: "RUNS" },
  athletics:  { key: "athletics", name: "Athletics", short: "ATH", accent: "var(--sport-athletics)", hue: 18, mono: "A", archetype: "time", segLabel: "HEAT", segMax: 1, unit: "TIME" },
  swimming:   { key: "swimming", name: "Swimming", short: "SWM", accent: "var(--sport-swimming)", hue: 232, mono: "S", archetype: "time", segLabel: "HEAT", segMax: 1, unit: "TIME" },
  hockey:     { key: "hockey", name: "Field Hockey", short: "HKY", accent: "var(--sport-hockey)", hue: 195, mono: "H", archetype: "clock", segLabel: "Q", segMax: 4, unit: "GOALS" },
  tabletennis:{ key: "tabletennis", name: "Table Tennis", short: "TT", accent: "var(--sport-tabletennis)", hue: 330, mono: "Tt", archetype: "rally", segLabel: "GAME", segMax: 5, unit: "GAMES" },
};

const TEAMS = {
  IITB:  { name: "IIT Bombay", short: "IITB", hue: 256 },
  IITD:  { name: "IIT Delhi", short: "IITD", hue: 18 },
  IITM:  { name: "IIT Madras", short: "IITM", hue: 145 },
  IITK:  { name: "IIT Kanpur", short: "IITK", hue: 300 },
  BITS:  { name: "BITS Pilani", short: "BITS", hue: 52 },
  DU:    { name: "Delhi University", short: "DU", hue: 28 },
  VIT:   { name: "VIT Vellore", short: "VIT", hue: 122 },
  NITT:  { name: "NIT Trichy", short: "NITT", hue: 232 },
  SRM:   { name: "SRM Chennai", short: "SRM", hue: 195 },
  MU:    { name: "Mumbai Univ.", short: "MU", hue: 330 },
};

// Tenant white-label presets (brand primary hue → ramp computed in app)
const TENANTS = {
  sportagon: { name: "Mumbai University Games 2026", short: "MUG '26", primary: "#2f6fde", hue: 256, chroma: 0.182 },
  meridian:  { name: "Meridian College Fest", short: "Meridian", primary: "#0e9f6e", hue: 158, chroma: 0.15 },
  apex:      { name: "Apex National Games", short: "Apex", primary: "#d4452b", hue: 28, chroma: 0.17 },
  regalia:   { name: "Regalia Invitational", short: "Regalia", primary: "#7c3aed", hue: 295, chroma: 0.18 },
};

let _id = 0;
const uid = (p) => `${p}-${++_id}`;

function mk(sportKey, a, b, opts = {}) {
  return {
    id: uid("fx"), sportKey,
    teamA: { ...TEAMS[a], key: a }, teamB: { ...TEAMS[b], key: b },
    event: "Mumbai University Games 2026",
    tournament: opts.tournament || SPORTS[sportKey].name,
    round: opts.round || "Group Stage",
    venue: opts.venue || "Central Arena", court: opts.court || "Court 1",
    startTime: opts.startTime || "16:30",
    official: opts.official || "R. Mehta",
    status: opts.status || "scheduled",
    state: opts.state || {},
    log: opts.log || [],
  };
}

// Initial fixtures across sports & states
function seedMatches() {
  _id = 0;
  return [
    // ---- LIVE basketball (drives the console demo) ----
    mk("basketball", "IITB", "BITS", {
      round: "Semi-final", venue: "Indoor Stadium", court: "Court A", status: "live", official: "R. Mehta",
      state: { a: 58, b: 54, seg: 3, clock: 412, running: false, foulsA: 6, foulsB: 8, toA: 3, toB: 2,
        segScores: [[21, 18], [16, 19], [21, 17]], bonus: { a: false, b: true } },
      log: [
        { t: "Q3 02:14", team: "A", txt: "+2 - J. Rao (layup)", pts: 2 },
        { t: "Q3 01:50", team: "B", txt: "+3 - A. Khan", pts: 3 },
        { t: "Q3 01:32", team: "A", txt: "+1 - Free throw", pts: 1 },
      ],
    }),
    // ---- LIVE volleyball ----
    mk("volleyball", "DU", "VIT", {
      round: "Quarter-final", venue: "Indoor Stadium", court: "Court B", status: "live", official: "S. Iyer",
      state: { setsA: 1, setsB: 1, a: 19, b: 17, seg: 3, setScores: [[25, 20], [18, 25]], serving: "A" },
      log: [ { t: "S3 19-17", team: "A", txt: "Point - ace (M. Singh)" }, { t: "S3 18-17", team: "B", txt: "Point - block" } ],
    }),
    // ---- LIVE football ----
    mk("football", "IITM", "NITT", {
      round: "Group A", venue: "Main Ground", court: "Pitch 1", status: "live", official: "P. Nair",
      state: { a: 2, b: 1, seg: 2, minute: 67, running: true, scorersA: ["12' R. Das", "58' K. Patel"], scorersB: ["40' V. Reddy"], cardsA: [], cardsB: ["63' Yellow - S. Ali"] },
      log: [ { t: "58'", team: "A", txt: "⚽ Goal - K. Patel" }, { t: "63'", team: "B", txt: "Yellow card - S. Ali" } ],
    }),
    // ---- LIVE cricket ----
    mk("cricket", "IITD", "SRM", {
      round: "League", venue: "Cricket Oval", court: "Main", status: "live", official: "A. Bose",
      state: { inn: 2, battingTeam: "B", a: 164, wA: 7, oversA: 20, b: 121, wB: 4, ballsB: 84,
        target: 165, rr: 8.64, thisOver: ["1", "4", "W", "0", "6"], striker: "N. Verma 38", nonStriker: "T. Roy 12", bowler: "G. Pillai 2-24" },
      log: [ { t: "14.0", team: "B", txt: "SIX - N. Verma" }, { t: "13.3", team: "B", txt: "WICKET - c&b Pillai" } ],
    }),
    // ---- LIVE badminton ----
    mk("badminton", "IITK", "MU", {
      round: "Round of 16", venue: "Indoor Stadium", court: "Court C", status: "live", official: "L. Menon",
      state: { gamesA: 1, gamesB: 0, a: 14, b: 11, seg: 2, gameScores: [[21, 18]], serving: "A" },
      log: [ { t: "G2 14-11", team: "A", txt: "Point - smash" } ],
    }),
    // ---- scheduled / upcoming ----
    mk("tennis", "VIT", "BITS", { round: "Final", court: "Centre Court", status: "scheduled", startTime: "18:00", official: "R. Mehta",
      state: { sets: [], a: 0, b: 0, gamesA: 0, gamesB: 0, server: "A" } }),
    mk("basketball", "MU", "IITD", { round: "Semi-final", court: "Court A", status: "scheduled", startTime: "19:30", official: "R. Mehta" }),
    mk("hockey", "NITT", "SRM", { round: "Group B", venue: "Main Ground", court: "Pitch 2", status: "scheduled", startTime: "17:15", official: "R. Mehta" }),
    // ---- completed ----
    mk("football", "BITS", "DU", { round: "Group A", status: "completed", startTime: "14:00",
      state: { a: 3, b: 2, seg: 2, minute: 90 } }),
    mk("volleyball", "IITB", "IITM", { round: "Group", status: "completed", startTime: "12:30",
      state: { setsA: 3, setsB: 1, setScores: [[25, 20], [22, 25], [25, 19], [25, 18]] } }),
    mk("tabletennis", "IITK", "VIT", { round: "Quarter-final", court: "Table 3", status: "completed", startTime: "11:00",
      state: { gamesA: 3, gamesB: 1 } }),
  ];
}

// Standings (championship table) + medal tally demo data
const STANDINGS = [
  { team: "IITB", P: 9, W: 7, D: 1, L: 1, pts: 22, gd: "+18", form: ["W", "W", "D", "W", "L"] },
  { team: "BITS", P: 9, W: 6, D: 2, L: 1, pts: 20, gd: "+12", form: ["W", "L", "W", "W", "D"] },
  { team: "DU",   P: 9, W: 6, D: 0, L: 3, pts: 18, gd: "+7",  form: ["W", "W", "L", "W", "W"] },
  { team: "IITM", P: 9, W: 5, D: 1, L: 3, pts: 16, gd: "+4",  form: ["L", "W", "W", "D", "W"] },
  { team: "VIT",  P: 9, W: 4, D: 2, L: 3, pts: 14, gd: "+1",  form: ["D", "W", "L", "W", "L"] },
  { team: "NITT", P: 9, W: 3, D: 2, L: 4, pts: 11, gd: "-3",  form: ["L", "D", "W", "L", "W"] },
  { team: "IITD", P: 9, W: 2, D: 1, L: 6, pts: 7,  gd: "-9",  form: ["L", "L", "D", "W", "L"] },
  { team: "SRM",  P: 9, W: 1, D: 1, L: 7, pts: 4,  gd: "-15", form: ["L", "L", "L", "D", "L"] },
];
const MEDALS = [
  { team: "IITB", g: 14, s: 9, b: 7 },
  { team: "BITS", g: 11, s: 12, b: 8 },
  { team: "DU", g: 9, s: 7, b: 11 },
  { team: "IITM", g: 7, s: 8, b: 6 },
  { team: "VIT", g: 5, s: 6, b: 9 },
  { team: "NITT", g: 4, s: 5, b: 7 },
];

Object.assign(window, { SPORTS, TEAMS, TENANTS, seedMatches, STANDINGS, MEDALS, uid });
