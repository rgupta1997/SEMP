import { Router } from 'express';
import { STANDINGS_AGG_SCOPE, type StandingsAggScope } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { NotFoundError } from '../../shared/errors.js';
import { readStandings, readStandingsBreakdown, countCompletedMatches } from '../standings/standings.service.js';
import { listChampionshipFixtures } from '../championships/fixtures-list.js';
import { verifyShareToken } from './share-token.js';
import { verifySignature, type CertificateFacts } from '../certificates/certificates.service.js';

// Unauthenticated, view-only championship pages reachable via a share token. Mounted
// BEFORE the global requireAuth. Only the read-only Overview + Standings are exposed,
// and only data a spectator would already see (no contact details).
export function makePublicRouter(prisma: Prisma): Router {
  const router = Router();

  // Resolve the token to a championship id, or 404 (never reveal whether the id exists).
  const resolve = (token: string): string => {
    const id = verifyShareToken(token);
    if (!id) throw new NotFoundError('Shared championship');
    return id;
  };

  // Overview: championship header + sports + headline counts.
  router.get('/championships/:token/overview', asyncHandler(async (req, res) => {
    const id = resolve(req.params.token);
    const draw = { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: id } } } };
    const [champ, organizations, fixtures, completed_matches, sports] = await Promise.all([
      prisma.championships.findUnique({
        where: { id },
        select: { id: true, name: true, slug: true, description: true, venue: true, start_date: true, end_date: true, status: true },
      }),
      prisma.championship_organizations.count({ where: { championship_id: id, status: 'approved' } }),
      prisma.fixtures.count({ where: draw }),
      countCompletedMatches(prisma, id),
      prisma.tournament_sports.findMany({
        where: { tournaments: { championship_id: id } },
        select: { sports: { select: { name: true, icon: true } } },
        orderBy: { display_order: 'asc' },
      }),
    ]);
    if (!champ) throw new NotFoundError('Shared championship');
    // Distinct sports in declared order.
    const sportList = [...new Map(sports.filter((s) => s.sports).map((s) => [s.sports!.name, s.sports])).values()];
    res.json({ championship: champ, sports: sportList, stats: { organizations, fixtures, completed_matches } });
  }));

  // Standings for a scope (same shape + ranking the spectator view uses).
  router.get('/championships/:token/standings', asyncHandler(async (req, res) => {
    const id = resolve(req.params.token);
    const scope = (req.query.scope as StandingsAggScope) || 'championship';
    if (!STANDINGS_AGG_SCOPE.includes(scope)) throw new NotFoundError('Scope');
    const scopeId = scope === 'championship' ? null : (req.query.scopeId as string | undefined) ?? null;
    if (scope !== 'championship' && !scopeId) { res.json({ scope, scope_id: null, standings: [] }); return; }
    const standings = await readStandings(prisma, id, scope, scopeId);
    const completed_matches = await countCompletedMatches(prisma, id, scope, scopeId);
    res.json({ scope, scope_id: scopeId, standings, completed_matches });
  }));

  // Per-event breakdown for one org (same shape as the authed route) - drives the
  // expandable standings row on the public share page.
  router.get('/championships/:token/standings/breakdown', asyncHandler(async (req, res) => {
    const id = resolve(req.params.token);
    const scope = (req.query.scope as StandingsAggScope) || 'championship';
    if (!STANDINGS_AGG_SCOPE.includes(scope)) throw new NotFoundError('Scope');
    const scopeId = scope === 'championship' ? null : (req.query.scopeId as string | undefined) ?? null;
    const orgId = req.query.orgId as string | undefined;
    if (!orgId) throw new NotFoundError('Organization');
    if (scope !== 'championship' && !scopeId) { res.json({ events: [] }); return; }
    const events = await readStandingsBreakdown(prisma, id, scope, scopeId, orgId);
    res.json({ events });
  }));

  // All fixtures (powers the Schedule + Results tabs - same shape the spectator gets).
  router.get('/championships/:token/fixtures', asyncHandler(async (req, res) => {
    const id = resolve(req.params.token);
    res.json(await listChampionshipFixtures(prisma, id));
  }));

  // Tournament/sport options so the public standings can offer the same filters.
  router.get('/championships/:token/draws', asyncHandler(async (req, res) => {
    const id = resolve(req.params.token);
    const draws = await prisma.tournament_disciplines.findMany({
      where: { tournament_sports: { tournaments: { championship_id: id } } },
      select: { tournament_sports: { select: { sports: { select: { id: true, name: true } }, tournaments: { select: { id: true, name: true } } } } },
    });
    res.json(draws);
  }));

  // Certificate verification (J4-E8).
  //
  // The whole point of a certificate is that a STRANGER can check it - an employer, a
  // selector, another institution - with no account and no trust in the PDF they were
  // handed. So this is public, and it answers from the signed facts rather than from
  // anything the holder supplies.
  //
  // It always returns 200 with a verdict, never 404 for an unknown token: a 404 would
  // let somebody probe for which tokens exist, and "not a certificate we issued" is
  // itself the answer a verifier wants.
  router.get('/certificates/:token', asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const cert = await prisma.certificates.findUnique({
      where: { token: req.params.token },
      select: {
        id: true, serial: true, recipient_name: true, issued_at: true, payload: true, signature: true,
        revoked_at: true, revoked_reason: true, superseded_at: true,
        organizations: { select: { name: true, verified: true } },
        championships: { select: { name: true } },
      },
    });

    if (!cert) {
      return void res.json({ verdict: 'unknown', message: 'No certificate matches this code. It was not issued through Sportagon.' });
    }

    const facts = cert.payload as unknown as CertificateFacts;
    // Recomputed from the stored facts, so a row edited directly in the database fails
    // here rather than verifying. This is what makes the badge mean something.
    const intact = verifySignature(facts, cert.signature);

    const verdict = !intact ? 'tampered'
      : cert.revoked_at ? 'revoked'
        : cert.superseded_at ? 'superseded'
          : 'authentic';

    // Every scan is logged, and the table is append-only - the page claims the record
    // is immutable, so it has to be. Best-effort: a logging failure must not stop a
    // verifier getting their answer.
    prisma.certificate_verifications.create({
      data: {
        certificate_id: cert.id, outcome: verdict,
        ip: req.ip ?? null, user_agent: (req.get('user-agent') ?? '').slice(0, 400),
      },
    }).catch((err) => console.error('[certificates] verification log failed', err));

    res.json({
      verdict,
      message: {
        authentic: 'This certificate has been verified and is valid.',
        revoked: 'This certificate was withdrawn by the issuing institution.',
        superseded: 'The result behind this certificate was later corrected, so it has been superseded.',
        tampered: 'The details on this certificate do not match what was issued.',
      }[verdict],
      certificate: {
        serial: cert.serial,
        recipient: cert.recipient_name,
        event: cert.championships?.name ?? facts?.championship_name ?? null,
        sport: facts?.sport ?? null,
        title: facts?.title ?? null,
        issued_on: cert.issued_at,
        issued_by: cert.organizations?.name ?? null,
        issuer_verified: cert.organizations?.verified ?? false,
      },
      // Named so the page can show "Digital signature · Verified" truthfully.
      signature_valid: intact,
      ...(cert.revoked_at ? { withdrawn_on: cert.revoked_at, reason: cert.revoked_reason } : {}),
      verified_at: new Date().toISOString(),
    });
  }));


  return router;
}
