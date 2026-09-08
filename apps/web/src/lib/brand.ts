// Files in public/, so they ship at BASE_URL + 'assets/...'. The prefix is
// REQUIRED, not decorative: the app is served from /app (see vite.config.ts), and
// a root-absolute '/assets/...' would resolve against the marketing site at the
// domain root instead - every logo in the app silently becoming a broken image.
// BASE_URL already ends in a slash.
const base = import.meta.env.BASE_URL;

export const BRAND = {
  name: 'Sportagon',
  productBadge: 'EOS',
  logo: {
    blue:  `${base}assets/sportagon-logo-blue.png`,
    white: `${base}assets/sportagon-logo-white.png`,
    mark:  `${base}assets/sportagon-mark.png`,
  },
} as const;
