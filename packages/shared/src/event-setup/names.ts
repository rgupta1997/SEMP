/*
 * NAMES - how the validator compares the free text clients type: people, squads,
 * competitors, grounds. Pure string helpers; no knowledge of sheets.
 */

/** Whitespace collapsed and trimmed. */
export const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** For matching labels (sport, squad, competitor, ground): letters and digits only, any case. */
export const looseKey = (s: string) => fold(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * A person's name for matching: lowercase, letters only, single spaces. Dots, hyphens
 * and underscores separate words ("P.Khavei" = "P Khavei"); other marks are dropped.
 */
export const nameKey = (s: string) =>
  fold(s).toLowerCase().replace(/[._\-]+/g, ' ').replace(/[^\p{L}\s]+/gu, '').replace(/\s+/g, ' ').trim();

/** An employee / student id for matching: upper case, letters and digits only. */
export const idKey = (s: string) => fold(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** "ATHARV SALUNKHE" and "soham lukhi" read as names; "P. Khavei" and "McDonald" are left alone. */
export function displayName(raw: string): string {
  return tidy(raw).split(' ').map((w) => {
    const letters = w.replace(/[^\p{L}]/gu, '');
    if (letters.length < 2) return w;
    if (letters === letters.toUpperCase() || letters === letters.toLowerCase()) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }
    return w;
  }).join(' ');
}

/** A url- and key-safe slug: "Acme Football Cup 2026" -> "acme-football-cup-2026". */
export function slug(s: string, max = 60): string {
  return fold(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
}

/** Scoreboard code, 12 chars max: "Centrica Super Kings - CSK" -> CSK, "UK IWR United" -> UIU, "Algonkings" -> ALGO. */
export function shortCode(name: string): string {
  const tag = name.match(/ - ([A-Za-z0-9]{2,6})$/);
  if (tag) return tag[1].toUpperCase();
  const words = fold(name).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return 'SQD';
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  let code = words.map((w) => w[0]).join('').slice(0, 4);
  if (code.length < 3) code = words[0].slice(0, 3 - (words.length - 1)) + words.slice(1).map((w) => w[0]).join('');
  return code.toUpperCase();
}

/** An organisation's short name: itself when it fits 12 characters, else its initials. */
export function orgShortName(name: string): string {
  const t = tidy(name);
  if (t.length <= 12) return t;
  const words = fold(t).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join('').toUpperCase();
  return initials.length >= 2 ? initials.slice(0, 12) : t.slice(0, 12).trim();
}

/** Levenshtein distance, giving up (returns max + 1) once it must exceed `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const tokenLike = (a: string, b: string) =>
  a === b
  || (a.length === 1 && b.startsWith(a))
  || (a.length >= 4 && b.length >= 4 && editDistance(a, b, 1) <= 1);

/** Every token of `a` matches a different token of `b` (exactly, as an initial, or one letter off), and `b` has more. */
export function tokensWithin(a: string[], b: string[]): boolean {
  if (!a.length || a.length >= b.length) return false;
  const free = [...b];
  for (const t of a) {
    const i = free.findIndex((u) => tokenLike(t, u));
    if (i < 0) return false;
    free.splice(i, 1);
  }
  return true;
}

/**
 * Could two DIFFERENT name keys be one person written two ways? Close spellings
 * ("salunke" / "salunkhe": within 2 edits, 1 for short names) or one name inside the
 * other ("mehraj" / "mehraj shaikh", "prathamesh tawde" / "prathmesh pradeep tawde").
 */
export function namesLookAlike(a: string, b: string): boolean {
  if (a === b) return false;
  const shorter = Math.min(a.replace(/ /g, '').length, b.replace(/ /g, '').length);
  const allowed = shorter >= 6 ? 2 : shorter >= 4 ? 1 : 0;
  if (allowed && editDistance(a, b, allowed) <= allowed) return true;
  const ta = a.split(' ');
  const tb = b.split(' ');
  return tokensWithin(ta, tb) || tokensWithin(tb, ta);
}
