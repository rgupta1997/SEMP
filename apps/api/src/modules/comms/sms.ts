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
    console.info(`[sms:bypass] to=${message.to} ${JSON.stringify(message.text)}`);
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
