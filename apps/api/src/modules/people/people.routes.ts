import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { ForbiddenError } from '../../shared/errors.js';
import { can } from '../../http/middleware/can.js';
import { audit, AUDIT_ACTIONS } from '../iam/audit.service.js';
import { deriveProvisionedPassword, phoneLast10 } from '../iam/users.helpers.js';
import { GENDERS, validateRoster, type RosterContext, type RosterRow, type RosterRowResult } from './roster-import.js';

// The student roll (J1-E5).
//
// Validate, then apply - the same split as the matrix importer, and for the same
// reason: 2,000 rows is far too many to fix one 500 at a time. `/import/validate`
// writes nothing and returns a per-row verdict; `/import` re-runs the identical
// validation and applies only the rows that pass. The two cannot disagree,
// because they call the same pure function over the same lookups.
//
// THE DEMOGRAPHICS RULE (J1-E5-S4), which is a privacy boundary and not a
// preference: gender, date of birth and scholarship status are collected here
// and are NEVER returned against a named individual. `personView` below is the
// only projection this router emits, and it does not contain them. The only way
// they leave the database is as aggregate counts in a report (J5-E3), where
// 'prefer_not_to_say' is reported as its own category rather than dropped.

const rosterRowSchema = z.object({
  name: z.string().max(200).nullish(),
  email: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  programme: z.string().max(200).nullish(),
  batch: z.string().max(200).nullish(),
  member_code: z.string().max(64).nullish(),
  gender: z.string().max(40).nullish(),
  date_of_birth: z.string().max(20).nullish(),
  scholarship: z.union([z.boolean(), z.string().max(20)]).nullish(),
});

const rosterImportSchema = z.object({
  rows: z.array(rosterRowSchema).min(1).max(5000),
  /** The consent text in force when this data was collected. */
  consent_version: z.string().max(80).nullish(),
});

const addPersonSchema = rosterRowSchema.extend({ name: z.string().min(1).max(200) });

// Bulk verification (J1-E6). Capped at one roll's worth per call so a runaway client
// cannot open a transaction over the whole table.
const verifyPeopleSchema = z.object({
  member_ids: z.array(z.string().uuid()).min(1).max(5000),
  verification: z.enum(['verified', 'rejected']),
  note: z.string().max(500).nullish(),
});

