import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Nav from './components/Nav'
import Footer from './components/Footer'
import Home from './pages/Home'
import { Features, LiveScoring, Reports } from './pages/Product'
import { SolutionsHub, SolutionPage } from './pages/Solutions'
import { Players, Pricing, Demo, Contact, NotFound } from './pages/Misc'

/* Scroll behaviour on navigation.
   Top of the page for a route change, but the TARGET SECTION for a hash — a
   plain scrollTo(0,0) made every in-page anchor jump to the top instead, which
   silently broke them.

   Block body, not a concise arrow: a concise arrow hands the return value to
   React, which then tries to call it as the effect's cleanup function.

   `key` IS IN THE DEPS, and that is the whole reason in-page links work more
   than once. Clicking "See what replaces all four" while already at
   /#capabilities pushes an identical pathname and hash, so an effect keyed on
   those two strings never re-runs — the first click scrolled and every click
   after it did nothing (or worse, landed halfway, wherever the browser's own
   fragment handling left it). `key` is fresh on every push, so each click
   scrolls. */
function ScrollToTop() {
  const { pathname, hash, key } = useLocation()
  useEffect(() => {
    if (hash) {
      const target = document.querySelector(hash)
      if (target) {
        /* Smooth only for a short trip. #capabilities now sits ~14,000px down
           a page that is 18,500px tall, and smooth-scrolling that far takes
           about 1.6 seconds of streaking content — long enough that the click
           reads as broken rather than as a scroll. Beyond two viewports, or
           whenever the reader has asked for less motion, jump.

           'instant', NOT 'auto': `auto` means "defer to CSS scroll-behavior",
           and site.css sets `html { scroll-behavior: smooth }` — so `auto`
           scrolled smoothly anyway and the branch did nothing. */
        const far = Math.abs(target.getBoundingClientRect().top) > window.innerHeight * 2
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        target.scrollIntoView({ behavior: far || still ? 'instant' : 'smooth', block: 'start' })

        /* SETTLE, then check the landing. On a fresh load of /features#workflow
           the section came to rest 53px high — under the sticky section rail —
           while the identical click from home landed it correctly. Two things
           move the ground after scrollIntoView has already committed to a
           number: the browser's own fragment scroll on a cold load, and the
           lazy images below the fold arriving and re-flowing the page.

           So re-measure once the scroll has settled and correct if it drifted.
           The correction reads scroll-margin-top off the element rather than
           hard-coding an offset, which keeps the one number that defines "clear
           of the sticky bars" in the stylesheet where the bars are. */
        const correct = () => {
          const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0
          const drift = target.getBoundingClientRect().top - margin
          if (Math.abs(drift) > 2) window.scrollBy({ top: drift, behavior: 'instant' })
        }
        /* Two passes. The first catches the cold-load fragment race; the second
           catches the lazy images and the FormatDeck panels finishing their
           layout, which on a fresh /features load still moved the landing by
           ~22px after the first correction had run. */
        const pass1 = setTimeout(correct, far || still ? 60 : 700)
        const pass2 = setTimeout(correct, 1400)
        const settled = () => {
          clearTimeout(pass1)
          clearTimeout(pass2)
        }
        /* MARK WHERE THEY LANDED. Scrolling to the right place is not the same
           as making it obvious you did — arriving from home into the middle of
           /features, the correct section looked identical to the four around
           it, and a jump (the `far` branch above) gives no travel to read
           either. `data-landed` fades an accent edge in and out once; see
           .section[data-landed] in site.css.

           Cleared on the way out, so returning to the same hash flashes again
           instead of staying lit. Skipped under prefers-reduced-motion, which
           is also the case where nothing moved to draw the eye. */
        if (!still) {
          target.setAttribute('data-landed', '')
          const flash = setTimeout(() => target.removeAttribute('data-landed'), 2000)
          return () => {
            settled()
            clearTimeout(flash)
            target.removeAttribute('data-landed')
          }
        }
        return settled
      }
    }
    window.scrollTo(0, 0)
  }, [pathname, hash, key])
  return null
}

export default function App() {
  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      <ScrollToTop />
      <Nav />
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />

          {/* Product */}
          <Route path="/features" element={<Features />} />
          <Route path="/live-scoring" element={<LiveScoring />} />
          <Route path="/reports" element={<Reports />} />

          {/* Solutions - four pages off one template */}
          <Route path="/solutions" element={<SolutionsHub />} />
          <Route path="/schools" element={<SolutionPage slug="schools" />} />
          <Route path="/colleges" element={<SolutionPage slug="colleges" />} />
          <Route path="/corporate" element={<SolutionPage slug="corporate" />} />
          <Route path="/tournament-organizers" element={<SolutionPage slug="tournament-organizers" />} />

          <Route path="/players" element={<Players />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="/contact" element={<Contact />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}
