// Second insights seed: 4 copies of the existing TT team tie (partner history, a field of
// players for percentiles) and 5 recent admin-vs-giants singles (a run and a trend).
// Every match is played through the kernel and locked through the real lock path.
import {
  initKernel, parseStoredFormat, rallyTiming, resultEnvelope, step,
  type RallyEvent, type ScoringFormat, type Side,
} from '@semp/shared';
import { prisma } from './src/infra/prisma.js';
import { lockScorecard } from './src/modules/fixtures/lock.service.js';

const TAG = 'insights-demo-seed-2';
const TIE_MODEL = '437ec1ba-e4da-49f6-89e7-a2b9bd9685e5';
const SINGLES_MODEL = '470b75fa-e849-47fc-b3cd-8e7b4b1a46dc';

let seed = 51001;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

/** Play one match point by point. pServe = chance the server wins the rally, per side. */
function play(format: ScoringFormat, first: Side, pServe: Record<Side, number>, startMs: number) {
  let state = initKernel(format, first);
  const log: RallyEvent[] = [];
  let t = startMs;
  while (!state.ended && log.length < 400) {
    const server = state.serve.side;
    const winner: Side = rand() < pServe[server] ? server : (server === 'A' ? 'B' : 'A');
    t += 15_000 + Math.floor(rand() * 20_000);
    const ev: RallyEvent = { t: 'point', side: winner, at: new Date(t).toISOString() };
    log.push(ev);
    state = step(format, state, ev).state;
  }
  return { log, env: resultEnvelope(format, state), endMs: t };
}

/** Replay until the intended side wins - deterministic, so a re-run makes the same matches. */
function playUntil(format: ScoringFormat, first: Side, pServe: Record<Side, number>, startMs: number, want: Side) {
  for (let i = 0; i < 50; i++) {
    const r = play(format, first, pServe, startMs);
    if (r.env.winner === want) return r;
  }
  throw new Error('could not produce the intended winner');
}

async function main() {
  if (await prisma.fixtures.count({ where: { notes: TAG } })) { console.log('already seeded - nothing to do'); return; }

  // ---- 1 · four copies of the team tie --------------------------------------------
  const tie = await prisma.fixtures.findUnique({ where: { id: TIE_MODEL } });
  if (!tie) throw new Error('tie model not found');
  const winners: Side[] = ['A', 'A', 'B', 'A']; // home (devils/player side) takes 3 of 4
  for (const [i, want] of winners.entries()) {
    const day = Date.UTC(2026, 8, 28 + i, 9, 0, 0);
    const ls: any = structuredClone(tie.live_state);
    let t = day;
    let won = { A: 0, B: 0 };
    for (const r of ls.tie.rubbers) {
      if (!r.lineup) continue; // the dead rubbers stay as they were
      const format = parseStoredFormat(r.format)!;
      const first: Side = i % 2 === 0 ? 'A' : 'B';
      const res = playUntil(format, first, { A: want === 'A' ? 0.62 : 0.5, B: want === 'B' ? 0.62 : 0.5 }, t, want);
      r.rally = res.log;
      r.firstServer = first;
      r.winner = want;
      r.status = 'completed';
      t = res.endMs + 120_000;
      won[want] += 1;
    }
    const fx = await prisma.fixtures.create({
      data: {
        tournament_discipline_id: tie.tournament_discipline_id,
        home_team_id: tie.home_team_id, away_team_id: tie.away_team_id,
        round: 'Practice', bracket_position: null,
        scheduled_at: new Date(day), status: 'completed', completed_at: new Date(t),
        home_score: won.A, away_score: won.B,
        winner_team_id: want === 'A' ? tie.home_team_id : tie.away_team_id,
        scorecard_status: 'submitted', submitted_at: new Date(t), notes: TAG,
        live_state: ls,
      },
    });
    await lockScorecard(prisma, null, fx.id);
    console.log(`tie ${i + 1}: ${won.A}-${won.B} to ${want === 'A' ? 'home (giants/player/devils)' : 'away (admin/ananya/knights)'} - locked`);
  }

  // ---- 2 · five recent singles: admin serves far better and wins them all ----------
  const single = await prisma.fixtures.findUnique({ where: { id: SINGLES_MODEL } });
  const format = parseStoredFormat((single!.live_state as any)?.format)!;
  for (let i = 0; i < 5; i++) {
    const day = Date.UTC(2026, 9, 5, 9 + i, 0, 0); // 5 Oct, the most recent
    const first: Side = i % 2 === 0 ? 'A' : 'B';
    const res = playUntil(format, first, { A: 0.8, B: 0.5 }, day, 'A'); // A = admin (home)
    const fx = await prisma.fixtures.create({
      data: {
        tournament_discipline_id: single!.tournament_discipline_id,
        home_team_id: single!.home_team_id, away_team_id: single!.away_team_id,
        round: 'Practice', scheduled_at: new Date(day), status: 'completed', completed_at: new Date(res.endMs),
        home_score: res.env.headline[0], away_score: res.env.headline[1], winner_team_id: single!.home_team_id,
        scorecard_status: 'submitted', submitted_at: new Date(res.endMs), notes: TAG,
        live_state: { rally: res.log, firstServer: first, format, timing: rallyTiming(format, res.log, first) } as any,
      },
    });
    await lockScorecard(prisma, null, fx.id);
    console.log(`singles ${i + 1}: admin ${res.env.headline.join('-')} (${res.env.unitScores.map((u) => u.join('-')).join(', ')}) - locked`);
  }
}
main().catch((e) => console.error('FAILED:', e?.message ?? e)).finally(() => prisma.$disconnect());
