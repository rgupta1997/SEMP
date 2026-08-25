// Wipes a demo sandbox: everything the seeder created PLUS anything the client
// created or modified during the demo. Scope = the persisted manifest (primary)
// UNION a namespace sweep (safety net) - demo users live on the sandbox's email
// domain, demo orgs carry the DEMO-<SLUG>- code prefix and demo championships the
// <slug>- slug prefix, so client-created rows hang off one of those anchors.
// Deletion runs as sequential idempotent deleteMany steps (children -> parents),
// re-runnable after a crash. Used by both Reset (wipe -> reseed) and Delete.

import type { Prisma } from '../../infra/prisma.js';
import type { CreateDemoSandboxInput } from '@semp/shared';

type SandboxRow = {
  id: string;
  slug: string;
  email_domain: string;
  config: unknown;
  manifest: unknown;
  organiser_user_id: string | null;
};

const ids = (manifest: Record<string, string[]>, table: string): string[] => manifest[table] ?? [];

export async function wipeSandbox(prisma: Prisma, sandbox: SandboxRow): Promise<void> {
  const manifest = (sandbox.manifest ?? {}) as Record<string, string[]>;
  const config = sandbox.config as CreateDemoSandboxInput | null;
  const attachMode = config?.organiser?.mode === 'attach';

  // ---- scope: users ----------------------------------------------------------
  const domainUsers = await prisma.users.findMany({
    where: { email: { endsWith: `@${sandbox.email_domain}` } },
    select: { id: true },
  });
  const userIds = new Set<string>([...ids(manifest, 'users'), ...domainUsers.map((u) => u.id)]);

  // ---- scope: organizations (seeded + client-created ones owned by demo users)
  const codePrefix = `DEMO-${sandbox.slug.toUpperCase()}-`;
  const [codeOrgs, ownedOrgs] = await Promise.all([
    prisma.organizations.findMany({ where: { code: { startsWith: codePrefix } }, select: { id: true } }),
    userIds.size
      ? prisma.organization_members.findMany({
          where: { user_id: { in: [...userIds] }, role: { in: ['owner', 'admin'] } },
          select: { organization_id: true },
        })
      : Promise.resolve([] as { organization_id: string }[]),
  ]);
  const orgIds = new Set<string>([
    ...ids(manifest, 'organizations'),
    ...codeOrgs.map((o) => o.id),
    ...ownedOrgs.map((o) => o.organization_id),
  ]);

  // Client-created users homed under demo orgs (e.g. players added mid-demo).
  if (orgIds.size) {
    const orgUsers = await prisma.users.findMany({ where: { organization_id: { in: [...orgIds] } }, select: { id: true } });
    for (const u of orgUsers) userIds.add(u.id);
  }

  // Never delete a real (attached) organiser or any super-admin, whatever the sweep found.
  if (attachMode && sandbox.organiser_user_id) userIds.delete(sandbox.organiser_user_id);
  if (userIds.size) {
    const supers = await prisma.users.findMany({ where: { id: { in: [...userIds] }, is_super_admin: true }, select: { id: true } });
    for (const s of supers) userIds.delete(s.id);
  }

  // ---- scope: championships (seeded + any the demo organiser created mid-demo)
  const organisedChamps = userIds.size
    ? await prisma.user_championship_roles.findMany({
        where: { user_id: { in: [...userIds] }, roles: { name: 'Organiser' } },
        select: { championship_id: true },
      })
    : [];
  const slugChamps = await prisma.championships.findMany({ where: { slug: { startsWith: `${sandbox.slug}-` } }, select: { id: true } });
  const champIds = new Set<string>([
    ...ids(manifest, 'championships'),
    ...organisedChamps.map((c) => c.championship_id),
    ...slugChamps.map((c) => c.id),
  ]);
  // Attach mode: championships the attached organiser ran BEFORE the demo are theirs,
  // not the sandbox's - only manifest/slug-scoped ones are safe to wipe for them.
  if (attachMode && sandbox.organiser_user_id) {
    const attachedOnly = await prisma.user_championship_roles.findMany({
      where: { user_id: sandbox.organiser_user_id, roles: { name: 'Organiser' } },
      select: { championship_id: true },
    });
    const manifestOrSlug = new Set([...ids(manifest, 'championships'), ...slugChamps.map((c) => c.id)]);
    for (const c of attachedOnly) if (!manifestOrSlug.has(c.championship_id)) champIds.delete(c.championship_id);
  }

  // ---- scope: championship subtree + teams + fixtures --------------------------
  const champList = [...champIds];
  const tournaments = champList.length
    ? await prisma.tournaments.findMany({ where: { championship_id: { in: champList } }, select: { id: true } })
    : [];
  const tournamentIds = tournaments.map((t) => t.id);
  const tSports = tournamentIds.length
    ? await prisma.tournament_sports.findMany({ where: { tournament_id: { in: tournamentIds } }, select: { id: true } })
    : [];
  const tsIds = tSports.map((t) => t.id);
  const tDiscs = tsIds.length
    ? await prisma.tournament_disciplines.findMany({ where: { tournament_sport_id: { in: tsIds } }, select: { id: true } })
    : [];
  const tdIds = tDiscs.map((t) => t.id);
  const venues = champList.length
    ? await prisma.venues.findMany({ where: { championship_id: { in: champList } }, select: { id: true } })
    : [];
  const venueIds = venues.map((v) => v.id);

  const teamRows = orgIds.size
    ? await prisma.teams.findMany({ where: { organization_id: { in: [...orgIds] } }, select: { id: true } })
    : [];
  const teamIds = new Set<string>([...ids(manifest, 'teams'), ...teamRows.map((t) => t.id)]);
  const teamList = [...teamIds];

  const fixtureWhere: any[] = [];
  if (tdIds.length) fixtureWhere.push({ tournament_discipline_id: { in: tdIds } });
  if (teamList.length) {
    fixtureWhere.push({ home_team_id: { in: teamList } }, { away_team_id: { in: teamList } }, { winner_team_id: { in: teamList } });
  }
  const fixtureRows = fixtureWhere.length
    ? await prisma.fixtures.findMany({ where: { OR: fixtureWhere }, select: { id: true } })
    : [];
  const fixtureIds = fixtureRows.map((f) => f.id);

  const userList = [...userIds];
  const orgList = [...orgIds];

  // ---- delete, children -> parents ---------------------------------------------
  if (fixtureIds.length) {
    await prisma.fixture_awards.deleteMany({ where: { fixture_id: { in: fixtureIds } } });
    await prisma.fixtures.deleteMany({ where: { id: { in: fixtureIds } } });
  }
  if (userList.length) {
    // Demo officials on fixtures outside the wipe scope (NoAction FK).
    await prisma.fixtures.updateMany({ where: { official_id: { in: userList } }, data: { official_id: null } });
  }
  if (champList.length) {
    await prisma.standings.deleteMany({ where: { championship_id: { in: champList } } });
    await prisma.standings_rules.deleteMany({ where: { championship_id: { in: champList } } });
  }
  if (champList.length || teamList.length) {
    await prisma.team_entries.deleteMany({ where: { OR: [
      ...(champList.length ? [{ championship_id: { in: champList } }] : []),
      ...(teamList.length ? [{ team_id: { in: teamList } }] : []),
    ] } });
  }
  if (teamList.length || userList.length) {
    await prisma.team_members.deleteMany({ where: { OR: [
      ...(teamList.length ? [{ team_id: { in: teamList } }] : []),
      ...(userList.length ? [{ user_id: { in: userList } }] : []),
    ] } });
  }
  if (teamList.length) await prisma.teams.deleteMany({ where: { id: { in: teamList } } });
  if (champList.length || userList.length) {
    await prisma.championship_officials.deleteMany({ where: { OR: [
      ...(champList.length ? [{ championship_id: { in: champList } }] : []),
      ...(userList.length ? [{ user_id: { in: userList } }] : []),
    ] } });
    await prisma.user_championship_roles.deleteMany({ where: { OR: [
      ...(champList.length ? [{ championship_id: { in: champList } }] : []),
      ...(userList.length ? [{ user_id: { in: userList } }] : []),
    ] } });
  }
  if (userList.length) {
    await prisma.user_championship_roles.updateMany({ where: { assigned_by: { in: userList } }, data: { assigned_by: null } });
  }
  if (champList.length || orgList.length || userList.length) {
    await prisma.championship_organizations.deleteMany({ where: { OR: [
      ...(champList.length ? [{ championship_id: { in: champList } }] : []),
      ...(orgList.length ? [{ organization_id: { in: orgList } }] : []),
      ...(userList.length ? [{ applied_by: { in: userList } }] : []),
    ] } });
  }
  if (userList.length) {
    await prisma.championship_invitations.deleteMany({ where: { invited_by: { in: userList } } });
    await prisma.user_invitations.deleteMany({ where: { invited_by: { in: userList } } });
  }
  if (orgList.length || userList.length) {
    await prisma.notifications.deleteMany({ where: { OR: [
      ...(orgList.length ? [{ organization_id: { in: orgList } }] : []),
      ...(userList.length ? [{ target_user_id: { in: userList } }, { sender_id: { in: userList } }] : []),
    ] } });
  }
  if (tdIds.length) await prisma.tournament_disciplines.deleteMany({ where: { id: { in: tdIds } } });
  if (tsIds.length) await prisma.tournament_sports.deleteMany({ where: { id: { in: tsIds } } });
  if (venueIds.length) {
    await prisma.venue_grounds.deleteMany({ where: { venue_id: { in: venueIds } } });
    await prisma.venues.deleteMany({ where: { id: { in: venueIds } } });
  }
  if (tournamentIds.length) await prisma.tournaments.deleteMany({ where: { id: { in: tournamentIds } } });
  if (champList.length) {
    await prisma.championships.deleteMany({ where: { id: { in: champList } } });
  }
  if (orgList.length || userList.length) {
    await prisma.organization_members.deleteMany({ where: { OR: [
      ...(orgList.length ? [{ organization_id: { in: orgList } }] : []),
      ...(userList.length ? [{ user_id: { in: userList } }] : []),
    ] } });
  }
  if (userList.length) await prisma.users.deleteMany({ where: { id: { in: userList }, is_super_admin: false } });
  if (orgList.length) await prisma.organizations.deleteMany({ where: { id: { in: orgList } } });

  // Manifest is now stale - clear it so a re-run (or reseed) starts from empty.
  await prisma.demo_sandboxes.update({ where: { id: sandbox.id }, data: { manifest: {}, updated_at: new Date() } });
}
