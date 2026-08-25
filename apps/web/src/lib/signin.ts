import { api, tokenStore } from './api';

// Client for the phone-first sign-in flow.
//
// The shape mirrors the API's one rule: a phone can reach several accounts, so
// almost every call may come back with `choose` instead of a session. Screens
// handle that once, here, rather than each remembering to.

export interface AccountChoice {
  id: string;
  name: string;
  email: string;
  sportagon_id: string | null;
  organization: { id: string; name: string; logo_url: string | null } | null;
  email_verified: boolean;
  phone_verified: boolean;
}

export interface IdentifyResult {
  registered: boolean;
  account_count: number;
  methods: Array<'otp' | 'password'>;
  can_sign_up: boolean;
}

export interface SentCode {
  sent: true;
  expires_at?: string;
  /** Present only while the delivery bypass is on. Never in production. */
  dev_code?: string;
  bypass?: boolean;
}

export interface SessionResult {
  token: string;
  user: { id: string; name: string; email: string };
  must_change_password?: boolean;
}

/** Either we are in, or we have to ask which account. */
export type SignInOutcome =
  | { kind: 'session'; session: SessionResult }
  | { kind: 'choose'; verification_token: string; accounts: AccountChoice[] };

export type Subject = { phone: string } | { email: string };
export type OtpPurpose = 'sign_in' | 'signup' | 'password_reset' | 'verify_email' | 'verify_phone';

const outcome = (r: any): SignInOutcome =>
  r?.choose
    ? { kind: 'choose', verification_token: r.verification_token, accounts: r.accounts }
    : { kind: 'session', session: r as SessionResult };

export const identify = (subject: Subject) =>
  api<IdentifyResult>('POST', '/auth/identify', subject);

export const sendCode = (subject: Subject, purpose: OtpPurpose) =>
  api<SentCode>('POST', '/auth/otp/send', { ...subject, purpose });

/** Sign-in codes may resolve straight to a session; verification codes give a ticket. */
export const checkCode = (subject: Subject, code: string, purpose: OtpPurpose) =>
  api<any>('POST', '/auth/otp/check', { ...subject, code, purpose });

export const signInWithPassword = async (subject: Subject, password: string) =>
  outcome(await api<any>('POST', '/auth/password', { ...subject, password }));

export const openAccount = (verification_token: string, account_id: string) =>
  api<SessionResult>('POST', '/auth/session', { verification_token, account_id });

export const completeSignup = (body: {
  phone_token: string; email_token: string; name: string; password: string;
}) => api<SessionResult>('POST', '/auth/signup', body);

export const resetPassword = (body: {
  verification_token: string; account_id?: string; password: string;
}) => api<any>('POST', '/auth/reset-password', body);

/**
 * Store the session the way the rest of the app expects it.
 *
 * Kept here so no screen has to remember the order: the token has to be in the
 * store before anything reads /auth/me, or the very first request after signing
 * in goes out unauthenticated.
 */
export function keepSession(session: SessionResult) {
  tokenStore.set(session.token);
}

/** Does this look like a phone number rather than an email? */
export const looksLikePhone = (v: string) => !v.includes('@') && /\d/.test(v);

/** What the user typed, as the subject the API expects. */
export const asSubject = (v: string): Subject =>
  looksLikePhone(v) ? { phone: v.trim() } : { email: v.trim().toLowerCase() };
