import { Link, Navigate } from 'react-router-dom'
import Icon, { IconChip } from '../components/Icon'
import { Section, SHead, Shot, Proof, Cells, Checks, Steps, Faq, Cta, TLink } from '../components/blocks'
import { solutions, solutionOrder } from '../data/solutions'
import { orgBenefits } from '../data/home'
import { SIGN_UP } from '../data/site'

export function SolutionsHub() {
  return (
    <>
      <div className="wrap hero" style={{ paddingBottom: 0 }}>
        <div style={{ maxWidth: '46rem' }}>
          <span className="eyebrow">Solutions</span>
          <h1 style={{ fontSize: 'var(--t-hero)', fontWeight: 800, margin: 'var(--sp-4) 0 var(--sp-5)', maxWidth: '22ch' }}>
            Solutions for every kind of sports organizer
          </h1>
          <p style={{ fontSize: 'var(--t-lead)', color: 'var(--muted)', maxWidth: '58ch' }}>
            The same system, configured for how your organization actually runs sport. Pick the one
            closest to you.
          </p>
        </div>
      </div>

      <Section alt>
        <div className="cards cards--2">
          {solutionOrder.map((key) => {
            const s = solutions[key]
            return (
              <Link to={`/${s.slug}`} className="card card--link" key={key}>
                <IconChip name={s.icon} />
                <span className="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>
                  {s.eyebrow}
                </span>
                <div className="card-t">{s.t}</div>
                <p className="card-c">{s.sub}</p>
                <span className="tlink">
                  {s.t}
                  <Icon name="arrow-right" size={16} />
                </span>
              </Link>
            )
          })}
        </div>
      </Section>

      <Proof />

      {/* The detail behind home's organization list. Home shows the seven
          titles so the two-audience section stays a scan; a reader who followed
          "See how EOS fits your kind of organization" has asked for more than a
          title, so the same seven arrive here with what each one actually
          means. Same array, so the two can never drift apart. */}
      <Section>
        <SHead
          label="What your organization gets"
          title="Seven things that change the week you switch"
          lead="The same seven listed on the home page, with what each one means in practice."
          wide
        />
        <Checks items={orgBenefits} two />
      </Section>

      <Section alt>
        <SHead
          label="Also"
          title="Players and families get their own side of the event"
          lead="Participants never pay, on any plan. The organizing institution holds the plan."
        />
        <TLink to="/players">What a player gets out of EOS</TLink>
      </Section>

      <Cta title="See EOS on your own event" />
    </>
  )
}

/* One template, four pages. */
export function SolutionPage({ slug }) {
  const s = solutions[slug]
  if (!s) return <Navigate to="/solutions" replace />

  return (
    <>
      <div className="wrap hero" style={{ paddingBottom: 0 }}>
        <div style={{ maxWidth: '46rem' }}>
          <span className="eyebrow">
            <Icon name={s.icon} size={14} />
            {s.eyebrow}
          </span>
          <h1 style={{ fontSize: 'var(--t-hero)', fontWeight: 800, margin: 'var(--sp-4) 0 var(--sp-5)', maxWidth: '22ch' }}>
            {s.h1}
          </h1>
          <p style={{ fontSize: 'var(--t-lead)', color: 'var(--muted)', maxWidth: '58ch' }}>{s.sub}</p>
          <div className="hero-cta" style={{ justifyContent: 'flex-start' }}>
            <a href={SIGN_UP} className="btn btn--primary">
              Start free
              <Icon name="arrow-right" size={17} />
            </a>
            <Link to="/demo" className="btn btn--outline">
              Book a demo
            </Link>
          </div>
        </div>
        <Shot name={s.shot} />
      </div>

      <Section alt>
        <div className="grid grid--2">
          <div className="cell">
            <span className="eyebrow">Common operational challenges</span>
            <ul className="checks" style={{ marginTop: 'var(--sp-5)' }}>
              {s.challenges.map((c) => (
                <li key={c} style={{ color: 'var(--muted)' }}>
                  <span aria-hidden="true" style={{ flex: 'none', marginTop: 1 }}>
                    ✗
                  </span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="cell">
            <span className="eyebrow">How EOS addresses them</span>
            <div style={{ marginTop: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-5)' }}>
              {s.answers.map(([t, c]) => (
                <div key={t}>
                  <div className="cell-t">{t}</div>
                  <p className="cell-c">{c}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section>
        <SHead label="Capabilities used" title="What you get on this event" />
        <Checks items={s.caps} two />
      </Section>

      <Section alt>
        <SHead label="The sequence" title={s.journeyTitle} />
        <Steps items={s.journey} />
      </Section>

      <Section>
        <div className="grid grid--2">
          <div className="cell">
            <span className="eyebrow">What changes</span>
            <div style={{ marginTop: 'var(--sp-5)' }}>
              <Checks items={s.benefits} />
            </div>
          </div>
          <div className="cell">
            <span className="eyebrow">What you can report</span>
            <div style={{ marginTop: 'var(--sp-5)' }}>
              <Checks items={s.reports} />
            </div>
          </div>
        </div>
      </Section>

      <Faq items={s.faqs} title="FAQs" />

      <Cta title={s.ctaTitle} />
    </>
  )
}
