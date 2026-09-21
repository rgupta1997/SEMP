import { env } from '../../config/env.js';

// The one place the API sends an SMS.
//
// Deliberately the same shape as email.ts: this module renders the message and
// hands it to a transport. No provider is wired yet, and with OTP_SMS_BYPASS on we
// log it and let the caller surface the code in-band - exactly what the email path
// already does, so a developer with no gateway account can still run the whole
// sign-in flow end to end.
//
// Wiring a real provider replaces the body of sendSms() and nothing else. Whichever
// one is chosen, transactional SMS in India also needs DLT registration - a sender
// ID and per-template approval - which is procurement with a lead time rather than
// code. The bypass is what stops that blocking the build.

export interface SmsMessage {
  to: string;
  text: string;
}

export async function sendSms(message: SmsMessage): Promise<{ delivered: boolean }> {
  if (env.OTP_SMS_BYPASS) {
    // The recipient and the size, never the body: otpSms() renders the code as the
    // FIRST token of `text`, so logging it puts every phone sign-in code wherever
    // stdout goes. OTP_SMS_BYPASS defaults on, so this was the noisiest of the three
    // leak paths on any deploy that had not set NODE_ENV.
    //
    // The developer affordance is unaffected - the bypass still returns the code in
    // /auth/otp/send's own response, which is gated on !isProduction there.
    console.info(`[sms:bypass] to=${message.to} (${message.text.length} chars, not sent)`);
    return { delivered: false };
  }

  // TODO: POST to the SMS service and let it own retries and delivery receipts.
  throw new Error('SMS delivery is not wired yet - set OTP_SMS_BYPASS=true for now');
}

// ---------- templates ----------

// Kept deliberately short. Indian transactional SMS is billed per 160-character
// segment and the DLT template has to be registered verbatim, so a longer message
// costs more and is harder to change later.
export function otpSms(code: string, ttlMinutes: number): Omit<SmsMessage, 'to'> {
  return { text: `${code} is your Sportagon sign-in code. It expires in ${ttlMinutes} minutes.` };
}
