import SportIcon from './SportIcon'

/**
 * Floating-icons hero, for the sports section.
 *
 * The reference demo consumed a `FloatingIconsHero` from
 * `@/components/ui/floating-icons-hero-section`, but only the demo was
 * supplied — the component itself wasn't — so this is built to the API that
 * demo implies: `{ title, subtitle, icons }`, each icon carrying its own
 * position. The demo's CTA is dropped: the only caller sat this panel directly
 * on top of the section its button pointed at, so the button scrolled the
 * reader past nothing.
 *
 * Three departures from the reference, all deliberate:
 *
 *  1. POSITIONS ARE DATA, NOT TAILWIND CLASSES. The demo put them in
 *     `className: 'top-[10%] left-[10%]'`. There is no Tailwind here, and a
 *     percentage pair is clearer than a class string anyway.
 *
 *  2. EVERY TILE IS LABELLED. The demo's icons are bare logos, which works for
 *     Google and Figma because those marks are already known. A drawn kho-kho
 *     glyph is not, and unlabelled they were genuinely hard to tell apart.
 *
 *  3. IT IS A LIST, NOT DECORATION. Because the names are now visible text,
 *     the field is a real `<ul>` rather than an `aria-hidden` backdrop — hiding
 *     it would make assistive tech skip content everyone else can read. Only
 *     the glyphs are hidden, since the name beside each one says it better.
 */
export default function FloatingSports({
  id,
  label,
  title,
  subtitle,
  footnote,
  icons,
}) {
  return (
    // `id` so a page with a section rail can anchor to this panel like any
    // other section — .fs is a <section> in its own right, not a <Section>.
    <section className="fs" id={id}>
      <ul className="fs-field" aria-label="Sports configured out of the box">
        {icons.map(({ name, sport, top, right, out, delay, scale }) => (
          <li
            key={name}
            className="fs-chip"
            /* Which side of the centre channel, and how far out along it.
               NOT a raw left/right percentage: a percentage is relative to the
               panel, so whether a tile cleared the headline depended on the
               viewport, and every width not tested could collide. `--fs-out`
               is an offset from the channel edge, so a tile is outside the
               copy by construction at every width. */
            data-side={right != null ? 'r' : 'l'}
            style={{
              top: `${top}%`,
              /* Unitless on purpose: --fs-out is a FRACTION of the gutter,
                 and the CSS multiplies a length by it. Emitting "0.62px" here
                 made that a length-times-length product, which is invalid, so
                 the whole calc collapsed and every tile stacked in the corner. */
              '--fs-out': out ?? 0,
              // Staggered so they don't bob in unison, which reads as a glitch.
              animationDelay: `${delay}s`,
              '--fs-scale': scale ?? 1,
            }}
          >
            <SportIcon name={name} size={30} />
            <span className="fs-chip-n">{sport}</span>
          </li>
        ))}
      </ul>

      <div className="wrap fs-in">
        {label && <span className="eyebrow">{label}</span>}
        <h2>{title}</h2>
        {subtitle && <p className="fs-sub">{subtitle}</p>}
        {footnote && <p className="fs-note">{footnote}</p>}
      </div>
    </section>
  )
}
