import * as React from 'react'
import Icon from './Icon'

/**
 * Coverflow carousel.
 *
 * Ported from the shadcn/Tailwind/TS original. The transform maths, the ring
 * folding, the RAF settle and the drag physics are kept VERBATIM — that is the
 * valuable part and it is framework-agnostic. What changed is only the shell:
 *
 *   `cn()`               → template strings (no clsx/tailwind-merge here)
 *   Tailwind utilities   → the `.cf-*` classes in styles/site.css
 *   lucide-react         → the project's own SVG Icon set (two chevrons; adding
 *                          a dependency for those when an icon system already
 *                          exists would be backwards)
 *   TypeScript props     → JSDoc, since this project is JSX
 *   `aspect-square`      → a `cardAspect` prop. The original is built for album
 *                          art; our slides are 16:10 product screenshots and
 *                          squaring them would crop the UI to uselessness.
 */

const useIsoLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect

/* Pixels of horizontal travel before a press counts as a drag rather than a
   tap. Below this the carousel does not move and does not take pointer
   capture, so a link inside a card gets its click. */
const DRAG_SLOP = 6

/**
 * @param {object}   props
 * @param {Array<{src:string,alt:string,title?:string,subtitle?:string,meta?:{label:string,value:string}[]}>} [props.slides]
 *        Image slides. Mutually exclusive with `items`.
 * @param {React.ReactNode[]} [props.items]
 *        CONTENT slides — arbitrary nodes instead of an image. Text in a raked
 *        card is much harder to read than a picture is, so a content carousel
 *        should be driven at a far lower `rotate` than an image one.
 * @param {number}   [props.rotate]      Degrees the first neighbour tilts.
 * @param {number}   [props.depth]       How far the first neighbour recedes, as a fraction of card width.
 * @param {number}   [props.perspective] Viewer distance as a multiple of card width — smaller is a wider lens.
 * @param {number}   [props.falloff]     Exponent on distance. Below 1 the rake eases off as cards travel out.
 * @param {number}   [props.fade]        Opacity lost per step from the centre.
 * @param {string}   [props.cardWidth]   Any CSS length. Everything else derives from it, so the rake scales.
 * @param {number}   [props.cardAspect]  width / height. 1 is the original square.
 * @param {string}   [props.cardHeight]
 *        An explicit card height, for CONTENT carousels. An aspect RATIO is the
 *        wrong model for text: as the card narrows the copy reflows TALLER,
 *        while a ratio makes the box shorter — so a ratio that fits at 1440px
 *        clips at 390px. Images keep using `cardAspect`, because a picture
 *        scales with its box.
 * @param {number}   [props.gap]         Space between cards, as a fraction of card width.
 */
