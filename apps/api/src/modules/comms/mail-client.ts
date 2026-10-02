import { env } from '../../config/env.js';

// The HTTP client for the Sportagon Mail Service (docs/integration-guide.md).
//
// We POST a task and get a 202 with a job id. The service owns rendering, retries,
// provider failover, suppressions and the audit trail, so nothing downstream of this
// file knows what an SMTP connection is.
//
// A 202 means ACCEPTED AND DURABLE, not delivered. There is no synchronous answer to
// "did it arrive" and no `delivered` status - delivery shows up as an event on
// GET /mail/:id. Nothing here should be written as if it waits for one.
//
// TODO(outbox): a failed POST is a lost email. The service guarantees delivery only
// once it has the row; getting the row there is our problem, and today the only
// mitigation is retryOnce() below. That is deliberate for now (see the plan), but the
// exposure is not uniform:
//   - OTP is self-healing. The user sees no code, hits resend, and a new task is
//     posted. Losing one costs a retry.
//   - Invitations are NOT. Nobody is waiting on a screen and nobody retries - the
//     invitation simply never arrives and the row sits pending forever.
// When an outbox is added, it belongs here: write the task to a local table inside
// the caller's transaction, drain it from a worker, and let this function become the
// drain step rather than the send step.

export type MailAddress = string | { email: string; name?: string };

interface MailBase {
  to: MailAddress | MailAddress[];
  cc?: MailAddress | MailAddress[];
  bcc?: MailAddress | MailAddress[];
  replyTo?: string;
  /** 1-2 urgent (OTP), 3-5 transactional, 6-9 bulk. Lower runs first. */
  priority?: number;
  /**
   * Derive it from the EVENT, never from the clock or a random value - a key that
   * changes per attempt defeats the mechanism it exists for.
   */
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  sendAt?: string;
}

/** Template-driven: the subject comes from the template, so we must not send one. */
export interface TemplateMail extends MailBase {
  template: string;
  data: Record<string, unknown>;
}

/** Raw: `subject` is required, and `text` alongside `html` improves deliverability. */
export interface RawMail extends MailBase {
  subject: string;
  html?: string;
  text?: string;
}

export type MailRequest = TemplateMail | RawMail;

export interface MailResult {
  /** True once the service has the job. False only for the console transport. */
  queued: boolean;
  id?: string;
  /** The service already had this idempotency key; no second mail was sent. */
  deduplicated?: boolean;
}

export class MailError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

/**
 * Every string prop in every template is `minLength: 1`, so an empty string is a 422
 * rather than an omitted field. Our own data is full of `x ?? ''` and `a || b || ''`
 * fallbacks, and one of those reaching a template would fail the whole send over a
 * field nobody needed. Passing everything optional through here turns "" into
 * undefined, which the service treats as "not supplied" and renders its default for.
 */
export const nonEmpty = (v: string | null | undefined): string | undefined => {
  const s = v?.trim();
  return s ? s : undefined;
};

/** Drops keys whose value is undefined, so `data` never carries an explicit null. */
export const compact = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;

// 4xx below are the service telling us the request itself is wrong: the same bytes
// will fail the same way, so a retry is just a slower failure. 429 and 5xx and a
// network timeout are the ones worth a second go.
const isRetryable = (status: number | null) => status === null || status === 429 || status >= 500;

async function post(path: string, body: unknown): Promise<{ status: number; payload: any }> {
  const res = await fetch(`${env.MAIL_API_URL}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': env.MAIL_API_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(env.MAIL_TIMEOUT_MS),
  });

  // A 5xx from an edge/proxy can be HTML, so a failed parse must not mask the status.
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    /* keep payload null and let the status speak */
  }

  return { status: res.status, payload };
}

async function send(path: string, body: MailRequest | object): Promise<any> {
  // Retrying without an idempotency key can double-send: a timeout cannot tell us
  // whether the service got the row. With a key the retry is free - the service
  // returns the original job - so the retry is gated on having one.
  const canRetry = 'idempotencyKey' in body && !!(body as MailBase).idempotencyKey;

  for (let attempt = 0; ; attempt++) {
    let status: number | null = null;
    let payload: any = null;

    try {
      ({ status, payload } = await post(path, body));
    } catch (err) {
      // Timeout or connection failure - no status at all.
      if (attempt === 0 && canRetry) continue;
      throw new MailError(`mail-service unreachable: ${(err as Error).message}`, null);
    }

    // 202 new, 200 idempotent replay - both mean the service has it.
    if (status === 200 || status === 202) return payload;

    if (isRetryable(status) && attempt === 0 && canRetry) continue;

    const e = payload?.error ?? {};
    throw new MailError(
      `mail-service ${status} ${e.code ?? ''}: ${e.message ?? 'request failed'}`.trim(),
      status,
      e.code,
      e.details,
    );
  }
}

/** Queue one message. Throws MailError; callers decide whether that is fatal. */
export async function sendMail(message: MailRequest): Promise<MailResult> {
  if (env.MAIL_TRANSPORT === 'console') {
    const to = JSON.stringify(message.to);
    const what = 'template' in message ? `template=${message.template}` : `subject=${JSON.stringify(message.subject)}`;
    console.info(`[mail:console] to=${to} ${what}`);
    // The SHAPE, never the VALUES. `data` carries the OTP for the otp template, the
    // invite token for invitations and the reset link for password resets - and on any
    // hosted deploy this line is a durable, searchable copy of it in CloudWatch or the
    // platform's log store, readable by everyone who can read logs. The key names are
    // what this line was actually useful for (debugging a 422 over a field the template
    // wanted and we did not send) and they are not secret.
    //
    // Redacted unconditionally rather than gated on NODE_ENV: this fix must not depend
    // on the variable whose absence caused the leak in the first place. Object.keys is
    // also fail-closed by construction, where a denylist of secret-looking key names
    // would silently miss whatever field someone adds next.
    if ('data' in message) {
      console.info(`[mail:console] data keys=[${Object.keys(message.data).sort().join(',')}]`);
    }
    return { queued: false };
  }

  const job = await send('/mail', message);
  return { queued: true, id: job?.id, deduplicated: job?.deduplicated === true };
}

/**
 * Queue many personalised messages in one transaction.
 *
 * Capped at 500 by the service, so callers chunk. A 202 does NOT mean every message
 * was accepted - individual messages can be rejected without failing the batch, which
 * is why `rejected` is returned rather than swallowed.
 */
export const MAIL_BATCH_LIMIT = 500;

export async function sendMailBatch(
  messages: MailRequest[],
  defaults?: Partial<MailBase> & { template?: string; data?: Record<string, unknown> },
): Promise<{ accepted: number; rejected: unknown[] }> {
  if (messages.length === 0) return { accepted: 0, rejected: [] };

  if (env.MAIL_TRANSPORT === 'console') {
    console.info(`[mail:console] batch of ${messages.length}`);
    return { accepted: 0, rejected: [] };
  }

  let accepted = 0;
  const rejected: unknown[] = [];

  for (let i = 0; i < messages.length; i += MAIL_BATCH_LIMIT) {
    const chunk = messages.slice(i, i + MAIL_BATCH_LIMIT);
    const res = await send('/mail/batch', { ...(defaults ? { defaults } : {}), messages: chunk });
    accepted += res?.acceptedCount ?? 0;
    if (res?.rejectedCount) rejected.push(...(res.rejected ?? []));
  }

  return { accepted, rejected };
}
