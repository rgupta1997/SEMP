import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/* A sticky rail of the sections on a long reference page.

   THE PROBLEM IT SOLVES. Home links to /features#workflow. The scroll lands on
   the right section, but the reader arrives in the middle of a five-section
   page with no idea what they skipped or what is still below — the section they
   asked for reads as an arbitrary slice of something else. This rail turns that
   arrival into "section 2 of 5, here is the rest", and doubles as the way back
   out to the sections either side of it.

   WHY A SCROLL LISTENER AND NOT IntersectionObserver. The active item has to be
   "the last section whose top has passed the nav", which is a question about
   position, not intersection — with sections taller than the viewport an
   observer reports nothing entering or leaving for a whole screen of scrolling
   and the rail freezes on the wrong item. rAF-throttled scroll reads are cheap
   and always answer the right question.

   Clicking an item pushes the hash rather than scrolling directly, so it goes
   through the same ScrollToTop path as an arriving deep link — one scroll
   behaviour, one landed-highlight, one entry in the back button's history. */
export default function PageNav({ items }) {
  const { hash } = useLocation()
  const navigate = useNavigate()
  const [active, setActive] = useState(items[0][0])
  /* The rail sticks directly below the main nav, and the nav's height is not a
     constant — its padding changes at the 900px breakpoint. Hard-coding 59px
     tucked the rail 6px UNDER the header on desktop. Measure it, publish it as
     --nav-h on :root, and let both the sticky offset and the anchor's
     scroll-margin read from the same number. */
  useEffect(() => {
    const nav = document.querySelector('.nav')
    if (!nav) return
    const measure = () => {
      document.documentElement.style.setProperty('--nav-h', `${Math.round(nav.getBoundingClientRect().height)}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(nav)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--nav-h')
    }
  }, [])

  useEffect(() => {
    let frame = null
    const read = () => {
      frame = null
      /* THE LINE IS THE ANCHOR'S OWN scroll-margin-top, not a guess.
         A section that a hash has just scrolled to comes to rest exactly at its
         scroll-margin, so any line above that leaves the rail lighting the
         PREVIOUS section on arrival — which is the one moment the rail most
         needs to be right. Reading the same number the scroll used makes the
         two agree by construction; +2 absorbs subpixel rounding. */
      let current = items[0][0]
      for (const [id] of items) {
        const el = document.getElementById(id)
        if (!el) continue
        const line = (parseFloat(getComputedStyle(el).scrollMarginTop) || 60) + 2
        if (el.getBoundingClientRect().top <= line) current = id
      }
      // At the very bottom the last section may never cross the line — nothing
      // below it can scroll further — so the final item would never light.
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        current = items[items.length - 1][0]
      }
      setActive(current)
    }
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [items, hash])

  /* On a phone the rail scrolls sideways, so the lit item can be off-screen —
     by section 4 the reader sees "The twelve · The workflow" with nothing
     highlighted, which is worse than no rail at all. Keep it in view.
     `nearest` on the inline axis only, so this never scrolls the page. */
  useEffect(() => {
    const el = document.querySelector('.pagenav a[aria-current]')
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [active])

  return (
    <nav className="pagenav" aria-label="On this page">
      <div className="wrap pagenav-in">
        <span className="pagenav-l">On this page</span>
        <ul>
          {items.map(([id, label], i) => (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={active === id ? 'true' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(`#${id}`)
                }}
              >
                <span className="pagenav-n">{i + 1}</span>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
