import { describe, it, expect, vi } from 'vitest';
import { applyShape } from './apply-template.js';
import { captureShape } from './templates.service.js';
import type { TemplateShape } from './templates.service.js';

// Templates are data now - both the built-ins seeded as `is_system` rows and the ones
// organisers save from their own events. That makes the round trip the thing worth
// pinning down: what capture() reads out has to be exactly what apply() can put back.
//
// The bug this guards against already happened once. Four of the six sports in the old
// hardcoded multi-sport template created a tournament_sport and NO draw, because a
// sport with no named disciplines still needs one sport-level draw
// (discipline_id: null) for anything to be enterable. A championship that looks
// configured and cannot be entered is the worst possible failure here, because nobody
// notices until entries open.

const fmt = (id: string, name: string) => ({ id, name });

// A stand-in for the Prisma client, recording what would be written.
function fakeDb(opts: {
  sports?: Record<string, string>;
  disciplines?: Record<string, string>;
  formats?: { id: string; name: string }[];
  existingSports?: string[];
} = {}) {
  const sports = opts.sports ?? { football: 'sp-football', badminton: 'sp-badminton' };
  const disciplines = opts.disciplines ?? { "men's singles": 'di-ms' };
  const formats = opts.formats ?? [fmt('fm-ko', 'Knockout'), fmt('fm-rr', 'Round Robin')];
  const created: { sports: any[]; draws: any[]; rules: any[] } = { sports: [], draws: [], rules: [] };
  const existingSports = new Set(opts.existingSports ?? []);

  const db: any = {
    _created: created,
    tournaments: { findFirst: vi.fn().mockResolvedValue({ id: 'tn1' }) },
    tournament_formats: {
      findMany: vi.fn(async ({ where }: any) => {
        const wanted = (where.OR ?? []).map((o: any) => o.name.equals.toLowerCase());
        return formats.filter((f) => wanted.includes(f.name.toLowerCase()));
      }),
      findFirst: vi.fn().mockResolvedValue(formats[0] ?? null),
    },
    sports: {
      findFirst: vi.fn(async ({ where }: any) => {
        const id = sports[where.name.equals.toLowerCase()];
        return id ? { id } : null;
      }),
    },
    disciplines: {
      findFirst: vi.fn(async ({ where }: any) => {
        const id = disciplines[where.name.equals.toLowerCase()];
        return id ? { id } : null;
      }),
    },
    tournament_sports: {
      findFirst: vi.fn(async ({ where }: any) => (existingSports.has(where.sport_id) ? { id: `ts-${where.sport_id}` } : null)),
      create: vi.fn(async ({ data }: any) => { created.sports.push(data); return { id: `ts-${data.sport_id}` }; }),
    },
    tournament_disciplines: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: any) => { created.draws.push(data); return { id: `td-${created.draws.length}` }; }),
    },
    standings_rules: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: any) => { created.rules.push(data); return data; }),
    },
    championships: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  return db;
}

const shape = (over: Partial<TemplateShape> = {}): TemplateShape =>
  ({ type: null, scheme: null, draws: [], ...over });

