import * as React from 'react'
import Icon from './Icon'

/**
 * Format deck — the six competition structures as an expanding accordion.
 *
 * Why not a third coverflow. The home page already runs CoverflowCarousel twice
 * (product slides, audiences). A third would read as a tic, and a raked card is
 * the wrong container for this content anyway: the whole point of a bracket
 * diagram is that you can trace it, and a coverflow tilts every card except one
 * off-axis. So the carousel here is an ACCORDION carousel — six panels sharing
 * one row, the open one taking the space the other five give up.
 *
 * One DOM, two axes. Desktop lays the panels along a row and animates
 * `grid-template-columns`; below 900px the same panels stack and animate their
 * body from `0fr` to `1fr`. Nothing is duplicated and nothing is display:none'd
 * per breakpoint, so there is exactly one thing to keep correct.
 *
 * The template is handed to CSS as `--fd-cols` rather than set as
 * `grid-template-columns` directly. An inline style would beat the media query
 * and the phone layout would inherit a six-column desktop track.
 *
 * @param {object} props
 * @param {Array<{name:string,tag?:string,note:string,knobs:string[],img:string,alt:string}>} props.items
 * @param {string} [props.label]  Accessible name for the group.
 */
export default function FormatDeck({ items, label = 'Competition structures' }) {
  const [open, setOpen] = React.useState(0)
  const uid = React.useId()

  // Hover-to-open is a desktop affordance only. On a touch screen there is no
  // hover, and on a narrow one the panel that opens under a scrolling thumb is
  // a jump-scare rather than a preview.
  const [hoverable, setHoverable] = React.useState(false)
  React.useEffect(() => {
    const q = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 900px)')
    const sync = () => setHoverable(q.matches)
    sync()
    q.addEventListener('change', sync)
    return () => q.removeEventListener('change', sync)
  }, [])

  const spines = React.useRef([])

  const move = (from, step) => {
    const next = (from + step + items.length) % items.length
    setOpen(next)
    spines.current[next]?.focus()
  }

  const onKeyDown = (event, index) => {
    // Both axes are bound, because which one the panels are laid out along
    // depends on the viewport and the reader should not have to know.
    const back = ['ArrowLeft', 'ArrowUp']
    const on = ['ArrowRight', 'ArrowDown']
    if (back.includes(event.key)) {
      event.preventDefault()
      move(index, -1)
    } else if (on.includes(event.key)) {
      event.preventDefault()
      move(index, 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      move(-1, 1)
    } else if (event.key === 'End') {
      event.preventDefault()
      move(0, -1)
    }
  }

  return (
    <div
      className="fd"
      role="group"
      aria-label={label}
      style={{
        '--fd-cols': items
          .map((_, n) => (n === open ? 'minmax(0, 1fr)' : 'var(--fd-shut)'))
          .join(' '),
      }}
    >
      {items.map((s, n) => {
        const on = n === open
        return (
          <section key={s.name} className={`fd-p${on ? ' is-on' : ''}`}>
            <h3 className="fd-h">
              <button
                type="button"
                ref={(node) => {
                  spines.current[n] = node
                }}
                className="fd-spine"
                aria-expanded={on}
                aria-controls={`${uid}-b${n}`}
                id={`${uid}-t${n}`}
                onClick={() => setOpen(n)}
                onMouseEnter={hoverable ? () => setOpen(n) : undefined}
                onFocus={() => setOpen(n)}
                onKeyDown={(event) => onKeyDown(event, n)}
              >
                <span className="fd-num">{String(n + 1).padStart(2, '0')}</span>
                <span className="fd-name">{s.name}</span>
                <Icon name="chevron-down" size={16} className="fd-chev" />
              </button>
            </h3>

            <div
              className="fd-body"
              id={`${uid}-b${n}`}
              role="region"
              aria-labelledby={`${uid}-t${n}`}
              /* Collapsed panels are clipped to nothing, so leaving them in the
                 accessibility tree would announce six overlapping structures at
                 once. There is nothing focusable inside, so aria-hidden alone
                 is enough — no inert needed (and React 18 does not pass it). */
              aria-hidden={!on}
            >
              {/* The clip is its own box so the padded one can keep its
                  padding: under border-box a height of zero still cannot
                  squeeze padding out, and a shut panel showed a band of it. */}
              <div className="fd-clip">
                <div className="fd-in">
                  <figure className="fd-shot">
                    <img
                      src={s.img}
                      alt={s.alt}
                      width="1376"
                      height="768"
                      /* Six illustrations well below the fold. The open one is
                         decoded on mount either way; the rest arrive as the
                         reader opens them, which is what lazy is for. */
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                  </figure>
                  <div className="fd-say">
                    {s.tag && <span className="fd-tag">{s.tag}</span>}
                    <p className="fd-note">{s.note}</p>
                    <span className="panel-label">What you configure</span>
                    <ul className="fd-knobs">
                      {s.knobs.map((k) => (
                        <li key={k}>
                          <Icon name="check" size={14} />
                          {k}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}
