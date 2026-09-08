import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon, { IconChip } from './Icon'
import { SIGN_UP, shots, facts, ticker } from '../data/site'

/* Shared page blocks. Every page is assembled from these, which is what keeps
   thirteen pages reading as one site. */

export function Section({ children, alt, id }) {
  return (
    <section className={alt ? 'section section--alt' : 'section'} id={id}>
      <div className="wrap">{children}</div>
    </section>
  )
}

export function SHead({ label, title, lead, wide, center }) {
  return (
    <div className={`s-head${wide ? ' is-wide' : ''}${center ? ' is-center' : ''}`}>
      {label && <span className="eyebrow">{label}</span>}
      <h2>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
    </div>
  )
}

/* A product screenshot in a browser frame. The frame matters: without it a
   flat PNG reads as an illustration, and the whole point of these is that
   they are the real thing. */
export function Shot({ name, className = '', priority = false, lazy = false }) {
  const s = shots[name]
  if (!s) return null
  return (
    <figure className={`shot-frame ${className}`.trim()}>
      <div className="shot-bar">
        <span className="shot-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="shot-url">{s.url}</span>
      </div>
      {/* EAGER BY DEFAULT. These screenshots ARE the argument the page makes,
          and lazy-loading the ones a solution page shows meant a visitor
          scrolling at any speed met empty frames where the proof should be.
          `priority` additionally raises fetch priority so a shot is not queued
          behind the ones below it.

          `lazy` is for the journey section only, where fourteen screens stack
          into one very tall block: there, everything past the first few is a
          scroll away rather than a paint away, and loading all fourteen up
          front would spend the page's whole budget below the fold.

          `fetchpriority` is lowercase on purpose: React 18 does not recognise
          the camelCase prop (that arrived in React 19) and drops it with a
          console warning. */}
      <img
        src={s.src}
        alt={s.alt}
        width="1440"
        height="900"
        loading={lazy ? 'lazy' : 'eager'}
        fetchpriority={priority ? 'high' : undefined}
        decoding="async"
      />
    </figure>
  )
}

/* Sportagon's track record. The single most persuasive thing on the page, so
   it sits immediately under the hero. */
export function Proof() {
  return (
    <section className="proof">
      <div className="wrap proof-in">
        {facts.map(([n, t]) => (
          <div key={t}>
            <div className="proof-n">{n}</div>
            <div className="proof-t">{t}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* Example activity, doubled so the marquee wraps seamlessly. Labelled as
   illustrative in the aria description rather than implying a live feed. */
export function Ticker() {
  const items = [...ticker, ...ticker]
  const LABEL = { live: 'Live', res: 'Result', new: 'New' }
  return (
    <div className="ticker" aria-label="Examples of the activity EOS carries during an event">
      <div className="ticker-track">
        {items.map(([kind, text], i) => (
          <span className="tick" key={`${i}-${text}`} aria-hidden={i >= ticker.length}>
            <b className={`t-${kind}`}>{LABEL[kind]}</b>
            {text}
          </span>
        ))}
      </div>
    </div>
  )
}

/* Hairline grid. `items` are [icon, title, copy] or the five-part capability
   tuple [icon, title, does, removes, outcome]. `icon` is an Icon name, not an
   emoji — see components/Icon.jsx for why. */
export function Cells({ items, cols = 3 }) {
  return (
    <div className={`grid grid--${cols}`}>
      {items.map((it) => {
        const [icon, t, c, removes, out] = it
        return (
          <div className="cell" key={t}>
            {icon && <IconChip name={icon} />}
            <div className="cell-t">{t}</div>
            {c && <p className="cell-c">{c}</p>}
            {removes && (
              <dl className="cell-swap">
                <dt>Removes</dt>
                <dd>{removes}</dd>
                <dt>Outcome</dt>
                <dd className="is-out">{out}</dd>
              </dl>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* A ticked list. An item is either a string, or a [title, detail] pair when the
   line needs to say what the reader actually gets — the organization side of
   the home page is a buyer's list, and "Consolidated reporting" on its own
   asks the reader to imagine the benefit for us. */
export function Checks({ items, two }) {
  return (
    <ul className={`checks${two ? ' checks--2' : ''}`}>
      {items.map((i) => {
        const [t, detail] = Array.isArray(i) ? i : [i, null]
        return (
          <li key={t}>
            <Icon name="check" size={15} />
            {detail ? (
              <span className="checks-b">
                <strong>{t}</strong>
                <span>{detail}</span>
              </span>
            ) : (
              t
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* Numbered sequence. Only where order carries information. */
export function Steps({ items }) {
  return (
    <ol className="steps">
      {items.map((it, i) => {
        const [t, c] = Array.isArray(it) ? it : [it, null]
        return (
          <li className="step" key={t}>
            <span className="step-n">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <div className="step-t">{t}</div>
              {c && <p className="step-c">{c}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/* Copy beside a real screenshot. The workhorse of the product sections. */
export function Split({ shot, eyebrow, h3, lead, points, flipped, to }) {
  return (
    <div className={`split${flipped ? ' is-flipped' : ''}`}>
      <div className="split-copy">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h3>{h3}</h3>
        {lead && <p className="lead">{lead}</p>}
        {points && <Checks items={points} />}
        {to && (
          <p style={{ marginTop: 'var(--sp-6)' }}>
            <Link to={to} className="tlink">
              Read more
              <Icon name="arrow-right" size={16} />
            </Link>
          </p>
        )}
      </div>
      <Shot name={shot} />
    </div>
  )
}

export function Faq({ items, id, label = 'Questions', title = 'Frequently asked questions' }) {
  const [open, setOpen] = useState(0)
  return (
    <Section alt id={id}>
      <SHead label={label} title={title} />
      <div className="faq-list">
        {items.map(([q, a], i) => {
          const isOpen = open === i
          return (
            <div className="faq" key={q}>
              <h3>
                <button
                  type="button"
                  className="faq-q"
                  aria-expanded={isOpen}
                  aria-controls={`fa-${i}`}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                >
                  <span>{q}</span>
                  <Icon name={isOpen ? 'minus' : 'plus'} size={18} />
                </button>
              </h3>
              {isOpen && (
                <p className="faq-a" id={`fa-${i}`}>
                  {a}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

export function Cta({
  title,
  lead = 'Set up your first event yourself, with no call and no card.',
  note = 'Participants never pay, on any plan.',
}) {
  return (
    <section className="cta">
      <div className="wrap">
        {/* Two halves, not one centred column. Centred, the whole band was a
            stack five items tall: a 44ch measure is right for the sentence but
            it also caught the two buttons and broke them onto separate lines,
            so a one-line ask took over 400px of page. Copy left, actions right,
            and it collapses back to the centred stack on a phone. */}
        <div className="cta-in">
          <div className="cta-say">
            <h2>{title}</h2>
            <p>{lead}</p>
          </div>
          <div className="cta-do">
            <div className="cta-actions">
              <a href={SIGN_UP} className="btn btn--lg btn--onDark">
                Start free
                <Icon name="arrow-right" size={18} />
              </a>
              <Link to="/demo" className="btn btn--lg btn--ghostDark">
                Book a 20-minute demo
              </Link>
            </div>
            {note && <p className="cta-note">{note}</p>}
          </div>
        </div>
      </div>
    </section>
  )
}

export function TLink({ to, children }) {
  return (
    <Link to={to} className="tlink">
      {children}
      <Icon name="arrow-right" size={16} />
    </Link>
  )
}
