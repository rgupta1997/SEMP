// Title-case an enum/snake_case value for display: 'registration_open' -> 'Registration Open'.
export function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A first guess at a scoreboard abbreviation.
 *
 * A SUGGESTION, never the stored value - the field it fills is required and
 * editable, and it stops following the name the moment somebody types their own.
 * The reason short names are entered rather than derived is that derivation cannot
 * tell "B.Tech 2023" from "B.Tech 2024", and on a scoreboard the abbreviation is the
 * side's identity. This gets the common case ("VJTI Titans" -> "VT") to a place a
 * person can correct in two keystrokes.
 *
 * Digits survive whole, because a year is what distinguishes one batch from the next.
 */
export function suggestShort(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const out = words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join('');
  // A single word gives nothing to initialise, so take its first characters instead.
  return (out.length >= 2 ? out : words[0].slice(0, 4)).toUpperCase().slice(0, 12);
}

/**
 * The day, said the way a person would.
 *
 * "Today" and "Tomorrow" are what an organiser is actually looking for in a list of
 * 224 fixtures - a date they have to decode into "is that now?" is a date that does
 * not help. Everything outside that three-day window gets the full form, because
 * "Thursday" is ambiguous the moment more than one Thursday is in range.
 *
 * Format: `28th Aug, 2026` - ordinal day, short month, full year.
 */
export function dayLabel(d?: string | Date | null): string {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';

  // Compared at local midnight, not by elapsed hours: a match at 23:00 tonight and
  // one at 01:00 tonight are both "today" to the person reading, even though one is
  // two hours away and the other is twenty-two.
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(new Date())) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';

  const n = date.getDate();
  // 11th, 12th and 13th are the exceptions the naive rule gets wrong.
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th'
    : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  const month = date.toLocaleDateString('en-GB', { month: 'short' });
  return `${n}${suffix} ${month}, ${date.getFullYear()}`;
}

/** `7:30 PM`. Twelve-hour, because that is how kick-off times are said here. */
export function timeLabel(d?: string | Date | null): string {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * `Today · 7:30 PM`, or `28th Aug, 2026 · 7:30 PM`.
 *
 * A fixture with no time at all says so rather than rendering a midnight that was
 * never chosen - "00:00 AM" beside every unscheduled match is the kind of detail
 * that makes a screen look broken.
 */
export function whenLabel(d?: string | Date | null): string {
  if (!d) return 'Time TBD';
  const day = dayLabel(d);
  if (!day) return 'Time TBD';
  return `${day} · ${timeLabel(d)}`;
}
