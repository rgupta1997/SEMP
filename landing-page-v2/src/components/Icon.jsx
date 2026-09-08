/* The icon set.
   =============================================================================
   Abstract concepts get SVG icons, not emoji. System emoji were tried and
   looked raw: multi-coloured, inconsistent in weight between glyphs, rendered
   differently on every OS (Windows' Segoe set is far cruder than Apple's), and
   illegible at 26px — 📡 came out a grey scribble, 🧬 a pink squiggle, 🏟️ a
   smudge. None of them could take the brand colour either.

   These are drawn on a 24px grid with currentColor and a 1.75 stroke, so a row
   of them reads as one family and inherits the theme.

   Emoji survive in exactly one place: the sports list, where ⚽ 🏀 🏏 are the
   clearest possible glyph and carry real meaning. See data/site.js.
   ============================================================================= */

const P = {
  /* --- UI ---------------------------------------------------------------- */
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-left': <path d="M15 18l-6-6 6-6" />,
  'chevron-right': <path d="M9 18l6-6-6-6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="M20 6L9 17l-5-5" />,
  close: <path d="M18 6L6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  x: <path d="M18 6L6 18M6 6l12 12" />,

  /* --- capabilities ------------------------------------------------------ */
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  'clipboard-list': (
    <>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M8 11h.01M12 11h4M8 16h.01M12 16h4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18M8 15h.01M12 15h.01M16 15h.01" />
    </>
  ),
  broadcast: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2" />
    </>
  ),
  medal: (
    <>
      <circle cx="12" cy="15" r="5.5" />
      <path d="M12 12.8v4.4M9.8 15h4.4" />
      <path d="M7.5 2.5l3 6.5M16.5 2.5l-3 6.5" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="16" r="4" />
      <path d="M10.8 13.2L20 4" />
      <path d="M15.5 8.5l2.5 2.5M18 6l2.5 2.5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 0 0-12 0c0 5-2 7-2 7h16s-2-2-2-7" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </>
  ),
  certificate: (
    <>
      <path d="M6 2h9l4 4v8H6z" />
      <path d="M15 2v4h4" />
      <circle cx="12" cy="18" r="3.5" />
      <path d="M10 21l-.6 2.4 2.6-1.3 2.6 1.3L14 21" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15v-3M12 15V8M17 15v-6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H5a2 2 0 0 0-2 2v7.5A2.5 2.5 0 0 0 5.5 15" />
    </>
  ),
  stadium: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="6" />
      <rect x="6.5" y="9.5" width="11" height="5" rx="2.5" />
      <path d="M12 9.5v5" />
    </>
  ),

  /* --- problems (the "before" state) ------------------------------------- */
  scatter: (
    <>
      <path d="M4 6h7M4 11h5M4 16h8" />
      <circle cx="17" cy="7" r="2" />
      <circle cx="19" cy="14" r="2" />
      <circle cx="14" cy="18" r="2" />
    </>
  ),
  duplicate: (
    <>
      <rect x="3" y="3" width="11" height="11" rx="2" />
      <rect x="10" y="10" width="11" height="11" rx="2" />
    </>
  ),
  'bell-off': (
    <>
      <path d="M18 9a6 6 0 0 0-9.3-5" />
      <path d="M6.3 6.3A6 6 0 0 0 6 9c0 5-2 7-2 7h13" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0M2 2l20 20" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),

  /* --- audiences / plans / misc ----------------------------------------- */
  school: (
    <>
      <path d="M3 21V10l9-6 9 6v11" />
      <path d="M9 21v-6h6v6M3 21h18" />
    </>
  ),
  university: (
    <>
      <path d="M12 3l10 5-10 5L2 8z" />
      <path d="M6 10.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.5" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-3h4v3" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4.5a2.5 2.5 0 0 0 2.5 2.5M17 6h2.5A2.5 2.5 0 0 1 17 8.5M9 20h6M12 14v6" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  'id-card': (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <circle cx="8.5" cy="11" r="2.5" />
      <path d="M4.5 17.5c.8-1.8 2.2-2.8 4-2.8s3.2 1 4 2.8M15 9.5h4M15 13.5h4" />
    </>
  ),
  package: (
    <>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
  'trend-up': (
    <>
      <path d="M22 7l-8.5 8.5-4-4L2 19" />
      <path d="M16 7h6v6" />
    </>
  ),
  juggle: (
    <>
      <circle cx="12" cy="4" r="2" />
      <circle cx="5" cy="10" r="1.6" />
      <circle cx="19" cy="10" r="1.6" />
      <path d="M9 21v-5l-1.5-3 2-3h5l2 3L15 16v5" />
    </>
  ),
  seed: (
    <>
      <path d="M12 21V11" />
      <path d="M12 11C12 7 9 4 5 4c0 4 3 7 7 7zM12 11c0-4 3-7 7-7 0 4-3 7-7 7z" />
    </>
  ),
  rocket: (
    <>
      <path d="M5 13c0-6 4-10 9-11 1 5-1 10-6 12z" />
      <path d="M5 13l-2 6 6-2M9 17a3 3 0 0 1-4-4" />
      <circle cx="14.5" cy="8.5" r="1.5" />
    </>
  ),
  bank: (
    <>
      <path d="M3 10l9-6 9 6" />
      <path d="M5 10v9M10 10v9M14 10v9M19 10v9M3 21h18" />
    </>
  ),
  ruler: (
    <>
      <rect x="2" y="8" width="20" height="8" rx="2" />
      <path d="M7 8v3M12 8v4M17 8v3" />
    </>
  ),
  pin: (
    <>
      <path d="M12 22s7-6.2 7-12A7 7 0 0 0 5 10c0 5.8 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  palette: (
    <>
      <path d="M12 21a9 9 0 1 1 9-9c0 2.2-1.8 3-3.5 3H16a2 2 0 0 0-1.4 3.4A1.8 1.8 0 0 1 12 21z" />
      <path d="M7.5 11.5h.01M10 8h.01M14.5 8h.01" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  phone: <path d="M15.5 21a13.5 13.5 0 0 1-12.5-12.5A2.5 2.5 0 0 1 5.5 6h2A1.5 1.5 0 0 1 9 7.3l.6 2.4a1.5 1.5 0 0 1-.7 1.6l-1 .6a10 10 0 0 0 4.2 4.2l.6-1a1.5 1.5 0 0 1 1.6-.7l2.4.6A1.5 1.5 0 0 1 18 16.5v2A2.5 2.5 0 0 1 15.5 21z" />,
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  smartphone: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  megaphone: (
    <>
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" />
      <path d="M15 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  'traffic-light': (
    <>
      <rect x="8" y="2" width="8" height="20" rx="4" />
      <path d="M12 7h.01M12 12h.01M12 17h.01" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,

  dna: (
    <>
      <path d="M5 3c0 6 14 12 14 18M19 3c0 6-14 12-14 18" />
      <path d="M8.5 6h7M7 11h10M8.5 16h7" />
    </>
  ),

  /* --- social ------------------------------------------------------------ */
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M17.5 6.5h.01" />
    </>
  ),
  linkedin: (
    <>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-11h4v1.5A5 5 0 0 1 16 8z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </>
  ),
  whatsapp: <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" />,
}

export default function Icon({ name, size = 18, strokeWidth = 1.75, className }) {
  const d = P[name]
  if (!d) return null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {d}
    </svg>
  )
}

/* An icon in a brand-tinted chip. This is the treatment that replaced the
   emoji on every abstract concept: one shape, one colour, one weight, so a
   grid of twelve reads as a set instead of twelve unrelated stickers. */
export function IconChip({ name, size = 20 }) {
  return (
    <span className="ichip">
      <Icon name={name} size={size} />
    </span>
  )
}