describe('applying a template shape', () => {
  it('gives a sport with no named disciplines one sport-level draw', async () => {
    const db = fakeDb();
    const res = await applyShape(db, 'ch1', shape({
      draws: [{ sport: 'Football', format: 'Knockout', disciplines: [] }],
    }));

    expect(res.sports_added).toBe(1);
    // The whole point: one draw, with a null discipline, so entries have somewhere to go.
    expect(res.disciplines_added).toBe(1);
    expect(db._created.draws).toEqual([
      { tournament_sport_id: 'ts-sp-football', discipline_id: null, format_id: 'fm-ko', status: 'upcoming' },
    ]);
  });

  it('creates one draw per named discipline instead', async () => {
    const db = fakeDb();
    const res = await applyShape(db, 'ch1', shape({
      draws: [{ sport: 'Badminton', format: 'Knockout', disciplines: ["Men's Singles"] }],
    }));

    expect(res.disciplines_added).toBe(1);
    expect(db._created.draws[0].discipline_id).toBe('di-ms');
  });

  it('reports names the catalogue does not have rather than inventing them', async () => {
    const db = fakeDb();
    const res = await applyShape(db, 'ch1', shape({
      draws: [
        { sport: 'Kabaddi', format: 'Knockout', disciplines: [] },
        { sport: 'Badminton', format: 'Knockout', disciplines: ['Mixed Doubles'] },
      ],
    }));

    expect(res.skipped).toContain('Kabaddi');
    expect(res.skipped).toContain('Badminton · Mixed Doubles');
    // Nothing was created for either, and no catalogue row was added.
    expect(db._created.draws).toHaveLength(0);
    expect(db.sports.findFirst).toHaveBeenCalled();
  });

  it('falls back when a named format has left the catalogue, and says so', async () => {
    const db = fakeDb();
    const res = await applyShape(db, 'ch1', shape({
      draws: [{ sport: 'Football', format: 'Swiss', disciplines: [] }],
    }));

    expect(res.sports_added).toBe(1);
    expect(res.skipped.join(' ')).toMatch(/no longer in the catalogue/);
    // Still created, on some real format, rather than failing the whole apply.
    expect(db._created.sports[0].format_id).toBe('fm-ko');
  });

  it('is idempotent: re-applying adds nothing the second time', async () => {
    const db = fakeDb({ existingSports: ['sp-football'] });
    db.tournament_disciplines.findFirst.mockResolvedValue({ id: 'td-existing' });

    const res = await applyShape(db, 'ch1', shape({
      draws: [{ sport: 'Football', format: 'Knockout', disciplines: [] }],
    }));

    expect(res.sports_added).toBe(0);
    expect(res.disciplines_added).toBe(0);
    expect(db._created.draws).toHaveLength(0);
  });

  it('carries the scheme, and fills the type only when it is blank', async () => {
    const db = fakeDb();
    await applyShape(db, 'ch1', shape({
      type: 'multi_sport', scheme: 'medal',
      draws: [{ sport: 'Football', format: 'Knockout', disciplines: [] }],
    }));

    expect(db._created.rules[0].config).toEqual({ scheme: 'medal' });
    // updateMany, not update: the where clause carries `type: null`, so an answer the
    // organiser gave in the wizard is never overwritten by the template.
    expect(db.championships.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ch1', type: null } }),
    );
  });

  it('does nothing at all for an empty shape', async () => {
    const db = fakeDb();
    const res = await applyShape(db, 'ch1', shape());
    expect(res).toEqual({ sports_added: 0, disciplines_added: 0, skipped: [] });
    expect(db.tournaments.findFirst).not.toHaveBeenCalled();
  });
});

describe('capturing a shape from a championship', () => {
  const captureDb = (rows: any[], type: string | null = 'multi_sport', scheme = 'medal') => ({
    championships: { findUnique: vi.fn().mockResolvedValue({ id: 'ch1', type }) },
    tournament_sports: { findMany: vi.fn().mockResolvedValue(rows) },
    standings_rules: { findFirst: vi.fn().mockResolvedValue({ config: { scheme } }) },
  }) as any;

  it('reads sports, formats and disciplines back out by name', async () => {
    const captured = await captureShape(captureDb([
      {
        sports: { name: 'Football' },
        tournament_formats: { name: 'Knockout' },
        tournament_disciplines: [{ disciplines: null }],
      },
      {
        sports: { name: 'Badminton' },
        tournament_formats: { name: 'Knockout' },
        tournament_disciplines: [{ disciplines: { name: "Men's Singles" } }, { disciplines: { name: "Women's Singles" } }],
      },
    ]), 'ch1');

    expect(captured).toEqual({
      type: 'multi_sport',
      scheme: 'medal',
      draws: [
        // The sport-level draw records NO discipline names - which is exactly what
        // makes apply() re-create it as a null-discipline draw.
        { sport: 'Football', format: 'Knockout', disciplines: [] },
        { sport: 'Badminton', format: 'Knockout', disciplines: ["Men's Singles", "Women's Singles"] },
      ],
    });
  });

  it('survives a round trip: what is captured is what is re-created', async () => {
    const captured = await captureShape(captureDb([
      { sports: { name: 'Football' }, tournament_formats: { name: 'Knockout' }, tournament_disciplines: [{ disciplines: null }] },
      { sports: { name: 'Badminton' }, tournament_formats: { name: 'Knockout' }, tournament_disciplines: [{ disciplines: { name: "Men's Singles" } }] },
    ]), 'ch1');

    const db = fakeDb();
    const res = await applyShape(db, 'ch2', captured);

    expect(res.skipped).toEqual([]);
    expect(res.sports_added).toBe(2);
    expect(res.disciplines_added).toBe(2);
    expect(db._created.draws.map((d: any) => d.discipline_id)).toEqual([null, 'di-ms']);
  });
});
