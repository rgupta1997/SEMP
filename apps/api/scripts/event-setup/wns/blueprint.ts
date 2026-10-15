/*
 * WNS FOOTBALL 2026 — the sheet adapter.
 *
 * Reads the two tabs WNS sent (Teams, Master Schedule) and returns an
 * EventSetupBlueprint (the shared shape). Every judgement call the sheet forced is made HERE, in data the
 * reader can see (ALIASES, SPLITS, the naming rules), and written to `findings` —
 * the engine below it makes none.
 *
 *   data/wns/teams.csv     ID, Captain/VC name+UID+mobile, Team Name, Bracket,
 *                          Process Name, Location, Player 1-6, Substitute 1-2
 *   data/wns/schedule.tsv  Day, Turf, Bracket, Round, Match ID, Kickoff, End,
 *                          Team 1, Team 2 ("Winner of <Match ID>" after round one)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, isBlank } from '../csv.js';
import type {
  EventSetupBlueprint, SetupCompetitorSpec, SetupFinding as Finding, SetupMatchRowSpec as MatchRowSpec,
  SetupMatchSide as MatchSide, SetupPersonSpec as PersonSpec, SetupSquadSpec as SquadSpec,
} from '@semp/shared';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'wns');

// Day N on the sheet -> the calendar. The sheet's own dates (15/16 Oct) were a
// template's; the event is Saturday and Sunday (confirmed 2026-10-15).
const DAYS: Record<string, string> = { 'Day 1': '2026-10-17', 'Day 2': '2026-10-18' };

// ---------------------------------------------------------------------------
// people: who is the same person
// ---------------------------------------------------------------------------
// The sheet has no id for players, only names. The rule: the SAME NAME IS THE SAME
// PERSON across the whole sheet — eight squads are re-registrations of another and
// share their players, and a person on two squads is legal. These lists are the
// exceptions, each one read off the sheet by hand.

/** Spelling variants of one person. Scoped to a squad where the short form is only safe there. */
const ALIASES: Array<{ from: string; to: string; squad?: string; why: string }> = [
  { from: 'Siddaram Chikkabenur', to: 'Siddharam Chikabenur', why: 'same captain UID 475682' },
  { from: 'Deepak Malasure', to: 'Deepak Malusare', why: 'same VC UID 489853' },
  { from: 'Atharv Salunke', to: 'Atharv Salunkhe', why: 'VC of FALCON FORCE, listed as player with an h' },
  { from: 'Prathamesh Tawde', to: 'Prathmesh Pradeep Tawde', why: 'Kiwi Champions re-registers Team Kiwi' },
  { from: 'Cajetan Dias', to: 'Cajetan Agnelo Dias', why: 'Kiwi Champions re-registers Team Kiwi' },
  { from: 'Sanskruti Tawde', to: 'Sanskruti Ranjit Tawde', why: 'Kiwi Champions re-registers Team Kiwi' },
  { from: 'Tushar Salunke', to: 'Tushar Salunkhe', why: 'Elite Strikers and IAG Warriors share their NRMA players' },
  { from: 'Mehraj', to: 'Mehraj Shaikh', squad: '37', why: 'substitute repeats the captain by first name' },
  { from: 'Vidya', to: 'Vidya Shinde', squad: '37', why: 'substitute repeats the VC by first name' },
  { from: 'Shubham', to: 'Shubham Khemkar', squad: '13', why: 'VC given by first name only' },
];

/** The same name, but not the same person: different process, nothing else in common. */
const SPLITS: Array<{ name: string; squad: string; why: string }> = [
  { name: 'Akshay Patil', squad: '24', why: 'RND player; the other Akshay Patil is the Aviva AR vice-captain (UID 521186)' },
  { name: 'Affan Shaikh', squad: '16', why: 'IAG player; the other Affan Shaikh is an Algonquin substitute' },
];

// ---------------------------------------------------------------------------
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const nameKey = (s: string) => tidy(s).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const looseKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "ATHARV SALUNKHE" and "soham lukhi" read as names; "P. Khavei" and "M Sanjit Singh" are left alone. */
function displayName(raw: string): string {
  return tidy(raw).split(' ').map((w) => {
    const letters = w.replace(/[^A-Za-z]/g, '');
    if (letters.length < 2) return w;
    if (letters === letters.toUpperCase() || letters === letters.toLowerCase()) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }
    return w;
  }).join(' ');
}