export default function CoverflowCarousel({
  slides,
  items,
  rotate = 44,
  depth = 0.6,
  perspective = 3,
  falloff = 0.56,
  fade = 0.1,
  cardWidth = 'clamp(148px, 22vw, 260px)',
  cardAspect = 1,
  cardHeight,
  gap = 0.05,
  loop = true,
  showCaption = false,
  showPagination = false,
  showNavigation = false,
  label = 'Cover carousel',
  className = '',
  cardClassName = '',
}) {
  // Content mode when `items` is given, image mode otherwise. `count` drives
  // the whole ring, so it has to come from whichever list is in play.
  const isContent = Array.isArray(items) && items.length > 0
  const list = isContent ? items : slides
  const count = list.length

  const frameRef = React.useRef(null)
  const cardRefs = React.useRef([])
  /** Fractional card index at the centre. The single source of truth. */
  const posRef = React.useRef(0)
  /** Where the current settle is headed. Stepping off `pos` instead would
      swallow a keypress that lands mid-flight, before the round-off moves. */
  const targetRef = React.useRef(0)
  const widthRef = React.useRef(0)
  const rafRef = React.useRef(null)
  const dragRef = React.useRef(null)
  // Set by a drag that actually moved, read and cleared by the click that
  // follows it — a throw must not also open the card it comes to rest on.
  const draggedRef = React.useRef(false)

  const [selected, setSelected] = React.useState(0)

  /** Nearest whole card, folded back into 0..count-1. */
  const indexAt = React.useCallback(
    (pos) => ((Math.round(pos) % count) + count) % count,
    [count],
  )

  // Paint straight to the DOM. Sixty state updates a second would re-render
  // every card for numbers React never needs to see.
  const paint = React.useCallback(() => {
    const width = widthRef.current
    if (!width) return
    const pitch = width * (1 + gap)
    const pos = posRef.current

    cardRefs.current.forEach((card, index) => {
      if (!card) return

      // Fold the distance into the shorter way round the ring. This is the
      // whole looping mechanism — no cloned nodes, no shuffling the DOM.
      let offset = index - pos
      if (loop) {
        offset = ((offset % count) + count) % count
        if (offset > count / 2) offset -= count
      }

      const distance = Math.abs(offset)
      // Both the tilt and the recession ease off as cards travel out —
      // doubling the distance adds only about half again as much of each.
      // A linear ramp folds the second card shut; this keeps it readable.
      const ramp = Math.pow(distance, falloff)
      // Capped short of edge-on so a far card never turns its back.
      const tilt = Math.min(rotate * ramp, 82) * Math.sign(offset)

      card.style.transform =
        `translateX(calc(-50% + ${offset * pitch}px)) ` +
        `translateZ(${-depth * width * ramp}px) rotateY(${-tilt}deg)`

      // A card is teleported across the ring at exactly half a turn out, so it
      // has to be gone by then or the jump is visible.
      const edge = loop ? Math.min(1, Math.max(0, count / 2 - distance)) : 1
      card.style.opacity = String(Math.max(0, 1 - fade * distance) * edge)
      card.style.zIndex = String(100 - Math.round(distance))
    })
  }, [count, depth, fade, falloff, gap, loop, rotate])

  const settle = React.useCallback(
    (target) => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      targetRef.current = target
      setSelected(indexAt(target))

      const step = () => {
        const remaining = target - posRef.current
        if (Math.abs(remaining) < 0.0004) {
          posRef.current = target
          paint()
          rafRef.current = null
          return
        }
        // Exponential ease-out, not a spring. Swap in a spring only if the
        // settle needs overshoot.
        posRef.current += remaining * 0.16
        paint()
        rafRef.current = requestAnimationFrame(step)
      }
      rafRef.current = requestAnimationFrame(step)
    },
    [indexAt, paint],
  )

  const clamp = React.useCallback(
    (pos) => (loop ? pos : Math.max(0, Math.min(count - 1, pos))),
    [count, loop],
  )

  const goTo = React.useCallback(
    (index) => {
      // Take the shorter way round rather than unwinding the whole ring.
      const target = loop
        ? index + Math.round((targetRef.current - index) / count) * count
        : index
      settle(clamp(target))
    },
    [clamp, count, loop, settle],
  )

  const nudge = React.useCallback(
    (by) => settle(clamp(Math.round(targetRef.current) + by)),
    [clamp, settle],
  )

  /* CAPTURE IS DEFERRED UNTIL THE POINTER ACTUALLY MOVES.
     It used to be taken here, on pointerdown, and that silently killed every
     link inside a card — the four solution cards on home navigated nowhere.
     With the frame holding pointer capture, pointerup retargets to the frame,
     so the browser fires `click` on the frame instead of the <a> underneath
     the finger. Capturing only once the drag passes DRAG_SLOP leaves a plain
     tap as an ordinary click on the card, and a real drag still gets capture
     before the first move is applied. */
  const onPointerDown = (event) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    targetRef.current = posRef.current
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      pos: posRef.current,
      v: 0,
      t: performance.now(),
      moved: false,
    }
  }

  const onPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return

    const pitch = widthRef.current * (1 + gap)
    if (!pitch) return

    // Below the slop this is still a tap, so do nothing and let the click land.
    if (!drag.moved) {
      if (Math.abs(event.clientX - drag.x) < DRAG_SLOP) return
      drag.moved = true
      drag.x = event.clientX // re-datum, so the card does not jump by the slop
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const now = performance.now()
    const previous = posRef.current
    posRef.current = clamp(drag.pos - (event.clientX - drag.x) / pitch)
    // Cards per second, for the throw.
    drag.v = ((posRef.current - previous) / Math.max(now - drag.t, 1)) * 1000
    drag.t = now

    const index = indexAt(posRef.current)
    if (index !== selected) setSelected(index)
    paint()
  }

  const endDrag = (event) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    dragRef.current = null
    // A tap never moved the track, so there is nothing to settle — returning
    // here also keeps settle() from stealing focus off the link being clicked.
    if (!drag.moved) {
      draggedRef.current = false
      return
    }
    // The click that follows a drag must not also open the card underneath.
    draggedRef.current = true
    // Let a flick carry, but never more than two cards.
    const carried = Math.max(-2, Math.min(2, drag.v * 0.18))
    settle(clamp(Math.round(posRef.current + carried)))
  }

  /* CLICKS ARE RESOLVED BY COORDINATE, NOT BY EVENT TARGET.

     Every off-centre card is rotated in 3D, and a real pointer event over one
     does not reach it — it lands on .cf-track underneath. Sampling an 81-point
     grid over each card's box: the centred card is hit 81 times, each side card
     zero. So the four Solutions cards on home were unclickable unless they
     happened to be the centred one, and no per-card handler could ever have
     fired to fix it.

     Handling the click on the frame and working out which card the pointer was
     over from the x coordinate sidesteps the 3D hit test entirely. The
     behaviour it buys is the one a coverflow should have anyway:

       - centred card  -> do nothing, and let the <a> inside navigate normally
       - side card     -> swallow the click and bring that card to the centre

     which also kills the worst version of the old bug, where a click aimed at
     one card could reach the link of the card overlapping it. */
  const onFrameClick = (event) => {
    if (draggedRef.current) {
      draggedRef.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    let nearest = -1
    let best = Infinity
    cardRefs.current.forEach((card, index) => {
      if (!card) return
      // SKIP THE CARDS THAT ARE NOT THERE. On a looping ring a card half a turn
      // out is painted at opacity 0 mid-teleport — with four cards that is one
      // of them at all times — and its box still sits under the pointer.
      // Picking it as "nearest" sent the click to a card nobody could see.
      if (parseFloat(card.style.opacity || '1') < 0.05) return
      const box = card.getBoundingClientRect()
      const distance = Math.abs(event.clientX - (box.left + box.width / 2))
      if (distance < best) {
        best = distance
        nearest = index
      }
    })
    if (nearest === -1 || nearest === indexAt(posRef.current)) return
    event.preventDefault()
    event.stopPropagation()
    // goTo, not settle: on a loop it takes the shorter way round the ring
    // instead of unwinding to a raw index that may be half a turn away.
    goTo(nearest)
  }

  // Card width drives pitch, depth and perspective, so it is the only thing
  // worth measuring — and only when the box actually changes.
  useIsoLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const measure = () => {
      const card = cardRefs.current[0]
      if (!card) return
      widthRef.current = card.offsetWidth
      paint()
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [paint])

  React.useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const active = isContent ? null : slides[selected]

  return (
    <div
      className={`cf ${isContent ? 'cf--content' : ''} ${className}`.trim()}
      style={{
        '--cf-card': cardWidth,
        '--cf-aspect': cardAspect,
        ...(cardHeight ? { '--cf-h': cardHeight } : null),
      }}
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
    >
      <div className="cf-rel">
        <div
          ref={frameRef}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={onFrameClick}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              nudge(-1)
            } else if (event.key === 'ArrowRight') {
              event.preventDefault()
              nudge(1)
            }
          }}
          // Vertical padding keeps the drop shadows clear of the overflow clip.
          className="cf-frame"
          style={{
            perspective: `calc(var(--cf-card) * ${perspective})`,
            // Horizontal drag is ours; the page keeps vertical scrolling.
            touchAction: 'pan-y',
          }}
        >
          <div className="cf-track">
            {list.map((entry, index) => (
              <div
                key={isContent ? index : entry.src}
                ref={(node) => {
                  cardRefs.current[index] = node
                }}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${count}`}
                className={`cf-card ${isContent ? 'cf-card--content' : ''} ${cardClassName}`.trim()}
              >
                {isContent ? (
                  entry
                ) : (
                  <img src={entry.src} alt={entry.alt} draggable={false} className="cf-img" />
                )}
              </div>
            ))}
          </div>
        </div>

        {showNavigation && (
          <>
            <button type="button" aria-label="Previous slide" onClick={() => nudge(-1)} className="cf-nav cf-nav--prev">
              <Icon name="chevron-left" size={20} />
            </button>
            <button type="button" aria-label="Next slide" onClick={() => nudge(1)} className="cf-nav cf-nav--next">
              <Icon name="chevron-right" size={20} />
            </button>
          </>
        )}
      </div>

      {showCaption && active?.title && (
        <div key={selected} className="cf-cap">
          <p className="cf-cap-t">{active.title}</p>
          {active.subtitle && <p className="cf-cap-s">{active.subtitle}</p>}
          {active.meta && active.meta.length > 0 && (
            <dl className="cf-meta">
              {active.meta.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {showPagination && (
        <div className="cf-dots">
          {list.map((entry, index) => (
            <button
              key={isContent ? index : entry.src}
              type="button"
              aria-label={`Go to slide ${index + 1}`}
              aria-current={index === selected}
              onClick={() => goTo(index)}
              className={`cf-dot${index === selected ? ' is-on' : ''}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
