// Title-case an enum/snake_case value for display: 'registration_open' -> 'Registration Open'.
export function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
