import { env } from '../../config/env.js';

// The one place the API sends a WhatsApp message.
//
// Same shape as email.ts and sms.ts - this module renders the message and hands it
// to a transport - except that here the transport is real: AiSensy's Campaign API,
// which fronts a Meta WhatsApp Business account. It is the delivery channel for
// phone sign-in codes, which SMS never became: transactional SMS in India needs DLT
// registration (a sender ID and per-template approval, procurement with a lead time),
// while the WhatsApp template is already approved on the AiSensy side.
//
// The payload mirrors the Sportagon FMS edge functions (send-booking-whatsapp,
// send-consent-whatsapp), which are the house AiSensy pattern: the same endpoint,
// `userName: "Sportagon"`, a `source` tag, and the empty media/buttons/carouselCards/
// location fields AiSensy's documented body carries whether or not a template uses
// them. The one deliberate departure is the button - see otpWhatsapp() below.
//
// Config, all from env:
//   AISENSY_API_KEY      from AiSensy Dashboard > Settings > API & Webhook. The
//                        Campaign API is a PAID feature - a free-plan key answers
//                        ERR401 "Unauthorized" to every call, including AiSensy's
//                        own sample payload.
//   AISENSY_OTP_CAMPAIGN the live campaign bound to the approved authentication
//                        template. Named per-campaign, as FMS does it.
//   AISENSY_API_URL      the endpoint, overridable so a test tenant can be pointed
//                        elsewhere without a code change.

const AISENSY_SOURCE = 'sportagon-eos';

/** AiSensy requires a recipient name on every send; it is a label, not an identity. */
const AISENSY_USER_NAME = 'Sportagon';

export interface WhatsappTemplateMessage {
  /** Country code + number, digits only, no '+'. Use toDestination(). */
  destination: string;
  /** Values for the template's {{1}}, {{2}}, ... in order. */
  templateParams: string[];
  /** Parameters for the template's button, when it has one that takes any. */
  buttonParams?: string[];
}

/** True once a key and a campaign exist - the switch between WhatsApp and the SMS stub. */
export const whatsappConfigured = (): boolean =>
  Boolean(env.AISENSY_API_KEY && env.AISENSY_OTP_CAMPAIGN);

/**
 * A stored number into what AiSensy wants: digits, country code, no '+'.
 *
 * normalizePhone() keeps only the last 10 digits, so what reaches here is almost
 * always a bare national number and the code has to be put back. Anything that is
 * not exactly 10 digits is assumed to carry its own country code already - the same
 * rule the FMS functions use - so a number arriving in full E.164 is not given a second.
 */
export function toDestination(phone: string, countryCode = env.OTP_PHONE_COUNTRY_CODE): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `${countryCode}${digits}` : digits;
}

/** The request body AiSensy's Campaign API expects. Pure, so the shape is testable. */
export function aisensyPayload(
  message: WhatsappTemplateMessage,
  config: { apiKey: string; campaignName: string },
): Record<string, unknown> {
  return {
    apiKey: config.apiKey,
    campaignName: config.campaignName,
    destination: message.destination,
    userName: AISENSY_USER_NAME,
    templateParams: message.templateParams,
    source: AISENSY_SOURCE,
    media: {},
    buttons: message.buttonParams?.length
      ? [{
          type: 'button',
          sub_type: 'url',
          index: 0,
          parameters: message.buttonParams.map((text) => ({ type: 'text', text })),
        }]
      : [],
    carouselCards: [],
    location: {},
  };
}

/**
 * Whether AiSensy actually took the message.
 *
 * It can answer HTTP 200 with a `success` of false - request accepted, nothing
 * delivered (campaign paused, template/param mismatch, recipient not whitelisted on
 * a test tenant). Trusting the status code alone is how a silently undelivered code
 * looks exactly like a sent one, so the body gets a say too.
 *
 * `success` comes back as the STRING "true" from the live endpoint, not a boolean -
 * so the test is for falsehood in either spelling. Comparing against `false` alone
 * would read the string "false" as a success and swallow the very failure this
 * function exists to catch.
 */
export function aisensyDelivered(ok: boolean, body: string): boolean {
  if (!ok) return false;
  try {
    const parsed = JSON.parse(body) as { success?: boolean | string };
    return parsed?.success !== false && String(parsed?.success).toLowerCase() !== 'false';
  } catch {
    // Non-JSON body - nothing to contradict the status.
    return true;
  }
}

export async function sendWhatsapp(message: WhatsappTemplateMessage): Promise<{ delivered: boolean }> {
  if (!whatsappConfigured()) {
    console.info(`[whatsapp:unconfigured] to=${message.destination}`);
    return { delivered: false };
  }

  const payload = aisensyPayload(message, {
    apiKey: env.AISENSY_API_KEY,
    campaignName: env.AISENSY_OTP_CAMPAIGN,
  });

  let res: Response;
  let body = '';
  try {
    // Bounded: the whole request runs inside a 15s Lambda, and a sign-in screen
    // waiting on a hung gateway is worse than a clear failure.
    res = await fetch(env.AISENSY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    body = await res.text().catch(() => '');
  } catch (err) {
    console.error('[whatsapp] AiSensy request failed:', err instanceof Error ? err.message : err);
    return { delivered: false };
  }

  const delivered = aisensyDelivered(res.ok, body);
  // Logged on failure only. A successful send's body is noise - and either way the
  // code is in the REQUEST, never in the response, so this cannot leak one.
  if (!delivered) console.error('[whatsapp] AiSensy did not deliver', res.status, body);
  return { delivered };
}

// ---------- templates ----------

/**
 * The sign-in code, for the approved `otp` authentication template:
 *
 *   {{1}} is your verification code. For your security, do not share this code.
 *   [ Copy code ]
 *
 * Meta requires the SAME code in BOTH the body variable and the button parameter;
 * sending only the body variable makes AiSensy answer 200 while WhatsApp silently
 * drops the message. Hence the two identical values - neither is redundant.
 *
 * This is where we depart from the FMS functions, which append button values to
 * `templateParams` (AiSensy's continuous {{N+1}} numbering) and post `buttons: []`.
 * That convention is for the DYNAMIC URL buttons in their utility templates; a
 * copy-code button on an authentication template takes the structured button
 * component instead, which is the shape Meta documents and the one proven to deliver.
 *
 * No expiry text: an authentication template's body is fixed at approval time, so
 * the TTL cannot be interpolated here the way otpSms() does it.
 */
export function otpWhatsapp(code: string): Pick<WhatsappTemplateMessage, 'templateParams' | 'buttonParams'> {
  return { templateParams: [code], buttonParams: [code] };
}
