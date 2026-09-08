import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import FormatDeck from '../components/FormatDeck'
import FloatingSports from '../components/FloatingSports'
import PageNav from '../components/PageNav'
import { Section, SHead, Cells, Steps, Split, Faq, Cta } from '../components/blocks'
import {
  capabilities, workflow, scoringPoints, matchStates,
  reportGroups, summaryBlocks, reportFlow,
} from '../data/pages'
import { structures, faqs } from '../data/home'
import { SIGN_UP, sports } from '../data/site'

function Opener({ label, title, lead, note }) {
  return (
    <div className="wrap hero" style={{ paddingBottom: 0 }}>
      <div style={{ maxWidth: '46rem' }}>
        <span className="eyebrow">{label}</span>
        <h1 style={{ fontSize: 'var(--t-hero)', fontWeight: 800, margin: 'var(--sp-4) 0 var(--sp-5)', maxWidth: '22ch' }}>
          {title}
        </h1>
        <p className="lead" style={{ fontSize: 'var(--t-lead)', color: 'var(--muted)', maxWidth: '58ch' }}>
          {lead}
        </p>
        <div className="hero-cta" style={{ justifyContent: 'flex-start' }}>
          <a href={SIGN_UP} className="btn btn--primary">
            Start free
            <Icon name="arrow-right" size={17} />
          </a>
          <Link to="/demo" className="btn btn--outline">
            Book a demo
          </Link>
        </div>
        {note && (
          <ul className="hero-note" style={{ justifyContent: 'flex-start' }}>
            {note.map((n) => (
              <li key={n}>
                <Icon name="check" size={14} />
                {n}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ---- Features ---------------------------------------------------------- */
/* THE REFERENCE PAGE. It carries everything — the twelve, the workflow, the six
   structures, the fifteen sports — because someone checking whether EOS covers
   their event wants it all in one scannable place, not spread over five pages.

   WHAT THAT COSTS, AND WHAT PAYS FOR IT.
   Home links straight to /features#workflow. The scroll lands correctly, but it
   used to drop the reader into the middle of a long page with no way to tell
   what they had skipped past or what was still below — the section they asked
   for looked like an arbitrary slice of something else.

   Two things fix that, and neither of them is deleting content:
     - <PageNav> is a sticky rail of this page's sections, scrollspy-lit, so the
       arrival point is legible as "section 2 of 5" rather than "somewhere".
     - ScrollToTop marks the landed section `data-landed`, which fades an accent
       edge in and out once (see .section[data-landed] in site.css), so the eye
       locks onto the right heading instead of hunting for it. */
const FEATURE_SECTIONS = [
  ['capabilities', 'Capabilities'],
  ['workflow', 'The workflow'],
  ['structures', 'Structures'],
  ['sports', 'Sports'],
  ['faq', 'FAQs'],
]

export function Features() {
  return (
    <>
      <Opener
        label="Features"
        title="Every stage of a tournament, handled in one system"
        lead="Twelve capabilities, one configuration. Each states what it does, the manual work it removes and what the organizer gets back."
        note={['No credit card required', 'Participants never pay']}
      />

      <PageNav items={FEATURE_SECTIONS} />

      <Section id="capabilities" alt>
        {/* "Capabilities" IS the heading. It used to be the small eyebrow over a
            title reading "The twelve", which made the section's actual subject
            the quiet half and gave the loud half to a count the grid already
            makes obvious. */}
        <SHead title="Capabilities" />
        <Cells items={capabilities} cols={3} />
      </Section>

      <Section id="workflow">
        <SHead
          label="The workflow"
          title="One configuration, every screen reads from it"
          lead="The order matters — each step consumes what the one before it produced, which is why the same data never needs entering twice."
          wide
        />
        <Steps items={workflow} />
      </Section>

      <Section id="structures" alt>
        <SHead
          label="Competition structures"
          title="Six structures cover the field"
          lead="Sport-specific rules — a super-over tie-break, home-and-away, a direct final — are overrides on these six rather than separate formats."
          wide
        />
        <FormatDeck items={structures} />
      </Section>

      {/* THE SAME PANEL AS HOME, not a second treatment of the same fifteen
          names. This used to be a plain labelled grid on the argument that a
          reference page wants scanning rather than drifting glyphs — but every
          tile in the floating panel is labelled too, so it scans just as well
          and the reader is not asked to recognise the sports section twice in
          two different shapes. One component, one source of truth. */}
      <FloatingSports
        id="sports"
        label="Sports"
        title="Fifteen sports configured out of the box"
        subtitle="Any sport that fits one of six competition structures can be run, whether or not it is on this list."
        footnote="Team games, individual events, timed events and board events. Sports are set up as competition structures rather than fixed templates."
        icons={sports}
      />

      <Faq items={faqs} id="faq" />
      <Cta title="See EOS on your own event" />
    </>
  )
}

/* ---- Live scoring ------------------------------------------------------ */
export function LiveScoring() {
  return (
    <>
      <Opener
        label="Live scoring"
        title="One score entry updates results, standings and records"
        lead="Officials record scores at the venue as matches finish. Results, points tables, brackets and participant records all read that same entry."
      />

      <Section alt>
        <SHead label="What it covers" title="What live scoring covers" />
        <Cells items={scoringPoints} cols={3} />
      </Section>

      <Section>
        <Split
          shot="event"
          eyebrow="The event workspace"
          h3="Officials, schedule and standings in one place"
          lead="An event carries its own organising team, participants, schedule, results and standings — scoped so each official sees only what they operate."
          points={[
            'Fixtures with venue, slot and assigned official',
            'Results entered at the venue, on any device',
            'Standings computed from completed fixtures only',
            'A public link you can share without a login',
          ]}
        />
      </Section>

      <Section alt>
        <SHead
          label="Match states"
          title="Four states, visible to everyone who needs them"
          lead="Organizers see all four at a glance. Participants see live and completed matches without asking an organizer."
          wide
        />
        <Cells items={matchStates.map(([t, c]) => [null, t, c])} cols={2} />
      </Section>

      <Section>
        <SHead
          label="Honest limits"
          title="What EOS does not claim"
          lead="Scoring structure follows the sport and the format configured for it. EOS does not claim automated scoring for every sport — an official records the result, and the system carries it everywhere it needs to go."
          wide
        />
      </Section>

      <Cta title="See scoring on your sports" />
    </>
  )
}

/* ---- Reports ----------------------------------------------------------- */
export function Reports() {
  return (
    <>
      <Opener
        label="Reports & analytics"
        title="Turn every tournament into measurable sports data"
        lead="Registration, participation, competition and closure reporting, built from the event record rather than assembled after it."
      />

      <Section alt>
        <Split
          shot="reports"
          eyebrow="Participation reporting"
          h3="Derived from locked results only"
          lead="Unique participants, events, matches played and medals — with participation broken down by sport and by programme, and a six-season trend so this year has something to sit against."
          points={[
            'Participation, performance, peer benchmark and impact views',
            'Season selector, so each year is reportable on its own',
            'Locked results only, so the numbers cannot drift',
            'Exportable for the board, the file and the funder',
          ]}
        />
      </Section>

      <Section>
        <SHead label="Report groups" title="Four report groups" />
        <Cells
          items={reportGroups.map(([em, t, c]) => [em, t, c])}
          cols={2}
        />
      </Section>

      <Section alt>
        <SHead label="Event summary" title="What an event summary contains" />
        <Cells items={summaryBlocks.map(([t, c]) => [null, t, c])} cols={3} />
      </Section>

      <Section>
        <SHead
          label="How it works"
          title="How reporting works"
          lead="Nothing is compiled at the end, because nothing was ever entered twice."
        />
        <Steps items={reportFlow} />
      </Section>

      <Cta title="See the reports on your own event" />
    </>
  )
}
