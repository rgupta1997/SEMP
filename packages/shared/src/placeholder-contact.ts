// Placeholder contacts: the stand-in email/phone a login is provisioned with when
// the sheet it came from has none (a corporate roster with names only, a roster
// import with no email column). A super admin swaps them for the real ones on
// registration day, which is what lets that person sign in.
//
// Both halves are chosen so a placeholder can never reach a real person:
//   - email: the `.invalid` TLD is reserved (RFC 2606) - mail to it never delivers.
//   - phone: 10 digits starting `50000`. Indian mobiles start 6-9, so no SMS or
//     WhatsApp code sent to one of these lands on anybody's handset.
//
// Every check keys off the LAST 10 digits of a phone, the same key the sign-in
// lookup and findUserByPhone match on, so "+91 50000 00017" and "5000000017" are
// the same placeholder.

export const PLACEHOLDER_EMAIL_DOMAIN = 'placeholder.invalid';
export const PLACEHOLDER_PHONE_PREFIX = '50000';
/** Five free digits after the prefix: placeholderPhone(0) .. placeholderPhone(99999). */
export const PLACEHOLDER_PHONE_MAX_SEQ = 99_999;

const last10Digits = (phone: string) => phone.replace(/\D/g, '').slice(-10);

/** True for any address on the placeholder domain, whatever its case or padding. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/** True when the number's last 10 digits sit in the 50000xxxxx placeholder range. */
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const last10 = last10Digits(phone);
  return last10.length === 10 && last10.startsWith(PLACEHOLDER_PHONE_PREFIX);
}

/**
 * True when either contact is a placeholder - i.e. the account still needs its real
 * details before its owner can use it. A MISSING phone is not a placeholder (plenty
 * of real accounts have none); only a stand-in value is.
 */
export function hasPlaceholderContact(
  user: { email?: string | null; phone?: string | null } | null | undefined,
): boolean {
  if (!user) return false;
  return isPlaceholderEmail(user.email) || isPlaceholderPhone(user.phone);
}

/**
 * The placeholder phone for slot `seq` (0..99999), e.g. 17 -> "5000000017".
 * Uniqueness is the caller's: hand each provisioned person their own seq, since
 * phone is not unique in the users table and a reused seq would put two people on
 * one number.
 */
export function placeholderPhone(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0 || seq > PLACEHOLDER_PHONE_MAX_SEQ) {
    throw new RangeError(`placeholderPhone: seq must be an integer 0..${PLACEHOLDER_PHONE_MAX_SEQ}, got ${seq}`);
  }
  return `${PLACEHOLDER_PHONE_PREFIX}${String(seq).padStart(5, '0')}`;
}

/**
 * A placeholder email from any slug - a name, an employee code, a phone - reduced to
 * a safe local part: lowercased, accents dropped, every run of other characters
 * collapsed to "-", capped at 64 (the RFC local-part limit).
 *   "Rohit Gupta #17" -> "rohit-gupta-17@placeholder.invalid"
 * Email IS unique, so the slug must be unique too; that is the caller's to ensure.
 */
export function placeholderEmail(slug: string | number): string {
  const local = String(slug)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  if (!local) throw new RangeError(`placeholderEmail: "${slug}" has no letters or digits to build an address from`);
  return `${local}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}
