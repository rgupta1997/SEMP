// The Sportagon ID: three letters + a per-prefix counter (STG0001, AEO0042).
//
// STG is for accounts nobody issued on an organisation's behalf - self sign-up and
// every other path. It is also minted by the database trigger in
// 20260928000000_sportagon_id_prefixes.sql, which cannot import this constant.
export const DEFAULT_ID_PREFIX = 'STG';

// Joining words carry no identity: "Northfield Institute of Technology" is NIT, not NIO.
const PREFIX_STOP_WORDS = new Set(['of', 'the', 'and', 'for', 'at', 'in', 'a', 'an']);

/**
 * The three letters an organisation stamps on accounts it creates.
 *
 * Initials of the first three main words; a shorter name is topped up from the
 * letters of its last word ("Sportagon" -> SPO, "Aman Enterprise" -> AEN). A name
 * with no Latin letters falls back to STG rather than minting something unreadable.
 */
export function orgIdPrefix(name: string | null | undefined): string {
  const words = (name ?? '')
    // Dropped, not split on: "Xavier's" is one word, not "Xavier" and "s".
    .replace(/['’]/g, '')
    .split(/[^A-Za-z]+/)
    .filter((w) => w && !PREFIX_STOP_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return DEFAULT_ID_PREFIX;

  let letters = words.slice(0, 3).map((w) => w[0]).join('');
  if (letters.length < 3) letters += words[words.length - 1].slice(1, 1 + 3 - letters.length);
  return letters.toUpperCase().padEnd(3, 'X');
}
