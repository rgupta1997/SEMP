/**
 * Per-organisation branding, applied at runtime.
 *
 * An institution picks ONE colour. Everything else - the ten-step ramp, the
 * sidebar, the focus ring, chips, links, the active nav item, the wordmark badge -
 * is derived from it by index.css, which expresses every `--color-brand-*` step as
 * an hsl() of three seed variables. So rebranding the entire product is writing
 * three numbers onto <html>.
 *
 * WHY ONE SEED AND NOT TEN OVERRIDES. A tenant is choosing their colour, not
 * authoring a design system. Interpolating the ramp keeps the LIGHTNESS
 * relationships the interface was drawn against, which is what makes the same
 * screen legible in maroon, forest green and orange rather than only in a blue of
 * the same value. Ten free-hand steps would let somebody pick a 400 darker than
 * their 600 and quietly break contrast everywhere at once.
 *
 * WHY THE SEED IS HSL AND THE INPUT IS HEX. The colour picker a person
 * understands is a hex field or a swatch; the ramp needs a hue it can rotate. The
 * conversion happens here, once, on the way in.
 */

/** What an organisation stores under `settings.theme`. */
export interface TenantTheme {
  /** The one colour. '#004AAD' is the Sportagon default. */
  brand?: string | null;
  /** Optional wordmark shown instead of the Sportagon mark inside this org. */
  logo_url?: string | null;
}

/** The product's own colour, and what "not themed" resolves to. */
export const DEFAULT_BRAND = '#004AAD';

/* ---------------------------------------------------------------- colour -- */

/** #RGB or #RRGGBB -> [r,g,b] 0-255. Returns null for anything else. */
function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** [r,g,b] -> {h, s, l} with s/l as percentages. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: +(l * 100).toFixed(1) };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: +(s * 100).toFixed(1), l: +(l * 100).toFixed(1) };
}

/**
 * Is this colour dark enough to carry white text?
 *
 * The primary button, the sidebar and every filled chip put white on brand-600.
 * A tenant who picks a pale yellow would get white-on-yellow across the product,
 * so the picker warns and the ramp clamps. Relative luminance per WCAG.
 */
export function contrastsWithWhite(hex: string): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return true;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // (1.05) / (L + 0.05) >= 4.5  =>  L <= 0.1833
  return (1.05) / (luminance + 0.05) >= 4.5;
}

/* ----------------------------------------------------------------- apply -- */

const ROOT_VARS = ['--brand-h', '--brand-s', '--brand-l'] as const;

/**
 * Paint a tenant's colour onto the document, or clear it.
 *
 * Clamped, not trusted: a seed lighter than 46% would put white text on a pale
 * ground everywhere, so the ramp's own 600 step is floored. The tenant still sees
 * their hue - the picker tells them why it was darkened rather than silently
 * disagreeing with their swatch.
 */
export function applyTenantTheme(theme: TenantTheme | null | undefined): void {
  const root = document.documentElement;
  const hsl = theme?.brand ? hexToHsl(theme.brand) : null;

  if (!hsl) {
    for (const v of ROOT_VARS) root.style.removeProperty(v);
    return;
  }

  root.style.setProperty('--brand-h', String(hsl.h));
  root.style.setProperty('--brand-s', `${Math.max(hsl.s, 12)}%`);
  root.style.setProperty('--brand-l', `${Math.min(Math.max(hsl.l, 22), 46)}%`);
}

/** Read a theme off an organisation's `settings` blob, defensively. */
export function themeOf(settings: unknown): TenantTheme {
  const raw = (settings as { theme?: unknown } | null)?.theme;
  if (!raw || typeof raw !== 'object') return {};
  const t = raw as Record<string, unknown>;
  return {
    brand: typeof t.brand === 'string' && parseHex(t.brand) ? t.brand : null,
    logo_url: typeof t.logo_url === 'string' && t.logo_url.trim() ? t.logo_url : null,
  };
}

/**
 * A short list of colours that are known to work.
 *
 * Offered because "pick a hex" is a worse question than "which of these is
 * closest to yours" for most of the people who will use this screen, and every
 * one of these already passes the white-text check. The custom field is still
 * there for an institution that knows its own value.
 */
export const BRAND_PRESETS: Array<{ name: string; hex: string }> = [
  { name: 'Sportagon blue', hex: '#004AAD' },
  { name: 'Ink',            hex: '#1F2937' },
  { name: 'Forest',         hex: '#14663D' },
  { name: 'Teal',           hex: '#0F6E73' },
  { name: 'Maroon',         hex: '#8C1D3F' },
  { name: 'Crimson',        hex: '#A31621' },
  { name: 'Rust',           hex: '#9A4218' },
  { name: 'Amber',          hex: '#8A5A00' },
  { name: 'Violet',         hex: '#5B21B6' },
  { name: 'Indigo',         hex: '#3730A3' },
  { name: 'Slate blue',     hex: '#28456C' },
  { name: 'Olive',          hex: '#4D5A1E' },
];
