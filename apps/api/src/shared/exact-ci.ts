// Exact, case-insensitive match for Prisma - which is NOT what `mode: 'insensitive'`
// gives you on its own.
//
// Prisma compiles `{ equals: x, mode: 'insensitive' }` to `col ILIKE $1` and does not
// escape the pattern, so `_` and `%` in the value are wildcards: "_kash@x.in" matched
// "akash@x.in", and an email of "%" matched every account. On the email sign-in path
// that meant a verified code for one address could open a different account.
//
// Escaping `\`, `%` and `_` (Postgres' default LIKE escape is backslash) turns the
// ILIKE back into what the call sites always meant: equal, ignoring case.

export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * `{ equals, mode: 'insensitive' }` with the value escaped - an exact match, any case.
 * null/undefined pass through untouched, so they mean exactly what they did before
 * (Prisma: undefined = no filter, null = IS NULL) rather than throwing.
 */
export function equalsIgnoreCase<T extends string | null | undefined>(value: T) {
  return { equals: (typeof value === 'string' ? escapeLike(value) : value) as T, mode: 'insensitive' as const };
}

/** `{ in, mode: 'insensitive' }` with every value escaped. */
export const inIgnoreCase = (values: string[]) =>
  ({ in: values.map(escapeLike), mode: 'insensitive' as const });
