import { Link } from 'react-router-dom'
import Icon, { IconChip } from '../components/Icon'
import {
  Section, SHead, Proof, Ticker, Checks, Faq, Cta, TLink,
} from '../components/blocks'
import CoverflowCarousel from '../components/CoverflowCarousel'
import ProductJourney from '../components/ProductJourney'
import FormatDeck from '../components/FormatDeck'
import FloatingSports from '../components/FloatingSports'
import ProblemGrid from '../components/ProblemGrid'
import {
  hero, problems, journey, journeyPhases, audiences,
  orgBenefits, partBenefits, faqs, structures,
} from '../data/home'
import { capabilities } from '../data/pages'
import { SIGN_UP, sports, shots } from '../data/site'

export default function Home() {
  return (
    <>
      {/* Hero. Copy left; the product screenshot is the faded background rather
          than a framed panel below the copy. Decorative here (alt="", the whole
          layer aria-hidden) because it is masked and scrimmed — the readable,
          captioned versions are in the "actual software" section below. */}
      <section className="hero">
        <div className="hero-bg" aria-hidden="true">
          <img src={shots.dashboard.src} alt="" width="1440" height="900" loading="eager" fetchpriority="high" decoding="async" />
        </div>
        <div className="wrap hero-in">
          <div className="hero-copy">
            <span className="eyebrow">{hero.eyebrow}</span>
            <h1>{hero.h1}</h1>
            <p className="lead">{hero.lead}</p>
            <div className="hero-cta">
              <a href={SIGN_UP} className="btn btn--lg btn--primary">
                Start free
                <Icon name="arrow-right" size={18} />
              </a>
              <Link to="/demo" className="btn btn--lg btn--outline">
                Book a 20-minute demo
              </Link>
            </div>
            <ul className="hero-note">
              {hero.note.map((n) => (
                <li key={n}>
                  <Icon name="check" size={14} />
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <Proof />
      <Ticker />

      <Section>
        <SHead
          label="The problem"
          title="Spreadsheets and WhatsApp can't run a tournament"
          lead="Four tools, one event, and no single record of what happened. Every stage below is where an event loses its data — and what replaces it."
          center
        />
        <ProblemGrid items={problems} />
        {/* The answer to these four is the capabilities section further down
            THIS page, so the link scrolls rather than navigating. */}
        <p style={{ marginTop: 'var(--sp-6)', textAlign: 'center' }}>
          <TLink to="/#capabilities">See what replaces all four</TLink>
        </p>
      </Section>

      {/* Every major screen in EOS, in the order an organiser meets them.

          This replaced a five-slide coverflow. Two reasons: a carousel put four
          of the five screens behind a gesture, and — the bigger problem — it
          implied the screens were interchangeable views of one product, when
          the actual claim is that each one feeds the next. See
          components/ProductJourney.jsx.

          NO LINK OUT OF THIS SECTION. /features#workflow states the same nine
          steps as a text list, which is strictly less than what is on screen
          here; per the link rule in README, a link whose destination adds
          nothing does not get made. */}
      <Section alt id="journey">
        <SHead
          label="Inside the product"
          title="From setting your institution up to a record a player keeps"
          lead="Sixteen real screens from EOS, in the order you meet them — the institution first, then an event run end to end inside it. Not a mockup, and nothing entered twice between the first screen and the last."
          wide
          center
        />
        <ProductJourney stages={journey} phases={journeyPhases} />
      </Section>

      {/* Capabilities as a content carousel. Twelve is where a carousel starts
          to earn its place — the hairline grid of all twelve is still the
          /features page, for anyone who wants to scan rather than browse. */}
      <Section id="capabilities">
        <SHead
          label="Capabilities"
          title="Everything a tournament needs, in one place"
          lead="Each one states what it does, the manual work it removes and what the organizer gets back."
          center
        />
        <CoverflowCarousel
          label="EOS capabilities"
          className="cf--caps"
          items={capabilities.map(([icon, t, does, removes, out]) => (
            <div className="cf-item" key={t}>
              <IconChip name={icon} />
              <div className="cf-item-t">{t}</div>
              <p className="cf-item-c">{does}</p>
              <dl className="cf-item-swap">
                <dt>Removes</dt>
                <dd>{removes}</dd>
                <dt>Outcome</dt>
                <dd className="is-out">{out}</dd>
              </dl>
            </div>
          ))}
          cardWidth="clamp(250px, 27vw, 340px)"
          cardHeight="308px"
          rotate={20}
          depth={0.34}
          perspective={3.4}
          gap={0.1}
          fade={0.14}
          showNavigation
          showPagination
        />
        {/* All twelve are already in the carousel, so this cannot promise
            "see all 12". What is genuinely elsewhere is the nine-step workflow
            they run in — that lives on /features. */}
        <p style={{ marginTop: 'var(--sp-6)', textAlign: 'center' }}>
          <TLink to="/features#workflow">See the nine-step workflow they run in</TLink>
        </p>
      </Section>

      <FloatingSports
        label="Sports"
        title="Fifteen sports configured out of the box"
        subtitle="Any sport that fits one of six competition structures can be run, whether or not it is on this list."
        footnote="Team games, individual events, timed events and board events. Sports are set up as competition structures rather than fixed templates."
        icons={sports}
      />

      <Section id="structures">
        <SHead
          label="Competition structures"
          title="If your event runs it, EOS can run it"
          lead="Open the one closest to your event: how it is drawn, and exactly what you would configure."
          wide
          center
        />
        <FormatDeck items={structures} />
      </Section>

      <Section alt>
        <SHead
          label="Solutions"
          title="Built for the way your organization runs sport"
          center
        />
        <CoverflowCarousel
          label="Who EOS is built for"
          items={audiences.map(([icon, t, c, link, href]) => (
            <Link to={href} className="cf-item" key={t}>
              <IconChip name={icon} />
              <div className="cf-item-t">{t}</div>
              <p className="cf-item-c">{c}</p>
              <span className="tlink">
                {link}
                <Icon name="arrow-right" size={16} />
              </span>
            </Link>
          ))}
          cardWidth="clamp(250px, 28vw, 360px)"
          cardHeight="286px"
          rotate={20}
          depth={0.34}
          perspective={3.4}
          gap={0.1}
          fade={0.14}
          showNavigation
          showPagination
        />
      </Section>

      <Section>
        <SHead
          label="One record, two audiences"
          title="Players participate. Organizations organize. EOS connects the two."
          wide
          center
        />
        {/* TITLES ONLY HERE. `orgBenefits` carries a line of detail per item,
            but this section is a scan — two audiences, seven lines each, read
            in a glance — so home takes just the titles and the detail lives on
            /solutions, where the reader has actually asked for it.
            One source of truth: the same array, sliced two ways. */}
        <div className="grid grid--2 is-mid">
          <div className="cell">
            <IconChip name="bank" />
            <div className="cell-t">For the organization</div>
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <Checks items={orgBenefits.map(([t]) => t)} />
            </div>
          </div>
          <div className="cell">
            <IconChip name="users" />
            <div className="cell-t">For the participant</div>
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <Checks items={partBenefits} />
            </div>
          </div>
        </div>
        {/* Two links, organization first. The page is sold to institutions, so
            the buyer's own path out of this section cannot be the second-class
            one — and each label names what is actually at the far end: the
            Solutions hub opens on the four kinds of organization, /players on
            the participant's side. */}
        <div className="tlink-row">
          <TLink to="/solutions">See how EOS fits your kind of organization</TLink>
          <TLink to="/players">What a player gets out of EOS</TLink>
        </div>
      </Section>

      <Faq items={faqs} />

      <Cta title="Your next tournament deserves a better operating system" />
    </>
  )
}
