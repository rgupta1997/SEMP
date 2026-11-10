// "Fixtures are live" bulk email — super-admin-only, one championship at a time.
//
// Two halves: build the AUDIENCE (everyone entered in the event, grouped by their
// org, each flagged emailable/not with a reason) for the console to show and edit,
// then SEND to exactly the user ids the super-admin confirmed. The send renders the
// embedded raw-HTML template per recipient and posts through the same external mail
// service as OTP (verified raw-HTML-capable 2026-11-10), de-duped per user so a
// re-run after an audience edit never double-mails anyone.

import type { Prisma } from '../../infra/prisma.js';
import { env } from '../../config/env.js';
import { sendMailBatch, MAIL_BATCH_LIMIT } from './mail-client.js';
import { renderScheduleLiveEmail } from './schedule-live.template.js';

// Org-member roles that count as "entered" alongside the team roster (POCs, staff).
const ORG_STAFF_ROLES = ['poc', 'owner', 'admin', 'coordinator'];

export type IneligibleReason = 'no_email' | 'placeholder' | 'demo';

export interface AudiencePerson {
  userId: string;
  name: string;
  email: string | null;
  roles: string[];
  emailable: boolean;
  reason?: IneligibleReason;
}
export interface AudienceOrg {
  orgId: string;
  orgName: string;
  /** Default selection: on when the org has at least one real, emailable person. */
  selectedByDefault: boolean;
  emailableCount: number;
  people: AudiencePerson[];
}
export interface ScheduleAudience {
  championshipId: string;
  eventName: string;
  orgs: AudienceOrg[];
  totals: { people: number; emailable: number; orgs: number };
}

/** Why an address can't be mailed, or undefined if it can. Mirrors the UAT data:
 *  @placeholder.invalid stand-ins and the .demo sandbox domains must never go out. */
export function ineligibleReason(email: string | null): IneligibleReason | undefined {
  if (!email) return 'no_email';
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (domain === 'placeholder.invalid' || domain.endsWith('.placeholder.invalid')) return 'placeholder';
  if (domain === 'demo' || domain.endsWith('.demo')) return 'demo';
  return undefined;
}

interface AudienceRow {
  org_id: string; org_name: string;
  user_id: string; user_name: string | null; email: string | null;
  roles: string[];
}

/** Everyone entered in the championship, grouped by org, with emailability flags. */
export async function getScheduleAudience(prisma: Prisma, championshipId: string): Promise<ScheduleAudience> {
  const champ = await prisma.championships.findUnique({
    where: { id: championshipId },
    select: { id: true, name: true },
  });
  if (!champ) return { championshipId, eventName: '', orgs: [], totals: { people: 0, emailable: 0, orgs: 0 } };

  const rows = await prisma.$queryRaw<AudienceRow[]>`
    with entered_teams as (
      select distinct t.id, t.organization_id, t.coach_user_id
      from team_entries te
      join teams t on t.id = te.team_id
      where te.championship_id = ${championshipId}::uuid
    ),
    approved_org as (
      select co.organization_id
      from championship_organizations co
      where co.championship_id = ${championshipId}::uuid and co.status = 'approved'
    ),
    people as (
      select t.organization_id as org_id, tm.user_id, tm.role
      from entered_teams t
      join team_members tm on tm.team_id = t.id
      union all
      select t.organization_id, t.coach_user_id, 'coach'
      from entered_teams t
      where t.coach_user_id is not null
      union all
      select om.organization_id, om.user_id, om.role
      from approved_org a
      join organization_members om on om.organization_id = a.organization_id
      where om.status = 'active' and om.role = any(${ORG_STAFF_ROLES})
    )
    select o.id as org_id, o.name as org_name,
           u.id as user_id, u.name as user_name, u.email,
           array_agg(distinct p.role) as roles
    from people p
    join approved_org a on a.organization_id = p.org_id
    join organizations o on o.id = p.org_id
    join users u on u.id = p.user_id
    group by o.id, o.name, u.id, u.name, u.email
    order by o.name asc, u.name asc
  `;

  const byOrg = new Map<string, AudienceOrg>();
  for (const r of rows) {
    let org = byOrg.get(r.org_id);
    if (!org) {
      org = { orgId: r.org_id, orgName: r.org_name, selectedByDefault: false, emailableCount: 0, people: [] };
      byOrg.set(r.org_id, org);
    }
    const reason = ineligibleReason(r.email);
    const emailable = reason === undefined;
    if (emailable) org.emailableCount++;
    org.people.push({
      userId: r.user_id,
      name: r.user_name ?? r.email ?? 'Unknown',
      email: r.email,
      roles: (r.roles ?? []).filter(Boolean).sort(),
      emailable,
      reason,
    });
  }

  const orgs = [...byOrg.values()];
  for (const o of orgs) o.selectedByDefault = o.emailableCount > 0;

  const totals = {
    people: orgs.reduce((n, o) => n + o.people.length, 0),
    emailable: orgs.reduce((n, o) => n + o.emailableCount, 0),
    orgs: orgs.length,
  };
  return { championshipId, eventName: champ.name, orgs, totals };
}

