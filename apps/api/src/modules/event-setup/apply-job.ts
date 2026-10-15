// THE APPLY JOB — one run of the engine over a validated setup, and the bookkeeping
// around it (status, report, credentials). Called two ways:
//
//   - locally (tsx / any long-lived process): detached inside the request that started
//     it, exactly as before;
//   - on Lambda: from a separate ASYNCHRONOUS invocation of the same function (see
//     startApplyJob and lambda.ts). A request's container is frozen the moment its
//     response is sent, so a job left running after a 202 never finishes there.
//
// The route has already moved the row to 'applying' and stored a fresh validation; the
// job takes its blueprint from that stored validation, so both paths build from
// exactly what was checked.
import type { Prisma } from '../../infra/prisma.js';
import { applyBlueprint, storableCredential, type CredentialRow } from './engine.js';
import { makeEventSetupRepo } from './event-setup.repo.js';

/** A fresh credential replaces an older one for the same login; the rest are kept. */
export function mergeCredentials(existing: CredentialRow[] | null | undefined, fresh: CredentialRow[]): CredentialRow[] {
  const byLogin = new Map<string, CredentialRow>();
  for (const c of [...(existing ?? []), ...fresh]) byLogin.set(c.email.toLowerCase(), storableCredential(c));
  return [...byLogin.values()];
}

/** The payload of the asynchronous Lambda invocation that runs an apply. */
export interface EventSetupJobEvent {
  eventSetupJob: { kind: 'apply'; setupId: string; actorId: string };
}

export const isEventSetupJobEvent = (e: unknown): e is EventSetupJobEvent =>
  !!e && typeof e === 'object' && !!(e as EventSetupJobEvent).eventSetupJob
  && (e as EventSetupJobEvent).eventSetupJob.kind === 'apply'
  && typeof (e as EventSetupJobEvent).eventSetupJob.setupId === 'string';

/** Run one apply to the end and record the outcome on the setup. Never throws. */
export async function runApplyJob(prisma: Prisma, setupId: string, actorId: string): Promise<void> {
  const repo = makeEventSetupRepo(prisma);
  const credentials: CredentialRow[] = [];
  try {
    const row = await repo.get(setupId);
    if (!row) throw new Error(`setup ${setupId} no longer exists`);
    if (row.status !== 'applying') throw new Error(`setup ${setupId} is ${row.status}, not applying - nothing to do`);
    const bp = row.validation?.blueprint;
    if (!bp || !row.validation?.ok) throw new Error('the stored validation has no blueprint to build from');
    const result = await applyBlueprint(prisma, bp, repo.manifestStore(setupId), { actorId, credentials });
    const current = await repo.get(setupId);
    await repo.update(setupId, {
      status: 'applied', apply_report: result.reports, error: null,
      credentials: mergeCredentials(current?.credentials, credentials),
      organization_id: result.ids.orgId, championship_id: result.ids.champId, applied_at: new Date(),
    });
  } catch (e) {
    console.error(`[event-setup] apply failed for ${setupId}:`, e);
    try {
      const current = await repo.get(setupId);
      // Only a run that was really applying is marked failed - a stray or duplicate
      // invocation must not knock an applied setup back.
      if (current?.status === 'applying') {
        await repo.update(setupId, {
          status: 'failed', error: e instanceof Error ? e.message : String(e),
          // Accounts made before the failure exist: keep their logins.
          ...(credentials.length ? { credentials: mergeCredentials(current.credentials, credentials) } : {}),
          organization_id: current.manifest.keys.org ?? current.organization_id ?? null,
          championship_id: current.manifest.keys.championship ?? current.championship_id ?? null,
        });
      }
    } catch (inner) {
      console.error(`[event-setup] could not record the failure for ${setupId}:`, inner);
    }
  }
}

/**
 * Start an apply. On Lambda (AWS_LAMBDA_FUNCTION_NAME is set by the runtime) the
 * function invokes ITSELF asynchronously with the job, and the request returns at
 * once; the job then has the function's whole timeout to itself. Anywhere else it
 * runs detached in this process. Returns once the job is handed off.
 */
export async function startApplyJob(
  prisma: Prisma, setupId: string, actorId: string,
  runLocal: (job: () => Promise<void>) => void,
): Promise<void> {
  const fn = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!fn) {
    runLocal(() => runApplyJob(prisma, setupId, actorId));
    return;
  }
  // The AWS SDK v3 ships inside the Lambda Node.js runtime, so it is external to the
  // bundle and only ever loaded here, on Lambda.
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const payload: EventSetupJobEvent = { eventSetupJob: { kind: 'apply', setupId, actorId } };
  await new LambdaClient({}).send(new InvokeCommand({
    FunctionName: fn,
    InvocationType: 'Event',
    Payload: new TextEncoder().encode(JSON.stringify(payload)),
  }));
}
