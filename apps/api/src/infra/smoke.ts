/* End-to-end smoke test: replays the TechFest 2025 story against the running API.
   Run the API first (npm run dev), then: npm run smoke  */
import { env } from '../config/env.js';

const BASE = `http://localhost:${env.PORT}/api`;
let token = '';

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return data;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
  console.log('  ✓ ' + msg);
}

async function main() {
  // Auth
  ({ token } = await api('POST', '/auth/login', { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD }));
  console.log('Phase 0: logged in as admin');

  const sports = await api('GET', '/sports');
  const formats = await api('GET', '/tournament-formats');
  const cricket = sports.find((s: any) => s.name === 'Cricket');
  const knockout = formats.find((f: any) => f.name === 'Knockout');

  // Phase 2: event creation
  const slug = `techfest-${Date.now()}`;
  const event = await api('POST', '/events', { name: 'TechFest 2025', slug, start_date: '2025-10-01', end_date: '2025-10-05' });
  const venue = await api('POST', '/venues', { event_id: event.id, name: 'Gymkhana Sports Complex' });
  await api('POST', '/venue-grounds', { venue_id: venue.id, name: 'Court 1', ground_type: 'court' });
  await api('POST', '/sponsors', { event_id: event.id, name: 'Acme Corp', tier: 'gold' });
  const tournament = await api('POST', '/tournaments', { event_id: event.id, name: 'TechFest 2025 Sports Meet' });
  const ts = await api('POST', '/tournament-sports', { tournament_id: tournament.id, sport_id: cricket.id, format_id: knockout.id, format_config: { third_place_match: true } });
  const td = await api('POST', '/tournament-disciplines', { tournament_sport_id: ts.id, discipline_id: null, venue_id: venue.id });
  console.log('Phase 2: event, venue, ground, sponsor, tournament, sport, discipline created');

  const opened = await api('PATCH', `/events/${event.id}/status`, { status: 'registration_open' });
  assert(opened.status === 'registration_open', 'event moved to registration_open');

  // Phase 3: enrollment
  const inst = await api('POST', '/institutions', { name: `IIT Bombay ${Date.now()}`, short_name: 'IITB' });
  const enrollment = await api('POST', `/events/${event.id}/enroll`, { institution_id: inst.id });
  assert(enrollment.status === 'pending', 'enrollment created as pending');
  const approved = await api('PATCH', `/event-institutions/${enrollment.id}`, { status: 'approved' });
  assert(approved.status === 'approved' && approved.reviewed_at, 'enrollment approved & stamped');

  // assign Captain role to admin (single-user demo)
  const roles = await api('GET', '/roles');
  const captain = roles.find((r: any) => r.name === 'Captain');
  const me = await api('GET', '/auth/me');
  await api('POST', `/events/${event.id}/roles`, { user_id: me.id, role_id: captain.id });
  console.log('Phase 3: institution enrolled, approved, Captain assigned');

  // Phase 4: teams (8 for a knockout)
  const teams: any[] = [];
  for (let i = 1; i <= 8; i++) {
    teams.push(await api('POST', '/teams', {
      event_id: event.id, sport_id: cricket.id, institution_id: inst.id,
      event_institution_id: enrollment.id, tournament_discipline_id: td.id, name: `Team ${i}`,
    }));
  }
  assert(teams.length === 8, '8 teams created for the Cricket draw');

  // roster on a team: add admin as member then lock (Cricket squad 1..15)
  await api('POST', `/teams/${teams[0].id}/members`, { user_id: me.id, role: 'captain' });
  const locked = await api('POST', `/teams/${teams[0].id}/lock`, {});
  assert(locked.status === 'roster_locked', 'roster locked after meeting squad min');

  // Phase 5: generate knockout fixtures
  const fixtures = await api('POST', `/tournament-disciplines/${td.id}/fixtures/generate`, { team_ids: teams.map((t) => t.id), params: { third_place_match: true } });
  // 8 teams knockout = 7 matches + 1 third-place = 8
  assert(fixtures.length === 8, `knockout produced ${fixtures.length} fixtures (7 + 3rd place)`);
  const finals = fixtures.filter((f: any) => f.round === 'Final');
  assert(finals.length === 1, 'exactly one Final');
  assert(fixtures.filter((f: any) => f.round === 'QF').length === 4, '4 quarter-finals');

  console.log('\nALL PHASES PASSED ✅  (event ' + slug + ')');
}

main().catch((e) => { console.error('\n' + e.message); process.exit(1); });