function cleanUid(raw?: string): string | undefined {
  if (isBlank(raw)) return undefined;
  return raw!.trim().replace(/^u/i, '');
}

/** The first valid Indian mobile in a cell ("9876543210 / 9123456780" -> the first). */
function cleanPhone(raw?: string): { phone?: string; bad?: string } {
  if (isBlank(raw)) return {};
  for (const part of raw!.split(/[\/,;]/)) {
    const d = part.replace(/\D/g, '').slice(-10);
    if (/^[6-9]\d{9}$/.test(d)) return { phone: d };
  }
  return { bad: raw!.trim() };
}

/** Scoreboard code, 12 chars max: "Centrica Super Kings - CSK" -> CSK, "UK IWR United" -> UIU, "Algonkings" -> ALGO. */
function shortCode(name: string): string {
  const tag = name.match(/ - ([A-Za-z0-9]{2,6})$/);
  if (tag) return tag[1].toUpperCase();
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  let code = words.map((w) => w[0]).join('').slice(0, 4);
  if (code.length < 3) code = words[0].slice(0, 3 - (words.length - 1)) + words.slice(1).map((w) => w[0]).join('');
  return code.toUpperCase();
}

/** "9:00 AM" -> "09:00" */
function clock24(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) throw new Error(`unreadable time: ${raw}`);
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// ===========================================================================
export function wnsBlueprint(): EventSetupBlueprint {
  const findings: Finding[] = [];
  const teams = parseCsv(readFileSync(path.join(DATA, 'teams.csv'), 'utf8'));

  // ---- people -------------------------------------------------------------
  const aliasOf = (name: string, squad: string): string => {
    const k = nameKey(name);
    const a = ALIASES.find((x) => nameKey(x.from) === k && (!x.squad || x.squad === squad));
    return a ? nameKey(a.to) : k;
  };
  const personKeyOf = (name: string, squad: string): string => {
    const k = aliasOf(name, squad);
    const split = SPLITS.find((s) => nameKey(s.name) === k && s.squad === squad);
    return split ? `${k}#${squad}` : k;
  };

  const people = new Map<string, PersonSpec & { uids: Set<string>; phones: Set<string>; squads: Set<string> }>();
  const touch = (rawName: string, squad: string) => {
    const key = personKeyOf(rawName, squad);
    if (!people.has(key)) {
      // The display form is the canonical spelling where an alias pointed at one.
      const alias = ALIASES.find((x) => nameKey(x.to) === key.split('#')[0]);
      people.set(key, {
        key, name: displayName(alias ? alias.to : rawName),
        uids: new Set(), phones: new Set(), squads: new Set(),
      });
    }
    const p = people.get(key)!;
    p.squads.add(squad);
    return p;
  };

  // ---- squads ---------------------------------------------------------------
  const PLAYER_COLS = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5', 'Player 6'];
  const SUB_COLS = ['Substitute Player 1', 'Substitute Player 2'];
  const ROLE_RANK = { captain: 0, vice_captain: 1, player: 2, substitute: 3 } as const;
  const badPhones: string[] = [];
  const dupInSquad: string[] = [];
  const offList: string[] = [];

  const squads: Array<SquadSpec & { process: string | null; raw: Record<string, string> }> = [];
  for (const r of teams) {
    const id = r['ID'];
    const members = new Map<string, SquadSpec['members'][number]['role']>();
    const put = (rawName: string, role: SquadSpec['members'][number]['role']) => {
      const p = touch(rawName, id);
      const had = members.get(p.key);
      if (had && (role === 'player' || role === 'substitute')) dupInSquad.push(`${id} ${r['Team Name'] || r['Process Name']}: ${tidy(rawName)}`);
      if (!had || ROLE_RANK[role] < ROLE_RANK[had]) members.set(p.key, role);
      return p;
    };
    for (const c of PLAYER_COLS) if (!isBlank(r[c])) put(r[c], 'player');
    for (const c of SUB_COLS) if (!isBlank(r[c])) put(r[c], 'substitute');

    for (const [nameCol, uidCol, phoneCol, role] of [
      ["Captain's Name", "Captain's UID", 'Captain Mobile', 'captain'],
      ['Vice Captain', "Vice Captain's UID", 'Vice Captain Mobile', 'vice_captain'],
    ] as const) {
      if (isBlank(r[nameCol])) continue;
      const listed = members.has(personKeyOf(r[nameCol], id));
      const p = put(r[nameCol], role);
      if (!listed) offList.push(`${id} ${r['Team Name']}: ${role === 'captain' ? 'captain' : 'vice-captain'} ${p.name}`);
      const uid = cleanUid(r[uidCol]);
      if (uid) p.uids.add(uid);
      const { phone, bad } = cleanPhone(r[phoneCol]);
      if (phone) p.phones.add(phone);
      if (bad) badPhones.push(`${p.name} (${id}): "${bad}"`);
    }

    squads.push({
      key: `s${id}`, drawKey: 'football', name: tidy(r['Team Name']), shortName: '', competitorKey: `s${id}`,
      section: r['Bracket'],
      members: [...members].map(([personKey, role]) => ({ personKey, role })),
      process: isBlank(r['Process Name']) ? null : tidy(r['Process Name']),
      raw: r,
    });
  }

  // ---- names: squads, then batches ------------------------------------------
  // A blank team name falls back to its process (row 19: "MCC CI"). Two squads with
  // one name are told apart by process, and by captain when even that is shared.
  for (const s of squads) if (!s.name) s.name = s.process ?? `Squad ${s.raw['ID']}`;
  const renamed: string[] = [];
  const byName = new Map<string, typeof squads>();
  for (const s of squads) byName.set(s.name.toLowerCase(), [...(byName.get(s.name.toLowerCase()) ?? []), s]);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const sameProcess = new Set(group.map((s) => s.process?.toLowerCase())).size < group.length;
    for (const s of group) {
      const before = s.name;
      s.name = sameProcess ? `${s.name} (${displayName(s.raw["Captain's Name"])})` : `${s.name} (${s.process})`;
      renamed.push(`${s.raw['ID']}: "${before}" -> "${s.name}"`);
    }
  }
  const usedCodes = new Set<string>();
  for (const s of squads) {
    let code = shortCode(s.name);
    for (let n = 2; usedCodes.has(code); n++) code = `${shortCode(s.name).slice(0, 11)}${n}`;
    usedCodes.add(code);
    s.shortName = code;
  }

  // ONE BATCH PER SQUAD. The database lets a unit field one squad per draw, and ten
  // processes field two or three — so the batch is the process where the process has
  // one squad, and "<process> · <squad>" where it has more. Standings read by batch.
  const byProcess = new Map<string, typeof squads>();
  for (const s of squads) {
    const k = s.process?.toLowerCase() ?? `#${s.key}`;
    byProcess.set(k, [...(byProcess.get(k) ?? []), s]);
  }
  const units: SetupCompetitorSpec[] = [];
  const noProcess: string[] = [];
  for (const group of byProcess.values()) {
    const processName = group[0].process;
    for (const s of group) {
      const name = !processName ? s.name : group.length === 1 ? processName : `${processName} · ${s.name}`;
      if (!processName) noProcess.push(`${s.raw['ID']} ${s.name}`);
      units.push({ key: s.competitorKey, name, kind: 'department', code: s.shortName });
    }
  }

  // THE NAME ON SCREEN IS THE SHEET'S "Team Name SGN EOS", exactly as WNS wrote it
  // ("Algonkings - Algonquin (Pradeep Mahato)") — the user's instruction, 2026-10-15.
  // The plain names above still give the scoreboard codes and the batch names; the
  // schedule is matched on the plain "Team Name" column, which is what it quotes.
  for (const s of squads) {
    const sgn = tidy(s.raw['Team Name SGN EOS'] ?? '');
    if (sgn) s.name = sgn;
  }

  // ---- contacts ---------------------------------------------------------------
  // A number on two different people is a coordinator's, not either player's: it
  // is left off both and they get placeholders like everyone without one.
  const phoneOwners = new Map<string, string[]>();
  for (const p of people.values()) for (const ph of p.phones) phoneOwners.set(ph, [...(phoneOwners.get(ph) ?? []), p.key]);
  const sharedPhones: string[] = [];
  for (const [ph, owners] of phoneOwners) {
    if (owners.length < 2) continue;
    sharedPhones.push(`${ph.slice(0, 2)}xxxxxx${ph.slice(-2)}: ${owners.map((k) => people.get(k)!.name).join(', ')}`);
    for (const k of owners) people.get(k)!.phones.delete(ph);
  }
  const twoUids = [...people.values()].filter((p) => p.uids.size > 1).map((p) => `${p.name}: ${[...p.uids].join(' / ')}`);

  const personSpecs: PersonSpec[] = [...people.values()].map((p) => ({
    key: p.key, name: p.name, memberCode: [...p.uids][0], phone: [...p.phones][0],
  }));

  // ---- the schedule -----------------------------------------------------------
  const squadIn = (section: string, raw: string): string => {
    const want = looseKey(raw);
    const hits = squads.filter((s) => s.section === section && [
      looseKey(s.raw['Team Name']), looseKey(s.name), looseKey(s.process ?? ''),
    ].some((k) => k && (k === want || k.startsWith(want))));
    if (hits.length !== 1) throw new Error(`schedule: "${raw}" in bracket ${section} matches ${hits.length} squads`);
    return hits[0].key;
  };
  const sched = readFileSync(path.join(DATA, 'schedule.tsv'), 'utf8').split(/\r?\n/).filter(Boolean).slice(1)
    .map((line) => line.split('\t').map((c) => c.trim()));
  const rows: MatchRowSpec[] = sched.map(([day, turf, bracket, , matchId, kick, end, t1, t2]) => {
    const side = (raw: string): MatchSide => {
      const w = raw.match(/^Winner of (.+)$/i);
      return w ? { winnerOf: w[1].trim() } : { squadKey: squadIn(bracket, raw) };
    };
    const kickoff = clock24(kick);
    const date = DAYS[day];
    if (!date) throw new Error(`schedule: unknown day "${day}"`);
    return {
      matchId, date, kickoff, minutes: minutesOf(clock24(end)) - minutesOf(kickoff),
      groundKey: `turf${turf.replace(/\D/g, '')}`, home: side(t1), away: side(t2),
    };
  });

  // ---- findings -----------------------------------------------------------------
  const overlaps: string[] = [];
  for (let i = 0; i < squads.length; i++) {
    for (let j = i + 1; j < squads.length; j++) {
      const a = new Set(squads[i].members.map((m) => m.personKey));
      const shared = squads[j].members.filter((m) => a.has(m.personKey)).length;
      if (shared >= 3) overlaps.push(`${squads[i].name} <> ${squads[j].name}: ${shared} shared`);
    }
  }
  const multi = [...people.values()].filter((p) => p.squads.size > 1)
    .map((p) => `${p.name}: ${[...p.squads].map((id) => squads.find((s) => s.raw['ID'] === id)!.name).join(', ')}`);
  const short = squads.filter((s) => s.members.length < 6).map((s) => `${s.name}: ${s.members.length}`);
  const noUid = squads.filter((s) => isBlank(s.raw["Captain's UID"])).map((s) => `${s.name} (${s.raw["Captain's Name"]})`);
  const withPhone = personSpecs.filter((p) => p.phone).length;

  const add = (severity: Finding['severity'], topic: string, detail: string, list?: string[]) => {
    if (!list || list.length) findings.push({ severity, topic, detail, rows: list });
  };
  add('review', 'Re-registered squads', 'Pairs of squads sharing 3+ players, usually with the same captain UID. All kept (decided 2026-10-15); WNS should confirm both entries are meant.', overlaps);
  add('review', 'People in more than one squad', 'The same name is treated as the same person. Legal on the platform; listed for WNS to confirm.', multi);
  add('fix', 'Spelling variants merged', 'Read as one person each.', ALIASES.map((a) => `${a.from} = ${a.to}${a.squad ? ` (squad ${a.squad} only)` : ''} — ${a.why}`));
  add('fix', 'Same name, different person', 'Kept as separate accounts.', SPLITS.map((s) => `${s.name} in squad ${s.squad} — ${s.why}`));
  add('info', 'Same team name twice', 'Squads show the sheet\'s "Team Name SGN EOS", which already tells these apart. Their batches use the plain name plus process or captain.', renamed);
  add('info', 'Squads with no process', 'Their batch is named after the squad.', noProcess);
  add('info', 'Captain / vice-captain not in the player list', 'Added to the squad in that role.', offList);
  add('info', 'Listed twice in one squad', 'Kept once.', dupInSquad);
  add('fix', 'Unusable mobile numbers', 'Given a placeholder instead.', badPhones);
  add('fix', 'One number on several people', 'A coordinator number, not a personal one: left off and placeholders given.', sharedPhones);
  add('review', 'Two UIDs on one person', 'The first is used as the member code.', twoUids);
  add('review', 'Short squads', 'Fewer than 6 named people.', short);
  add('review', 'Captain with no UID', 'No member code for these captains.', noUid);
  add('info', 'Contacts', `${withPhone} of ${personSpecs.length} people have a real mobile (captains and vice-captains). Everyone else gets a placeholder phone and email for super admin to replace at registration.`);
  add('info', 'Location column not used', 'Free text (14 spellings of 3 sites, 8 squads list all three), so every batch sits under the one Pune campus.');

  return {
    key: 'wns-football-2026',
    eventType: 'intra',
    steps: {
      org: 'sheet', campus: 'sheet', competitors: 'sheet', people: 'sheet', staff: 'sheet',
      championship: 'sheet', venue: 'sheet', draws: 'sheet', squads: 'sheet', fixtures: 'sheet',
    },
    org: {
      name: 'WNS', shortName: 'WNS', city: 'Pune', country: 'India',
      unitLabels: { campus: 'Campus', department: 'Batch' }, plan: 'max',
    },
    campus: { key: 'pune', name: 'Pune', code: 'PUN' },
    competitors: units,
    people: personSpecs,
    staff: [
      { key: 'rohit', name: 'Rohit Gupta', existingEmail: 'rohit@sportagon.in', eventRole: 'organiser', note: 'Sportagon · runs the event' },
      { key: 'wnsadmin', name: 'WNS Sports Admin', orgRole: 'owner', eventRole: 'organiser', note: 'WNS owner of the org — replace the placeholder with the real person' },
      ...[1, 2, 3, 4].map((n) => ({
        key: `ref${n}`, name: `Turf ${n} Referee`, orgRole: 'member' as const, eventRole: 'official' as const,
        groundKey: `turf${n}`, note: `Scores every match on Turf ${n}`,
      })),
    ],
    championship: {
      name: 'WNS Football Championship 2026',
      description: 'Inter-process 6-a-side football for WNS Pune: 55 squads, four turfs, knockout, 17–18 October 2026.',
      startDate: '2026-10-17', endDate: '2026-10-18',
      entryLevel: 'department', scopeToCampus: true,
      visibility: 'public', status: 'registration_open', type: 'single_sport',
      placement: { winner: 10, runner_up: 7, semi_finalist: 4, participation: 1 },
    },
    venue: {
      name: 'WNS Football Turfs', city: 'Pune',
      grounds: [1, 2, 3, 4].map((n) => ({ key: `turf${n}`, name: `Turf ${n}`, type: 'field' as const })),
    },
    draws: [{
      key: 'football', sport: 'Football', discipline: 'Mixed', format: 'Knockout',
      squadMin: 5, squadMax: 10, thirdPlace: false,
      scoring: {
        presetKey: 'fest_2x10_ko', name: 'WNS Football — 2 × 10 min, 5 min extra time, penalties',
        // The WHOLE match: two halves of 10.
        matchMinutes: 20, extraTimeMinutes: 5, penaltyKicks: 5,
      },
    }],
    squads: squads.map(({ process: _p, raw: _r, ...s }) => s),
    fixtures: [{ kind: 'knockout-rows', drawKey: 'football', utcOffset: '+05:30', rows }],
    placeholder: { emailStem: 'wns' },
    findings,
  };
}