export function makePeopleRouter(prisma: Prisma): Router {
  const router = Router();

  const requireManage = asyncHandler(async (req, _res, next) => {
    const organizationId = req.params.id;
    const allowed = await can(prisma, 'org.member.manage', {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
      fallback: async () => !!(await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: organizationId, status: 'active', role: { in: ['owner', 'admin'] } },
        select: { id: true },
      })),
    });
    if (!allowed) throw new ForbiddenError('You do not manage the people in this institution.');
    next();
  });

  /**
   * The ONLY shape a person leaves this router in.
   *
   * Note what is absent: gender, date_of_birth and scholarship. They are
   * collected, stored and reportable in aggregate, and they never appear against
   * a name - not in the directory, not on a profile, not in an export
   * (J1-E5-S4). Keeping that as one function rather than a rule people remember
   * is the only version of it that survives the next endpoint.
   */
  const personView = (m: any) => ({
    id: m.id,
    user_id: m.user_id,
    name: m.users?.name ?? null,
    email: m.users?.email ?? null,
    phone: m.users?.phone ?? null,
    role: m.role,
    status: m.status,
    member_code: m.member_code,
    verification: m.verification,
    verified_at: m.verified_at,
    org_unit_id: m.org_unit_id,
    org_unit_name: m.org_units?.name ?? null,
    joined_at: m.joined_at,
  });

  /** Everything the pure validator needs, in four queries regardless of file size. */
  async function loadContext(organizationId: string, rows: RosterRow[]): Promise<RosterContext> {
    const phones = [...new Set(rows.map((r) => phoneLast10(r.phone)).filter((p) => p.length === 10))];
    const emails = [...new Set(rows.map((r) => (r.email ?? '').trim().toLowerCase()).filter(Boolean))];

    const [byPhone, byEmail, units, members] = await Promise.all([
      phones.length
        ? prisma.$queryRawUnsafe<Array<{ id: string; name: string; phone: string | null }>>(
          `select id, name, phone from users
           where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = any($1::text[])`,
          phones,
        )
        : Promise.resolve([]),
      emails.length
        ? prisma.users.findMany({ where: { email: { in: emails } }, select: { id: true, name: true, email: true } })
        : Promise.resolve([]),
      prisma.org_units.findMany({ where: { organization_id: organizationId }, select: { id: true, name: true, type: true } }),
      prisma.organization_members.findMany({
        where: { organization_id: organizationId },
        select: { user_id: true, member_code: true },
      }),
    ]);

    return {
      usersByPhone: new Map(byPhone.map((u) => [phoneLast10(u.phone), { id: u.id, name: u.name }])),
      usersByEmail: new Map(byEmail.map((u) => [u.email.toLowerCase(), { id: u.id, name: u.name }])),
      unitsByName: new Map(units.map((u) => [u.name.trim().toLowerCase(), { id: u.id, type: u.type }])),
      memberUserIds: new Set(members.map((m) => m.user_id)),
      memberCodeOwner: new Map(
        members.filter((m) => m.member_code).map((m) => [m.member_code!.trim().toLowerCase(), m.user_id]),
      ),
    };
  }

  // ---- J1-E5-S1 · dry run -------------------------------------------------
  router.post('/:id/people/import/validate', requireManage, validateBody(rosterImportSchema), asyncHandler(async (req, res) => {
    const rows = req.body.rows as RosterRow[];
    res.json(validateRoster(rows, await loadContext(req.params.id, rows)));
  }));

  // ---- J1-E5-S2 · apply ---------------------------------------------------
  router.post('/:id/people/import', requireManage, validateBody(rosterImportSchema), asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    const rows = req.body.rows as RosterRow[];
    const consentVersion = (req.body.consent_version as string | null) ?? null;

    // Validated again server-side rather than trusting the client's earlier
    // report: the file may have changed, and so may the institution's org units.
    const report = validateRoster(rows, await loadContext(organizationId, rows));
    const applicable = report.rows.filter((r) => r.verdict !== 'reject');

    // Passwords are hashed OUTSIDE the transaction. bcrypt is CPU-bound, and
    // 2,000 hashes inside an open transaction is a guaranteed Lambda timeout.
    const toCreate = await Promise.all(
      applicable.filter((r) => !r.user_id).map(async (r) => {
        const email = r.email ?? `${phoneLast10(r.phone)}@placeholder.invalid`;
        const password = deriveProvisionedPassword(r.name ?? '', r.phone);
        // The plaintext is kept so it can be handed back ONCE, at the end of this
        // request, for the coordinator to distribute. Provisioning two thousand
        // logins nobody can be told about is not an import, it is a dead end.
        return { row: r, email, password, password_hash: await bcrypt.hash(password, 10) };
      }),
    );

    const consentStamp = consentVersion
      ? { consent_version: consentVersion, consent_at: new Date() }
      : {};

    // A ROW-AT-A-TIME UPSERT CANNOT MEET THIS EPIC'S GOAL. "2,000 students in
    // one upload" against Supabase over the pooler is ~2,000 round trips, which
    // is minutes, not the 15 seconds a synchronous Lambda gets. So the writes
    // below are set-based: whatever the file size, this is a fixed handful of
    // statements, and every one of them is idempotent.
    // Which of these logins genuinely did not exist a moment ago. `createMany` runs
    // with `skipDuplicates`, so an email already on the platform is quietly left
    // alone - and reporting a password for THAT person would be a plain lie, since
    // it is not the one they use. Captured before the insert, which is the only
    // point at which the answer is knowable.
    const newLogins: Array<{ name: string; email: string; phone: string | null; password: string }> = [];

    const created = await prisma.$transaction(async (tx) => {
      if (toCreate.length) {
        const already = new Set(
          (await tx.users.findMany({
            where: { email: { in: toCreate.map((c) => c.email) } },
            select: { email: true },
          })).map((u) => u.email),
        );
        for (const c of toCreate) {
          if (!already.has(c.email)) {
            newLogins.push({ name: c.row.name ?? c.email, email: c.email, phone: c.row.phone, password: c.password });
          }
        }

        await tx.users.createMany({
          data: toCreate.map((c) => ({
            name: c.row.name ?? c.email,
            email: c.email,
            phone: c.row.phone,
            password_hash: c.password_hash,
            must_change_password: true,
            date_of_birth: c.row.date_of_birth ? new Date(`${c.row.date_of_birth}T00:00:00Z`) : null,
            gender: c.row.gender,
            ...consentStamp,
          })),
          skipDuplicates: true,
        });
      }

      // Re-read to pick up the ids of everything just created.
      const emails = toCreate.map((c) => c.email);
      const freshIds = emails.length
        ? new Map((await tx.users.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } }))
          .map((u) => [u.email, u.id]))
        : new Map<string, string>();
      const emailOfRow = new Map(toCreate.map((c) => [c.row.index, c.email]));

      const resolved = applicable
        .map((r) => ({ r, userId: r.user_id ?? freshIds.get(emailOfRow.get(r.index) ?? '') ?? null }))
        .filter((x): x is { r: RosterRowResult; userId: string } => !!x.userId);
      if (resolved.length === 0) return 0;

      // Demographics onto the person. `coalesce` means a partial re-import never
      // blanks what a fuller one already established.
      const withDemographics = resolved.filter((x) => x.r.gender || x.r.date_of_birth || consentVersion);
      if (withDemographics.length) {
        // EVERY array parameter is passed as text[] and cast per element.
        // A column of all-nulls arrives from the driver as an untyped array that
        // Postgres infers as `integer[]`, and `integer[]::uuid[]` is not a legal
        // cast - so an import where nobody supplied a date of birth would fail
        // at runtime while type-checking perfectly. Casting element-wise is
        // immune to what the driver inferred.
        await tx.$executeRawUnsafe(
          `update users u set
             gender          = coalesce(v.gender, u.gender),
             date_of_birth   = coalesce(v.dob::date, u.date_of_birth),
             consent_version = coalesce($4::text, u.consent_version),
             consent_at      = case when $4::text is not null then now() else u.consent_at end,
             updated_at      = now()
           from unnest($1::text[], $2::text[], $3::text[]) as v(id, gender, dob)
           where u.id = v.id::uuid`,
          withDemographics.map((x) => x.userId),
          withDemographics.map((x) => x.r.gender),
          withDemographics.map((x) => x.r.date_of_birth),
          consentVersion,
        );
      }

      // Placement onto the membership. Note what the DO UPDATE does NOT touch:
      // `verification`. Re-running a file must not knock somebody already
      // verified back to pending - that is what makes the import idempotent in
      // the sense J1-E5-S2 actually means.
      await tx.$executeRawUnsafe(
        `insert into organization_members
           (user_id, organization_id, role, status, org_unit_id, member_code, scholarship, verification)
         select v.user_id::uuid, $1::uuid, 'member', 'active',
                v.org_unit_id::uuid, v.member_code, v.scholarship::boolean, 'pending'
         from unnest($2::text[], $3::text[], $4::text[], $5::text[])
           as v(user_id, org_unit_id, member_code, scholarship)
         on conflict (user_id, organization_id) do update set
           org_unit_id = coalesce(excluded.org_unit_id, organization_members.org_unit_id),
           member_code = coalesce(excluded.member_code, organization_members.member_code),
           scholarship = coalesce(excluded.scholarship, organization_members.scholarship)`,
        organizationId,
        resolved.map((x) => x.userId),
        resolved.map((x) => x.r.org_unit_id),
        resolved.map((x) => x.r.member_code),
        // Stringified for the same reason as above; `::boolean` restores it.
        resolved.map((x) => (x.r.scholarship == null ? null : String(x.r.scholarship))),
      );

      return resolved.length;
    }, { timeout: 20_000 });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.memberAdded,
      target: { type: 'organizations', id: organizationId, label: 'Student roll import' },
      organizationId,
      summary: `Imported ${created} ${created === 1 ? 'person' : 'people'} from a roll of ${report.summary.total} (${report.summary.reject} rejected)`,
      diff: { imported: { from: null, to: created }, rejected: { from: null, to: report.summary.reject } },
    });

    // `credentials` is returned ONCE and never stored in plaintext - the same
    // contract as `POST /users/bulk`. Only accounts this import actually created
    // appear; anyone matched to an existing login keeps the password they already
    // have, which we do not know and must not pretend to.
    res.json({ ...report, applied: created, credentials: newLogins });
  }));

  // ---- J1-E5-S3 · one person ---------------------------------------------
  router.post('/:id/people', requireManage, validateBody(addPersonSchema), asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    const rows = [req.body as RosterRow];
    const report = validateRoster(rows, await loadContext(organizationId, rows));
    const row = report.rows[0];
    // The same validator the bulk path uses, so a late joiner is held to exactly
    // the same rules as a spreadsheet row - including the member-code clash and
    // the "no implicit org unit" rule.
    if (row.verdict === 'reject') throw new ForbiddenError(row.message);

    let userId = row.user_id;
    // Returned once, for the same reason the bulk import returns them: a login
    // nobody can be told about is not an account.
    let credential: { name: string; email: string; phone: string | null; password: string } | null = null;
    if (!userId) {
      const email = row.email ?? `${phoneLast10(row.phone)}@placeholder.invalid`;
      const password = deriveProvisionedPassword(row.name!, row.phone);
      const created = await prisma.users.create({
        data: {
          name: row.name!,
          email,
          phone: row.phone,
          password_hash: await bcrypt.hash(password, 10),
          must_change_password: true,
          gender: row.gender,
          date_of_birth: row.date_of_birth ? new Date(`${row.date_of_birth}T00:00:00Z`) : null,
        },
        select: { id: true },
      });
      userId = created.id;
      credential = { name: row.name!, email, phone: row.phone, password };
    }

    const member = await prisma.organization_members.upsert({
      where: { user_id_organization_id: { user_id: userId, organization_id: organizationId } },
      update: {
        ...(row.org_unit_id ? { org_unit_id: row.org_unit_id } : {}),
        ...(row.member_code ? { member_code: row.member_code } : {}),
        ...(row.scholarship != null ? { scholarship: row.scholarship } : {}),
      },
      create: {
        user_id: userId, organization_id: organizationId, role: 'member', status: 'active',
        org_unit_id: row.org_unit_id, member_code: row.member_code, scholarship: row.scholarship,
        verification: 'pending',
      },
      include: { users: { select: { name: true, email: true, phone: true } }, org_units: { select: { name: true } } },
    });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.memberAdded,
      target: { type: 'organization_members', id: member.id, label: member.users?.name ?? 'Person' },
      organizationId,
      summary: `Added ${member.users?.name ?? 'a person'} to the roll`,
      diff: { verification: { from: null, to: 'pending' } },
    });

    res.status(201).json({ ...personView(member), credential });
  }));

  // ---- The directory (FR-PPL-1/2/3) --------------------------------------
  router.get('/:id/people', asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    const allowed = await can(prisma, 'people.view', {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
      fallback: async () => !!(await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: organizationId, status: 'active' },
        select: { id: true },
      })),
    });
    if (!allowed) throw new ForbiddenError('You do not have permission to view people in this institution.');

    const { verification, org_unit_id, q } = req.query as Record<string, string | undefined>;
    const rows = await prisma.organization_members.findMany({
      where: {
        organization_id: organizationId,
        ...(verification ? { verification } : {}),
        ...(org_unit_id ? { org_unit_id } : {}),
        ...(q ? { users: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } } : {}),
      },
      select: {
        id: true, user_id: true, role: true, status: true, member_code: true,
        verification: true, verified_at: true, org_unit_id: true, joined_at: true,
        users: { select: { name: true, email: true, phone: true } },
        org_units: { select: { name: true } },
        // Deliberately NOT selected: gender, date_of_birth, scholarship.
      },
      orderBy: [{ joined_at: 'desc' }],
      take: 2000,
    });
    res.json(rows.map(personView));
  }));

  // Verifying people (J1-E6). Verification is the institution's own judgement about
  // its own roll, so it is per-membership, not per-person: one college vouching for
  // somebody must not bind another's. Done in bulk because a roll import lands 2,000
  // pending rows and confirming them one at a time is not a workflow.
  //
  // Every transition is audited individually. A single "verified 1,847 people" line
  // would be useless the day somebody asks who vouched for one of them.
  router.post('/:id/people/verify', requireManage, validateBody(verifyPeopleSchema), asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    const { member_ids, verification, note } = req.body as
      { member_ids: string[]; verification: 'verified' | 'rejected'; note?: string | null };

    const members = await prisma.organization_members.findMany({
      where: { id: { in: member_ids }, organization_id: organizationId },
      select: { id: true, verification: true, users: { select: { id: true, name: true, email: true } } },
    });
    // Ids that belong to another institution are silently absent rather than
    // reported - confirming which ids exist elsewhere would leak across the tenancy
    // boundary the rest of this router is built to hold.
    const changed = members.filter((m) => m.verification !== verification);

    await prisma.$transaction(
      changed.map((m) => prisma.organization_members.update({
        where: { id: m.id },
        data: {
          verification,
          verified_by: req.user!.id,
          verified_at: new Date(),
          rejection_note: verification === 'rejected' ? (note ?? null) : null,
        },
      })),
    );

    for (const m of changed) {
      await audit(prisma, req, {
        action: verification === 'verified' ? AUDIT_ACTIONS.personVerified : AUDIT_ACTIONS.personVerificationRejected,
        target: { type: 'organization_members', id: m.id, label: `${m.users?.name} (${m.users?.email})` },
        organizationId,
        summary: verification === 'verified'
          ? `Verified ${m.users?.name} as a member of this institution`
          : `Declined to verify ${m.users?.name}${note ? ` - ${note}` : ''}`,
        diff: { verification: { from: m.verification, to: verification } },
      });
    }

    res.json({
      requested: member_ids.length,
      matched: members.length,
      changed: changed.length,
      already: members.length - changed.length,
    });
  }));

  /** The aggregate view - the only way demographics leave the database (J5-E3). */
  router.get('/:id/people/demographics', asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    const allowed = await can(prisma, 'report.view', {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
      fallback: async () => !!(await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: organizationId, status: 'active', role: { in: ['owner', 'admin'] } },
        select: { id: true },
      })),
    });
    if (!allowed) throw new ForbiddenError('You do not have permission to view reports for this institution.');

    const members = await prisma.organization_members.findMany({
      where: { organization_id: organizationId, status: 'active' },
      select: { scholarship: true, users: { select: { gender: true } } },
    });

    // Every category is initialised to zero, including not_recorded. A bucket
    // that only appears when non-empty reads as "nobody", which is exactly the
    // silent exclusion J1-E5-S4 forbids.
    const gender: Record<string, number> = { not_recorded: 0 };
    for (const g of GENDERS) gender[g] = 0;
    const scholarship = { yes: 0, no: 0, not_recorded: 0 };

    for (const m of members) {
      const g = m.users?.gender;
      gender[g && g in gender ? g : 'not_recorded'] += 1;
      scholarship[m.scholarship === true ? 'yes' : m.scholarship === false ? 'no' : 'not_recorded'] += 1;
    }

    res.json({ total: members.length, gender, scholarship });
  }));

  return router;
}

export type { RosterRowResult };
