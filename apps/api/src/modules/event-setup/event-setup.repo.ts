/*
 * event_setups, read and written through raw SQL: the table is newer than the
 * generated Prisma client (Prisma here is introspection-only, and the client cannot
 * be regenerated while the dev server holds its engine). Every statement is a
 * tagged template - values are parameters, and the only identifiers spliced in are
 * column names from the fixed lists below.
 */
import { Prisma as PrismaNS } from '@prisma/client';
import type {
  SetupEventType, SetupIssue, SetupPlatformStep, SetupSteps, SetupValidationResult, SetupValidationSummary,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { normaliseManifest, type CredentialRow, type Manifest, type ManifestStore, type StepReport } from './engine.js';

export const SETUP_STATUSES = ['draft', 'invalid', 'validated', 'applying', 'applied', 'failed', 'undone'] as const;
export type SetupStatus = (typeof SETUP_STATUSES)[number];

export interface IssueCounts { error: number; warning: number; info: number }
export interface VerifyReport { checked: number; failures: string[]; at: string }
export interface PlatformPlan { steps: SetupPlatformStep[]; issues: SetupIssue[] }

/** What the list shows: no grids, no blueprint. */
export interface EventSetupListRow {
  id: string;
  label: string;
  event_type: SetupEventType;
  status: SetupStatus;
  file_name: string | null;
  organization_id: string | null;
  org_name: string | null;
  championship_id: string | null;
  championship_name: string | null;
  summary: SetupValidationSummary | null;
  issue_counts: IssueCounts;
  created_at: Date;
  updated_at: Date;
  applied_at: Date | null;
  created_by_name: string | null;
}

/** Everything but the uploaded grids. */
export interface EventSetupRow extends EventSetupListRow {
  steps: SetupSteps;
  validation: SetupValidationResult | null;
  platform: PlatformPlan | null;
  blueprint_key: string | null;
  manifest: Manifest;
  apply_report: StepReport[] | null;
  verify_report: VerifyReport | null;
  credentials: CredentialRow[] | null;
  error: string | null;
  created_by: string | null;
}

/** The columns an update may set, and how each is cast. */
const JSON_COLUMNS = ['steps', 'workbook', 'validation', 'platform', 'manifest', 'apply_report', 'verify_report', 'credentials'] as const;
const UUID_COLUMNS = ['organization_id', 'championship_id'] as const;
const TEXT_COLUMNS = ['label', 'status', 'file_name', 'blueprint_key', 'error'] as const;
export interface EventSetupPatch {
  steps?: SetupSteps;
  workbook?: { sheets: Record<string, string[][]> } | null;
  validation?: SetupValidationResult | null;
  platform?: PlatformPlan | null;
  manifest?: Manifest;
  apply_report?: StepReport[] | null;
  verify_report?: VerifyReport | null;
  credentials?: CredentialRow[] | null;
  organization_id?: string | null;
  championship_id?: string | null;
  label?: string;
  status?: SetupStatus;
  file_name?: string | null;
  blueprint_key?: string | null;
  error?: string | null;
  applied_at?: Date | null;
}

const LIST_SELECT = PrismaNS.sql`
  s.id::text as id, s.label, s.event_type, s.status, s.file_name,
  s.organization_id::text as organization_id, o.name as org_name,
  s.championship_id::text as championship_id, c.name as championship_name,
  s.validation -> 'summary' as summary,
  jsonb_build_object('error', ic.error, 'warning', ic.warning, 'info', ic.info) as issue_counts,
  s.created_at, s.updated_at, s.applied_at, u.name as created_by_name`;

const LIST_FROM = PrismaNS.sql`
  from event_setups s
  left join organizations o on o.id = s.organization_id
  left join championships c on c.id = s.championship_id
  left join users u on u.id = s.created_by
  left join lateral (
    select count(*) filter (where i ->> 'severity' = 'error')::int   as error,
           count(*) filter (where i ->> 'severity' = 'warning')::int as warning,
           count(*) filter (where i ->> 'severity' = 'info')::int    as info
      from jsonb_array_elements(
             case when jsonb_typeof(s.validation -> 'issues') = 'array' then s.validation -> 'issues' else '[]'::jsonb end
          || case when jsonb_typeof(s.platform -> 'issues') = 'array' then s.platform -> 'issues' else '[]'::jsonb end) i
  ) ic on true`;

export function makeEventSetupRepo(prisma: Prisma) {
  const get = async (id: string): Promise<EventSetupRow | null> => {
    const rows = await prisma.$queryRaw<EventSetupRow[]>(PrismaNS.sql`
      select ${LIST_SELECT},
             s.steps, s.validation, s.platform, s.blueprint_key, s.manifest, s.apply_report,
             s.verify_report, s.credentials, s.error, s.created_by::text as created_by
      ${LIST_FROM}
      where s.id = ${id}::uuid`);
    const row = rows[0];
    return row ? { ...row, manifest: normaliseManifest(row.manifest) } : null;
  };

  return {
    get,

    async list(): Promise<EventSetupListRow[]> {
      return prisma.$queryRaw<EventSetupListRow[]>(PrismaNS.sql`select ${LIST_SELECT} ${LIST_FROM} order by s.created_at desc`);
    },

    async workbook(id: string): Promise<{ sheets: Record<string, string[][]> } | null> {
      const rows = await prisma.$queryRaw<Array<{ workbook: { sheets: Record<string, string[][]> } | null }>>(PrismaNS.sql`
        select workbook from event_setups where id = ${id}::uuid`);
      return rows[0]?.workbook ?? null;
    },

    async create(input: { label: string; event_type: SetupEventType; steps: SetupSteps; created_by: string | null }): Promise<string> {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>(PrismaNS.sql`
        insert into event_setups (label, event_type, status, steps, created_by)
        values (${input.label}, ${input.event_type}, 'draft', ${JSON.stringify(input.steps)}::jsonb, ${input.created_by}::uuid)
        returning id::text as id`);
      return rows[0].id;
    },

    /**
     * Set the given columns. With `onlyIf`, only while the row is in one of those
     * statuses (or, with `staleApplyingMs`, stuck in 'applying' that long) - a
     * compare-and-set, so two requests (or two Lambdas) cannot both move a row.
     * Returns whether the row was updated.
     */
    async update(id: string, patch: EventSetupPatch, guard?: { onlyIf: SetupStatus[]; staleApplyingMs?: number }): Promise<boolean> {
      const sets: PrismaNS.Sql[] = [];
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if ((JSON_COLUMNS as readonly string[]).includes(k)) sets.push(PrismaNS.sql`${PrismaNS.raw(k)} = ${v === null ? null : JSON.stringify(v)}::jsonb`);
        else if ((UUID_COLUMNS as readonly string[]).includes(k)) sets.push(PrismaNS.sql`${PrismaNS.raw(k)} = ${v}::uuid`);
        else if ((TEXT_COLUMNS as readonly string[]).includes(k)) sets.push(PrismaNS.sql`${PrismaNS.raw(k)} = ${v}`);
        else if (k === 'applied_at') sets.push(PrismaNS.sql`applied_at = ${v}::timestamptz`);
        else throw new Error(`event_setups: no such column ${k}`);
      }
      sets.push(PrismaNS.sql`updated_at = now()`);
      const where = guard
        ? PrismaNS.sql`and (status = any(${guard.onlyIf}::text[])${guard.staleApplyingMs
          ? PrismaNS.sql` or (status = 'applying' and updated_at < now() - make_interval(secs => ${guard.staleApplyingMs / 1000}))`
          : PrismaNS.empty})`
        : PrismaNS.empty;
      const n = await prisma.$executeRaw(PrismaNS.sql`
        update event_setups set ${PrismaNS.join(sets, ', ')} where id = ${id}::uuid ${where}`);
      return n > 0;
    },

    async remove(id: string): Promise<void> {
      await prisma.$executeRaw(PrismaNS.sql`delete from event_setups where id = ${id}::uuid`);
    },

    /** The engine's manifest, kept on the row. Every save also marks the row as alive. */
    manifestStore(id: string): ManifestStore {
      return {
        async load() {
          const rows = await prisma.$queryRaw<Array<{ manifest: unknown }>>(PrismaNS.sql`select manifest from event_setups where id = ${id}::uuid`);
          if (!rows.length) throw new Error('event setup not found');
          return normaliseManifest(rows[0].manifest);
        },
        async save(m: Manifest) {
          await prisma.$executeRaw(PrismaNS.sql`
            update event_setups set manifest = ${JSON.stringify(m)}::jsonb, updated_at = now() where id = ${id}::uuid`);
        },
      };
    },
  };
}

export type EventSetupRepo = ReturnType<typeof makeEventSetupRepo>;
