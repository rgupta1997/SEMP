import { useEffect, useRef, useState } from 'react'
import { Shot } from './blocks'

/**
 * The product, walked end to end: a sticky rail of the stages beside the real
 * screens, in the order an organisation meets them.
 *
 * WHY NOT A CAROUSEL. This section was five slides in a coverflow. A carousel
 * puts every screen but one behind a gesture, and — worse for this particular
 * argument — it presents the screens as interchangeable. They are not: the
 * institution's structure decides who can enter, setup feeds the schedule, the
 * schedule feeds the scoring console, the console feeds the standings, the
 * standings feed the certificates. A vertical walk is the only shape that says
 * that.
 *
 * WHY A STICKY RAIL AND NOT SIXTEEN HEADINGS. Sixteen stacked screenshots with
 * no index is a section a visitor cannot see the end of. The rail gives it a
 * shape (five phases), lets someone jump to the screen they came to see, and
 * shows where they are — which is what turns a long scroll into a journey.
 *
 * THE RAIL IS A REAL LIST OF LINKS. Each entry is an anchor to that step's id,
 * so it works with the keyboard, with middle-click and with JS off; the scroll
 * listener only moves the highlight. `aria-current` carries the active state
 * for a screen reader.
 */
export default function ProductJourney({ stages, phases }) {
  const [active, setActive] = useState(stages[0]?.shot)
  const stepsRef = useRef([])
  const railRef = useRef(null)

  /* THE HIGHLIGHT IS DRIVEN BY SCROLL POSITION, NOT BY AN OBSERVER.
     The first version used an IntersectionObserver, which fires only when a
     step crosses the root margin - so between two crossings the rail sat still
     while the page moved, and the highlight visibly disagreed with what was on
     screen. Position is what this needs to reflect, so position is what it
     reads, once per animation frame.

     `READ_LINE` is where a step is considered "the one being read": just below
     the 60px sticky nav. The active step is the LAST one whose top has passed
     it, which means the highlight changes exactly as a step's own title
     reaches the top of the viewport. */
  useEffect(() => {
    const READ_LINE = 150
    let frame = 0

    const measure = () => {
      frame = 0
      const nodes = stepsRef.current.filter(Boolean)
      if (!nodes.length) return
      let current = nodes[0]
      for (const node of nodes) {
        if (node.getBoundingClientRect().top <= READ_LINE) current = node
      }
      if (current.dataset.shot) setActive(current.dataset.shot)
    }

    // rAF-throttled: scroll fires far more often than the highlight can change,
    // and getBoundingClientRect in a raw scroll handler forces layout on every
    // event.
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure) }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [stages])

  /* Keep the lit entry inside the rail's own scroll box.
     The rail is capped at the viewport height, so with sixteen entries the
     active one can sit outside it - the highlight is then correct and invisible,
     which reads as broken. scrollTop is nudged by hand rather than with
     scrollIntoView, because scrollIntoView on a child of an overflow container
     also scrolls the PAGE, which would fight the scroll that got us here. */
  useEffect(() => {
    const rail = railRef.current
    if (!rail || rail.scrollHeight <= rail.clientHeight) return
    const on = rail.querySelector('a[aria-current]')
    if (!on) return
    const item = on.getBoundingClientRect()
    const box = rail.getBoundingClientRect()
    const pad = 12
    if (item.top < box.top + pad) rail.scrollTop -= box.top + pad - item.top
    else if (item.bottom > box.bottom - pad) rail.scrollTop += item.bottom - box.bottom + pad
  }, [active])

  const phaseOf = (id) => phases.find((p) => p.id === id)

  return (
    <div className="jr">
      <nav className="jr-rail" aria-label="The screens in this journey" ref={railRef}>
        {phases.map((ph) => (
          <div className="jr-phase" key={ph.id}>
            <span className="jr-phase-t">{ph.title}</span>
            <ul>
              {stages.map((s, i) => (s.phase === ph.id ? (
                <li key={s.shot}>
                  <a
                    href={`#j-${s.shot}`}
                    className={active === s.shot ? 'is-on' : undefined}
                    aria-current={active === s.shot ? 'true' : undefined}
                  >
                    <span className="jr-rn">{String(i + 1).padStart(2, '0')}</span>
                    {s.title}
                  </a>
                </li>
              ) : null))}
            </ul>
          </div>
        ))}
      </nav>

      <ol className="jr-steps">
        {stages.map((s, i) => (
          <li
            className="jr-step"
            id={`j-${s.shot}`}
            key={s.shot}
            data-shot={s.shot}
            ref={(el) => { stepsRef.current[i] = el }}
          >
            <p className="jr-step-n">
              <b>{String(i + 1).padStart(2, '0')}</b>
              {phaseOf(s.phase)?.title}
            </p>
            <h3>{s.title}</h3>
            <p className="jr-step-c">{s.line}</p>
            {/* The first three load eagerly: a visitor scrolling at any speed
                meets the top of this section immediately, and an empty frame
                where the proof should be is worse than the bytes. The rest are
                lazy — sixteen screens is ~770KB of WebP, and the thirteen below
                the fold are a scroll away, not a paint away. */}
            <Shot name={s.shot} priority={i === 0} lazy={i > 2} />
            <dl className="jr-meta">
              {s.meta.map((m) => (
                <div key={m.label}>
                  <dt>{m.label}</dt>
                  <dd>{m.value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
    </div>
  )
}
