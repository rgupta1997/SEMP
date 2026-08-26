import type { Request } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { audit } from '../iam/audit.service.js';
import { loadTemplateFor, type TemplateShape } from './templates.service.js';

// Applying a championship template (J2-E1-S1).
//
// Templates are rows now, not a const - both the built-ins and the ones people save
// from their own events - so this reads a shape out of the database and replays it.
//
// The shape names sports, formats and disciplines; this resolves those names against
// the global catalogue and creates the draws. Anything the catalogue doesn't have is
// REPORTED, not invented: silently creating a sport called "Ultimate Frisbee" because a
// template mentioned it would let one person's typo pollute the master catalogue for
// every championship on the platform - and that risk is sharper now that any organiser
// can author a template.

export interface AppliedTemplate {
  template: string;
  sports_added: number;
  disciplines_added: number;
  /** Names in the template with no match in the catalogue - shown, never invented. */
  skipped: string[];
}

export async function applyChampionshipTemplate(
  prisma: Prisma, req: Request, championshipId: string, templateId: string,
): Promise<AppliedTemplate> {
  const { row, shape } = await loadTemplateFor(prisma, req.user!.id, templateId);

  const championship = await prisma.championships.findUnique({
    where: { id: championshipId },
    select: { id: true, name: true, status: true },
  });
  if (!championship) throw new NotFoundError('Championship');
  // A template rewrites the shape of the event. Once entrants are applying against
  // that shape, changing it wholesale is not a template's job - the setup tabs are.
  if (championship.status !== 'draft') {
    throw new BusinessRuleError('A template can only be applied while the championship is still a draft');
  }

  const result = await applyShape(prisma, championshipId, shape);

  await audit(prisma, req, {
    action: 'championship.template_applied',
    target: { type: 'championships', id: championshipId, label: championship.name },
    championshipId,
    summary: `Applied the "${row.name}" template to ${championship.name}`,
    diff: {
      template: { from: null, to: row.name },
      sports_added: { from: 0, to: result.sports_added },
      disciplines_added: { from: 0, to: result.disciplines_added },
    },
  });

  return { template: row.name, ...result };
}

// The replay itself, separated from the HTTP request so the capture→apply round trip
// is testable without one.
export async function applyShape(
  prisma: Prisma, championshipId: string, shape: TemplateShape,
): Promise<{ sports_added: number; disciplines_added: number; skipped: string[] }> {
  const skipped: string[] = [];
  let sportsAdded = 0;
  let disciplinesAdded = 0;
  const empty = { sports_added: 0, disciplines_added: 0, skipped };

  if (!shape?.draws?.length) return empty;

  // The default season created with every championship is where draws hang.
  const tournament = await prisma.tournaments.findFirst({
    where: { championship_id: championshipId },
    orderBy: { created_at: 'asc' },
    select: { id: true },
  });
  if (!tournament) throw new BusinessRuleError('This championship has no season to add sports to');

  // Resolve every named format up front. `tournament_sports.format_id` is NOT NULL, so
  // a draw whose format has left the catalogue falls back to another rather than
  // failing the whole apply - and says so in `skipped`.
  const names = [...new Set(shape.draws.map((d) => d.format).filter((f): f is string => !!f))];
  const formats = names.length
    ? await prisma.tournament_formats.findMany({
      where: { OR: names.map((name) => ({ name: { equals: name, mode: 'insensitive' as const } })) },
      select: { id: true, name: true },
    })
    : [];
  const formatByName = new Map(formats.map((f) => [f.name.toLowerCase(), f.id]));
  const fallbackFormat = formats[0]?.id
    ?? (await prisma.tournament_formats.findFirst({ select: { id: true } }))?.id
    ?? null;

  for (const draw of shape.draws) {
    const sport = await prisma.sports.findFirst({
      where: { name: { equals: draw.sport, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!sport) { skipped.push(draw.sport); continue; }

    const named = draw.format ? formatByName.get(draw.format.toLowerCase()) : undefined;
    if (draw.format && !named) skipped.push(`${draw.sport} · format "${draw.format}" is no longer in the catalogue`);
    const formatId = named ?? fallbackFormat;
    if (!formatId) { skipped.push(`${draw.sport} (no fixture format available)`); continue; }

    // Idempotent: re-applying a template (or applying a second one) must not create
    // the same sport twice.
    const existingSport = await prisma.tournament_sports.findFirst({
      where: { tournament_id: tournament.id, sport_id: sport.id },
      select: { id: true },
    });
    const tournamentSport = existingSport ?? await prisma.tournament_sports.create({
      data: { tournament_id: tournament.id, sport_id: sport.id, format_id: formatId },
      select: { id: true },
    });
    if (!existingSport) sportsAdded += 1;

    // A sport with no named disciplines still needs ONE draw, with a null discipline -
    // that is the ordinary "sport-level draw" the setup UI creates, and it is what
    // entries and fixtures actually hang off. Without it a template leaves a sport that
    // looks configured and cannot be entered or scheduled at all.
    if (draw.disciplines.length === 0) {
      const existingMain = await prisma.tournament_disciplines.findFirst({
        where: { tournament_sport_id: tournamentSport.id, discipline_id: null },
        select: { id: true },
      });
      if (!existingMain) {
        await prisma.tournament_disciplines.create({
          data: { tournament_sport_id: tournamentSport.id, discipline_id: null, format_id: formatId, status: 'upcoming' },
        });
        disciplinesAdded += 1;
      }
      continue;
    }

    for (const disciplineName of draw.disciplines) {
      const discipline = await prisma.disciplines.findFirst({
        where: { sport_id: sport.id, name: { equals: disciplineName, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!discipline) { skipped.push(`${draw.sport} · ${disciplineName}`); continue; }

      const existingDraw = await prisma.tournament_disciplines.findFirst({
        where: { tournament_sport_id: tournamentSport.id, discipline_id: discipline.id },
        select: { id: true },
      });
      if (existingDraw) continue;

      await prisma.tournament_disciplines.create({
        data: {
          tournament_sport_id: tournamentSport.id,
          discipline_id: discipline.id,
          format_id: formatId,
          status: 'upcoming',
        },
      });
      disciplinesAdded += 1;
    }
  }

  // The standings scheme is a championship-level rule; the setup tabs can override it
  // per sport or per draw afterwards.
  if (shape.scheme) {
    const existingRule = await prisma.standings_rules.findFirst({
      where: { championship_id: championshipId, scope_type: 'championship' },
      select: { id: true },
    });
    if (!existingRule) {
      await prisma.standings_rules.create({
        data: {
          championship_id: championshipId,
          scope_type: 'championship',
          scope_id: null,
          config: { scheme: shape.scheme } as any,
        },
      });
    }
  }

  // Only fills a blank - the wizard asks for the type explicitly, and an answer given
  // there outranks one inherited from a template.
  if (shape.type) {
    await prisma.championships.updateMany({
      where: { id: championshipId, type: null },
      data: { type: shape.type },
    });
  }

  return { sports_added: sportsAdded, disciplines_added: disciplinesAdded, skipped };
}