const firstName = (name: string | null, email: string | null): string => {
  const n = (name ?? '').trim();
  if (n) return n.split(/\s+/)[0]!;
  return (email ?? 'there').split('@')[0]!;
};

const fmtDates = (start: Date | null, end: Date | null): string => {
  if (!start) return '';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const s = start.toLocaleDateString('en-GB', opts);
  if (!end || end.getTime() === start.getTime()) return s;
  return `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-GB', opts)}`;
};

export interface SendResult {
  requested: number;
  skipped: { userId: string; reason: IneligibleReason | 'not_in_audience' }[];
  accepted: number;
  rejected: number;
}

/** Mail the confirmed user ids. Re-validates each against the live audience and its
 *  emailability, so a stale or hand-crafted id can never slip a mail out. */
export async function sendScheduleEmails(
  prisma: Prisma,
  championshipId: string,
  userIds: string[],
): Promise<SendResult> {
  const audience = await getScheduleAudience(prisma, championshipId);
  const byUser = new Map<string, AudiencePerson>();
  for (const o of audience.orgs) for (const p of o.people) if (!byUser.has(p.userId)) byUser.set(p.userId, p);

  const wanted = [...new Set(userIds)];
  const skipped: SendResult['skipped'] = [];
  const recipients: AudiencePerson[] = [];
  for (const id of wanted) {
    const p = byUser.get(id);
    if (!p) { skipped.push({ userId: id, reason: 'not_in_audience' }); continue; }
    if (!p.emailable) { skipped.push({ userId: id, reason: p.reason ?? 'no_email' }); continue; }
    recipients.push(p);
  }

  const champ = await prisma.championships.findUnique({
    where: { id: championshipId },
    select: { name: true, venue: true, host_cities: true, start_date: true, end_date: true, host_organization_id: true },
  });
  if (!champ || recipients.length === 0) {
    return { requested: wanted.length, skipped, accepted: 0, rejected: 0 };
  }

  const [hostOrg, teamCount, sportCount, matchCount] = await Promise.all([
    champ.host_organization_id
      ? prisma.organizations.findUnique({ where: { id: champ.host_organization_id }, select: { name: true } })
      : Promise.resolve(null),
    prisma.team_entries.count({ where: { championship_id: championshipId } }),
    prisma.$queryRaw<{ n: bigint }[]>`
      select count(*)::bigint n from tournament_sports ts
      join tournaments t on t.id = ts.tournament_id
      where t.championship_id = ${championshipId}::uuid`,
    prisma.$queryRaw<{ n: bigint }[]>`
      select count(f.*)::bigint n from fixtures f
      join tournament_disciplines td on td.id = f.tournament_discipline_id
      join tournament_sports ts on ts.id = td.tournament_sport_id
      join tournaments t on t.id = ts.tournament_id
      where t.championship_id = ${championshipId}::uuid`,
  ]);

  const sports = Number(sportCount[0]?.n ?? 0n);
  const matches = Number(matchCount[0]?.n ?? 0n);
  const eventFields = {
    event_name: champ.name,
    event_dates: fmtDates(champ.start_date, champ.end_date),
    event_venue: champ.venue ?? champ.host_cities?.join(', ') ?? '',
    stat_1_value: String(sports), stat_1_label: sports === 1 ? 'Sport' : 'Sports',
    stat_2_value: String(teamCount), stat_2_label: teamCount === 1 ? 'Team' : 'Teams',
    stat_3_value: String(matches), stat_3_label: matches === 1 ? 'Match' : 'Matches',
    organiser_name: hostOrg?.name ?? 'The organising team',
  };
  const schedulePath = `/championships/${championshipId}/schedule`;
  const scheduleLink = `${env.WEB_APP_URL}/login?next=${encodeURIComponent(schedulePath)}`;
  const subject = `${champ.name} — the fixtures are live`;

  let accepted = 0;
  let rejected = 0;
  for (let i = 0; i < recipients.length; i += MAIL_BATCH_LIMIT) {
    const chunk = recipients.slice(i, i + MAIL_BATCH_LIMIT);
    const messages = chunk.map((p) => {
      const { html, text } = renderScheduleLiveEmail({
        ...eventFields,
        first_name: firstName(p.name, p.email),
        schedule_link: scheduleLink,
      });
      return {
        to: p.email!,
        subject,
        html,
        text,
        priority: 7,
        idempotencyKey: `schedule-live:${championshipId}:${p.userId}`,
        metadata: { kind: 'schedule-live', championshipId },
      };
    });
    const res = await sendMailBatch(messages);
    accepted += res.accepted;
    rejected += res.rejected.length;
  }

  return { requested: wanted.length, skipped, accepted, rejected };
}
