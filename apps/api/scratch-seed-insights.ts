// Seeds 8 locked table tennis singles matches between two existing test players, played
// point by point through the real kernel and locked through the real lock path, so the
// insights card has enough history. Tagged in `notes` so it can be found and removed.
import {
  foldRally, parseStoredFormat, rallyTiming, resultEnvelope, step, initKernel, type RallyEvent, type Side,
} from '@semp/shared';
import { prisma } from './src/infra/prisma.js';
import { lockScorecard } from './src/modules/fixtures/lock.service.js';

const TAG = 'insights-demo-seed';
const MODEL_FIXTURE = '470b75fa-e849-47fc-b3cd-8e7b4b1a46dc'; // admin (home) vs giants (away), TT Men's Singles

// Deterministic, so a re-run makes the same matches.
let seed = 20261005;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

async function main() {
  const already = await prisma.fixtures.count({ where: { notes: TAG } });
  if (already > 0) { console.log(`already seeded (${already} fixtures tagged ${TAG}) - nothing to do`); return; }

  const model = await prisma.fixtures.findUnique({ where: { id: MODEL_FIXTURE } });
  if (!model) throw new Error('model fixture not found');
  const format = parseStoredFormat((model.live_state as any)?.format);
  if (!format) throw new Error('model fixture has no frozen format');

  // Older matches first. The admin (A) serves better in the later ones - a rising trend.
  const plan = [
    { pA: 0.56, pB: 0.62 }, { pA: 0.58, pB: 0.60 }, { pA: 0.57, pB: 0.62 },
    { pA: 0.70, pB: 0.56 }, { pA: 0.72, pB: 0.55 }, { pA: 0.71, pB: 0.57 }, { pA: 0.73, pB: 0.54 }, { pA: 0.72, pB: 0.55 },
  ];

  for (const [i, p] of plan.entries()) {
    const day = new Date(Date.UTC(2026, 8, 24 + i, 10, 0, 0)); // 24 Sep onwards, one a day
    const first: Side = i % 2 === 0 ? 'A' : 'B';
    let state = initKernel(format, first);
    const log: RallyEvent[] = [];
    let t = day.getTime();
    while (!state.ended && log.length < 400) {
      const server = state.serve.side;
      const serverWins = rand() < (server === 'A' ? p.pA : p.pB);
      const winner: Side = serverWins ? server : (server === 'A' ? 'B' : 'A');
      t += 15_000 + Math.floor(rand() * 20_000);
      const ev: RallyEvent = { t: 'point', side: winner, at: new Date(t).toISOString() };
      log.push(ev);
      state = step(format, state, ev).state;
    }
    const env = resultEnvelope(format, foldRally(format, log, first).state);
    const winnerTeam = env.winner === 'A' ? model.home_team_id : env.winner === 'B' ? model.away_team_id : null;

    const fx = await prisma.fixtures.create({
      data: {
        tournament_discipline_id: model.tournament_discipline_id,
        home_team_id: model.home_team_id,
        away_team_id: model.away_team_id,
        round: 'Practice',
        scheduled_at: day,
        status: 'completed',
        completed_at: new Date(t),
        home_score: env.headline[0],
        away_score: env.headline[1],
        winner_team_id: winnerTeam,
        scorecard_status: 'submitted',
        submitted_at: new Date(t),
        notes: TAG,
        live_state: { rally: log, firstServer: first, format, timing: rallyTiming(format, log, first) } as any,
      },
    });
    await lockScorecard(prisma, null, fx.id);
    console.log(`match ${i + 1}: ${env.headline.join('-')} in games (${env.unitScores.map((u) => u.join('-')).join(', ')}) winner ${env.winner === 'A' ? 'admin' : 'giants'} - locked`);
  }
}
main().catch((e) => console.error('FAILED:', e?.message ?? e)).finally(() => prisma.$disconnect());
