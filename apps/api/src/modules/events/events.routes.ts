import { Router } from 'express';
import { createEventSchema, updateEventSchema, updateEventStatusSchema, type EventStatus } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { NotFoundError } from '../../shared/errors.js';
import { assertEventTransition } from './domain/event-lifecycle.js';
import { createNotification } from '../notifications/audience.js';

// Human-readable lifecycle notification copy per target status. Returned undefined
// for statuses we don't announce (e.g. back to draft).
function lifecycleMessage(status: EventStatus): { title: string; body: string } | undefined {
  switch (status) {
    case 'registration_open':
      return { title: 'Registration is open', body: 'This event is now open for institution registration.' };
    case 'ongoing':
      return { title: 'The event is now live', body: 'Matches are underway — good luck to all teams.' };
    case 'completed':
      return { title: 'The event has concluded', body: 'Thanks for taking part. Final standings are available.' };
    default:
      return undefined;
  }
}

export function makeEventsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  // organiser of THIS event (or super) — for mutations on /:id and its children.
  const ownEvent = guards.eventManager(async (req) => req.params.id);

  // -------------------------------------------------------------------------
  // LIST EVENTS — scoped by role:
  //   Super admin: all events
  //   Organiser: events they manage
  //   Institution staff: open-for-registration events + events they applied to
  // -------------------------------------------------------------------------
  router.get('/', asyncHandler(async (req, res) => {
    const user = req.user!;

    if (user.isSuperAdmin) {
      const events = await prisma.events.findMany({ orderBy: { created_at: 'desc' } });
      res.json(events);
      return;
    }

    const ids = new Set<string>();

    const organiserRole = await prisma.roles.findUnique({ where: { name: 'Organiser' }, select: { id: true } });
    if (organiserRole) {
      const managed = await prisma.user_event_roles.findMany({
        where: { user_id: user.id, role_id: organiserRole.id },
        select: { event_id: true },
      });
      managed.forEach((r) => ids.add(r.event_id));
    }

    if (user.institutionId) {
      const enrolled = await prisma.event_institutions.findMany({
        where: { institution_id: user.institutionId },
        select: { event_id: true },
      });
      enrolled.forEach((r) => ids.add(r.event_id));

      const open = await prisma.events.findMany({
        where: { status: 'registration_open' },
        select: { id: true },
      });
      open.forEach((e) => ids.add(e.id));
    }

    if (ids.size === 0) {
      res.json([]);
      return;
    }

    const events = await prisma.events.findMany({
      where: { id: { in: [...ids] } },
      orderBy: { created_at: 'desc' },
    });
    res.json(events);
  }));

  // GET single event
  router.get('/:id', asyncHandler(async (req, res) => {
    const event = await prisma.events.findUnique({ where: { id: req.params.id } });
    if (!event) throw new NotFoundError('Event');
    res.json(event);
  }));

  // CREATE event - and auto-assign creator as Organiser (organiser-capable accounts only)
  router.post('/', guards.organiserAccount, validateBody(createEventSchema), asyncHandler(async (req, res) => {
    const event = await prisma.events.create({ data: req.body });
    // Auto-assign creator as Organiser for this event
    const organiserRole = await prisma.roles.findUnique({ where: { name: 'Organiser' } });
    if (organiserRole) {
      await prisma.user_event_roles.create({
        data: { event_id: event.id, user_id: req.user!.id, role_id: organiserRole.id },
      });
    }
    res.status(201).json(event);
  }));

  // UPDATE event
  router.patch('/:id', ownEvent, validateBody(updateEventSchema), asyncHandler(async (req, res) => {
    const event = await prisma.events.update({ where: { id: req.params.id }, data: req.body });
    res.json(event);
  }));

  // DELETE event
  router.delete('/:id', ownEvent, asyncHandler(async (req, res) => {
    await prisma.events.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }));

  // Status transition (validated lifecycle) — defined before generic /:id routes.
  router.patch('/:id/status', ownEvent, validateBody(updateEventStatusSchema), asyncHandler(async (req, res) => {
    const event = await prisma.events.findUnique({ where: { id: req.params.id } });
    if (!event) throw new NotFoundError('Event');
    assertEventTransition(event.status as EventStatus, req.body.status as EventStatus);
    const updated = await prisma.events.update({ where: { id: req.params.id }, data: { status: req.body.status } });

    // Lifecycle announcement → institutions + captains only.
    const msg = lifecycleMessage(req.body.status as EventStatus);
    if (msg) {
      await createNotification(prisma, {
        event_id: updated.id,
        sender_id: req.user!.id,
        type: 'event_lifecycle',
        audience: 'institutions_captains',
        title: msg.title,
        body: msg.body,
      });
    }

    res.json(updated);
  }));

  // All draws (tournament_disciplines) across the event, flattened with their
  // sport/discipline/tournament names — powers team entry (single + bulk).
  router.get('/:id/draws', asyncHandler(async (req, res) => {
    const draws = await prisma.tournament_disciplines.findMany({
      where: { tournament_sports: { tournaments: { event_id: req.params.id } } },
      include: {
        disciplines: true,
        tournament_sports: { include: { sports: true, tournaments: { select: { id: true, name: true } } } },
      },
      orderBy: { display_order: 'asc' },
    });
    res.json(draws);
  }));

  // All fixtures across the event, flattened with team / ground / sport names —
  // powers the schedule timeline (Gantt) view.
  router.get('/:id/fixtures', asyncHandler(async (req, res) => {
    const fixtures = await prisma.fixtures.findMany({
      where: { tournament_disciplines: { tournament_sports: { tournaments: { event_id: req.params.id } } } },
      include: {
        teams_fixtures_home_team_idToteams: { select: { id: true, name: true } },
        teams_fixtures_away_team_idToteams: { select: { id: true, name: true } },
        venue_grounds: { select: { id: true, name: true, venues: { select: { name: true } } } },
        tournament_disciplines: {
          select: {
            disciplines: { select: { name: true } },
            tournament_sports: { select: { sports: { select: { name: true, icon: true } } } },
          },
        },
      },
      orderBy: [{ scheduled_at: 'asc' }, { created_at: 'asc' }],
    });
    res.json(fixtures.map((f) => ({
      id: f.id,
      status: f.status,
      round: f.round,
      scheduled_at: f.scheduled_at,
      duration_minutes: f.duration_minutes,
      ground: f.venue_grounds ? { id: f.venue_grounds.id, name: f.venue_grounds.name, venue: f.venue_grounds.venues?.name ?? null } : null,
      sport: f.tournament_disciplines?.tournament_sports?.sports?.name ?? null,
      sport_icon: f.tournament_disciplines?.tournament_sports?.sports?.icon ?? null,
      discipline: f.tournament_disciplines?.disciplines?.name ?? null,
      home: f.teams_fixtures_home_team_idToteams,
      away: f.teams_fixtures_away_team_idToteams,
    })));
  }));

  // All grounds across the event's venues — used to schedule fixtures to a ground.
  router.get('/:id/grounds', asyncHandler(async (req, res) => {
    const grounds = await prisma.venue_grounds.findMany({
      where: { venues: { event_id: req.params.id } },
      include: { venues: { select: { id: true, name: true } } },
      orderBy: [{ venue_id: 'asc' }, { display_order: 'asc' }],
    });
    res.json(grounds);
  }));

  // Computed standings: a points table aggregated by institution from completed
  // fixtures across the whole event (win = 3, draw = 1, loss = 0).
  router.get('/:id/standings', asyncHandler(async (req, res) => {
    const fixtures = await prisma.fixtures.findMany({
      where: {
        status: 'completed',
        tournament_disciplines: { tournament_sports: { tournaments: { event_id: req.params.id } } },
      },
      include: {
        teams_fixtures_home_team_idToteams: { include: { institutions: true } },
        teams_fixtures_away_team_idToteams: { include: { institutions: true } },
      },
    });

    type Row = { institution_id: string; institution: any; played: number; won: number; drawn: number; lost: number; points: number };
    const table = new Map<string, Row>();
    const ensure = (inst: any): Row | null => {
      if (!inst) return null;
      if (!table.has(inst.id)) table.set(inst.id, { institution_id: inst.id, institution: inst, played: 0, won: 0, drawn: 0, lost: 0, points: 0 });
      return table.get(inst.id)!;
    };

    for (const f of fixtures) {
      const home = ensure(f.teams_fixtures_home_team_idToteams?.institutions);
      const away = ensure(f.teams_fixtures_away_team_idToteams?.institutions);
      if (!home && !away) continue;
      if (home) home.played++;
      if (away) away.played++;

      const draw = f.winner_team_id == null && f.home_score != null && f.away_score != null && f.home_score === f.away_score;
      if (draw) {
        if (home) { home.drawn++; home.points += 1; }
        if (away) { away.drawn++; away.points += 1; }
      } else if (f.winner_team_id) {
        const homeWon = f.winner_team_id === f.home_team_id;
        if (home) { if (homeWon) { home.won++; home.points += 3; } else { home.lost++; } }
        if (away) { if (!homeWon) { away.won++; away.points += 3; } else { away.lost++; } }
      }
    }

    const rows = [...table.values()].sort((a, b) => b.points - a.points || b.won - a.won || a.lost - b.lost);
    res.json({ standings: rows, completed_matches: fixtures.length });
  }));

  // -------------------------------------------------------------------------
  // EVENT PARTICIPANTS - users on teams in this event (scoped view)
  // -------------------------------------------------------------------------
  router.get('/:id/participants', asyncHandler(async (req, res) => {
    const teams = await prisma.teams.findMany({
      where: { event_id: req.params.id },
      include: {
        team_members: {
          include: { users: { select: { id: true, name: true, email: true, phone: true, account_type: true } } },
        },
        institutions: { select: { id: true, name: true, short_name: true } },
        sports: { select: { id: true, name: true, icon: true } },
      },
    });

    // Flatten to unique participants with their team info
    const seen = new Map<string, any>();
    for (const team of teams) {
      for (const member of team.team_members) {
        if (!member.users) continue;
        const existing = seen.get(member.users.id);
        if (existing) {
          existing.teams.push({ team_id: team.id, team_name: team.name, sport: team.sports, role: member.role, jersey_number: member.jersey_number });
        } else {
          seen.set(member.users.id, {
            ...member.users,
            institution: team.institutions,
            teams: [{ team_id: team.id, team_name: team.name, sport: team.sports, role: member.role, jersey_number: member.jersey_number }],
          });
        }
      }
    }

    res.json([...seen.values()]);
  }));

  // -------------------------------------------------------------------------
  // EVENT OFFICIALS - officials assigned to this event
  // -------------------------------------------------------------------------
  router.get('/:id/officials', asyncHandler(async (req, res) => {
    const officials = await prisma.event_officials.findMany({
      where: { event_id: req.params.id, is_active: true },
      include: {
        users_event_officials_user_idTousers: { select: { id: true, name: true, email: true, phone: true, account_type: true } },
        users_event_officials_assigned_byTousers: { select: { id: true, name: true } },
      },
      orderBy: { assigned_at: 'desc' },
    });
    res.json(officials.map((o) => ({
      id: o.id,
      user: o.users_event_officials_user_idTousers,
      assigned_by: o.users_event_officials_assigned_byTousers,
      assigned_at: o.assigned_at,
      notes: o.notes,
    })));
  }));

  // Assign official to event
  router.post('/:id/officials', ownEvent, asyncHandler(async (req, res) => {
    const { user_id, notes } = req.body;
    if (!user_id) throw new NotFoundError('user_id required');
    
    const existing = await prisma.event_officials.findUnique({
      where: { event_id_user_id: { event_id: req.params.id, user_id } },
    });
    if (existing) {
      // Reactivate if inactive
      const updated = await prisma.event_officials.update({
        where: { id: existing.id },
        data: { is_active: true, notes },
        include: { users_event_officials_user_idTousers: { select: { id: true, name: true, email: true } } },
      });
      res.json({ ...updated, user: updated.users_event_officials_user_idTousers });
      return;
    }

    const official = await prisma.event_officials.create({
      data: { event_id: req.params.id, user_id, assigned_by: req.user!.id, notes },
      include: { users_event_officials_user_idTousers: { select: { id: true, name: true, email: true } } },
    });
    res.status(201).json({ ...official, user: official.users_event_officials_user_idTousers });
  }));

  // Remove official from event
  router.delete('/:id/officials/:officialId', ownEvent, asyncHandler(async (req, res) => {
    await prisma.event_officials.update({
      where: { id: req.params.officialId },
      data: { is_active: false },
    });
    res.status(204).send();
  }));

  // -------------------------------------------------------------------------
  // EVENT INSTITUTIONS (enrollments) - already exists via enrollment router
  // but add a convenience read endpoint here
  // -------------------------------------------------------------------------
  router.get('/:id/institutions', asyncHandler(async (req, res) => {
    const enrollments = await prisma.event_institutions.findMany({
      where: { event_id: req.params.id },
      include: {
        institutions: true,
        users_event_institutions_applied_byTousers: { select: { id: true, name: true, email: true } },
      },
      orderBy: { applied_at: 'desc' },
    });
    res.json(enrollments);
  }));

  return router;
}
