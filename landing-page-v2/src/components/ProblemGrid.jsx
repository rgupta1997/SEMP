import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

/* Reveal-on-scroll. One observer for the whole grid rather than one per card:
   the cards stagger off a CSS variable, so they only need a single shared
   "we're visible now" flag. Fires once — a section that re-animates every time
   you scroll past it is a distraction, not a flourish.

   No observer (old browser, jsdom) means the content is visible immediately,
   which is the behaviour we want on failure. */
function useRevealOnce() {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return undefined
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, shown]
}

/* The problem section is the page's pitch, so it gets its own component rather
   than the generic hairline <Cells> grid: a tone per stage, the cost of the
   problem as a hard label, and the line that answers it. Problem and answer
   sit in the same card because splitting them means the reader has to hold
   four problems in their head until the capabilities section. */
export default function ProblemGrid({ items }) {
  const [ref, shown] = useRevealOnce()
  return (
    <div className={`pgrid${shown ? ' is-in' : ''}`} ref={ref}>
      {items.map(([icon, tone, title, what, cost, fix], i) => (
        <article className={`pcard pcard--${tone}`} key={title} style={{ '--i': i }}>
          <span className="pcard-rule" aria-hidden="true" />
          <header className="pcard-head">
            <span className="pcard-chip">
              <Icon name={icon} size={17} />
            </span>
            {/* Decorative: the order is already carried by the DOM. */}
            <span className="pcard-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
          </header>
          <h3 className="pcard-t">{title}</h3>
          <p className="pcard-c">{what}</p>
          <p className="pcard-cost">
            <Icon name="alert" size={13} />
            {cost}
          </p>
          <p className="pcard-fix">
            <Icon name="check" size={13} />
            <span>{fix}</span>
          </p>
        </article>
      ))}
    </div>
  )
}
