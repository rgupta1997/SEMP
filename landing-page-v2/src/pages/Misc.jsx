import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon, { IconChip } from '../components/Icon'
import { Section, SHead, Shot, Split, Cells, Checks, Steps, Faq, Cta, TLink } from '../components/blocks'
import {
  playerPillars, recordItems, followItems, insightItems, parentItems,
  playerJourney, playerFaqs, plans, priceFactors, pricingFaqs, buyerQuestions,
  demoPromises, demoFields, orgTypes, contactCards,
} from '../data/pages'
import { SIGN_UP, SIGN_IN, CONTACT, API_URL } from '../data/site'

function Opener({ label, title, lead, icon }) {
  return (
    <div className="wrap hero" style={{ paddingBottom: 0 }}>
      <div style={{ maxWidth: '46rem' }}>
        <span className="eyebrow">
          {icon && <Icon name={icon} size={14} />}
          {label}
        </span>
        <h1 style={{ fontSize: 'var(--t-hero)', fontWeight: 800, margin: 'var(--sp-4) 0 var(--sp-5)', maxWidth: '22ch' }}>
          {title}
        </h1>
        {lead && <p style={{ fontSize: 'var(--t-lead)', color: 'var(--muted)', maxWidth: '58ch' }}>{lead}</p>}
      </div>
    </div>
  )
}

/* ---- For players ------------------------------------------------------- */
export function Players() {
  return (
    <>
      <Opener
        icon="medal"
        label="For players"
        title="One sporting record that follows you for life"
        lead="Every event, match, result and medal in one profile — from school meets to club tournaments, across every sport you play."
      />

      <Section alt>
        <Split
          shot="profile"
          eyebrow="Your sports profile"
          h3="A career file, not a pile of certificates"
          lead="Championships, matches, win-loss record and verified achievements, all computed from results officials actually recorded and locked."
          points={[
            'Verified records cannot be edited or hidden — not by you, not by the institution',
            'A public profile link you choose to turn on',
            'Sport-by-sport statistics as your record grows',
            'QR-verifiable certificates, downloadable years later',
          ]}
        />
      </Section>

      <Section>
        <SHead label="What you get" title="What a player gets out of EOS" />
        <Cells items={playerPillars} cols={3} />
      </Section>

      <Section alt>
        <SHead
          label="The record"
          title="It moves with you"
          lead="The record belongs to the player profile, so it carries across institutions, sports and seasons."
        />
        <div className="grid grid--2">
          <div className="cell">
            <span className="eyebrow">What the record holds</span>
            <div style={{ marginTop: 'var(--sp-5)' }}>
              <Checks items={recordItems} />
            </div>
          </div>
          <div className="cell">
            <span className="eyebrow">What you can see over time</span>
            <div style={{ marginTop: 'var(--sp-5)' }}>
              <Checks items={insightItems} />
            </div>
          </div>
        </div>
      </Section>

      <Section>
        <SHead label="Following" title="Family, friends and coaches watch the same event" />
        <Checks items={followItems} two />
      </Section>

      <Section alt>
        <SHead label="Parents and guardians" title="Know where and when, without chasing anyone" />
        <Cells items={parentItems.map(([t, c]) => [null, t, c])} cols={3} />
      </Section>

      <Section>
        <SHead label="Getting started" title="How a player joins" />
        <Steps items={playerJourney} />
      </Section>

      <Faq items={playerFaqs} title="Player FAQs" />

      <Cta
        title="Start the record with your next event"
        lead="Players never pay. Ask your school, college or club to run the event on EOS."
        note="The organizing institution holds the plan."
      />
    </>
  )
}

/* ---- Pricing ----------------------------------------------------------- */
export function Pricing() {
  return (
    <>
      <Opener
        icon="ruler"
        label="Pricing"
        title="Pricing that follows the size of your event"
        lead="Start free and set up a real event before any conversation. Participants never pay, on any plan — the organizing institution holds it."
      />

      <Section alt>
        <div className="cards cards--3">
          {plans.map((p) => (
            <div className={`card plan${p.featured ? ' plan--featured' : ''}`} key={p.name}>
              {p.featured && <span className="plan-flag">Most chosen</span>}
              <IconChip name={p.icon} />
              <div className="plan-name">{p.name}</div>
              <div className="plan-note">{p.note}</div>
              <p className="plan-who">{p.who}</p>
              <ul className="plan-lines">
                {p.lines.map((l) => (
                  <li key={l}>
                    <Icon name="check" size={15} />
                    {l}
                  </li>
                ))}
              </ul>
              {p.action === 'signup' ? (
                <a href={SIGN_UP} className="btn btn--primary">
                  {p.cta}
                </a>
              ) : (
                <Link to={p.action === 'demo' ? '/demo' : '/contact'} className={p.featured ? 'btn btn--primary' : 'btn btn--outline'}>
                  {p.cta}
                </Link>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SHead label="How it is quoted" title="What decides your price" />
        <Cells items={priceFactors} cols={2} />
      </Section>

      <Section alt>
        <SHead
          label="Before you commit"
          title="What we cover before you commit"
          lead="These are the questions institutions actually ask us. If any answer matters to your decision, raise it on the call and we will put it in writing."
          wide
        />
        <Checks items={buyerQuestions} two />
      </Section>

      <Faq items={pricingFaqs} title="Pricing questions" />

      <Cta title="Get a quote against your event" />
    </>
  )
}

/* ---- Book a demo ------------------------------------------------------- */
export function Demo() {
  const [form, setForm] = useState({})
  const [errors, setErrors] = useState({})
  const [done, setDone] = useState(false)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(null)

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((x) => ({ ...x, [k]: null }))
  }

  /* The form's field keys are not the table's column names, and the mapping is
     load-bearing: POST /api/demo-requests validates with a plain Zod object, so
     any key the schema does not know is STRIPPED SILENTLY and answered 201. A
     rename on either side loses that answer with no error anywhere.

     `org`     -> organization
     `orgType` -> role. The organisation TYPE (school / college / corporate /
                  organizer) is what qualifies the lead; the column is named
                  `role` because it predates this form.
     the rest  -> columns added in 20260908000000_demo_request_details.sql.

     Blank optional fields are dropped rather than sent as '': the schema maps ''
     to undefined for the two counts, but sending nothing at all keeps the row
     honestly null instead of storing empty strings for the text columns. */
  const payload = () => {
    const body = {
      name: form.name?.trim(),
      email: form.email?.trim(),
      phone: form.phone?.trim(),
      organization: form.org?.trim(),
      role: form.orgType,
      city: form.city?.trim(),
      event_date: form.date?.trim(),
      sport_count: form.sports,
      participant_count: form.participants,
      source: form.source?.trim(),
      message: form.message?.trim(),
    }
    for (const k of Object.keys(body)) if (body[k] === '' || body[k] == null) delete body[k]
    return body
  }

  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    demoFields.forEach((f) => {
      if (f.required && !String(form[f.key] || '').trim()) errs[f.key] = 'This field is required'
    })
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) errs.email = 'Enter a valid email address'
    if (!form.consent) errs.consent = 'Please agree before submitting'
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }

    // Lands in the demo_requests table; triaged by a platform super-admin at
    // /platform/demo-requests. The endpoint is mounted before the API's auth
    // gate, so no credentials are involved and no cookie is needed.
    if (!API_URL) {
      setFailed('This form is not configured to send yet. Please email us and we will pick it up.')
      return
    }
    setSending(true)
    setFailed(null)
    try {
      const res = await fetch(`${API_URL}/demo-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setDone(true)
    } catch {
      // NEVER confirm on failure. Showing "thanks" for a lead that was not
      // captured is the one outcome worse than showing an error - the visitor
      // stops chasing and nobody knows the enquiry existed.
      setFailed(`Something went wrong sending that. Please try again, or email ${CONTACT.email}.`)
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <>
        <Opener icon="check" label="Book a demo" title="Thanks — that's with us" />
        <Section alt>
          <div style={{ maxWidth: '52ch' }}>
            <h3 className="card-t">An EOS specialist will be in touch</h3>
            <p className="card-c">
              We review your requirement and come back within one working day to schedule the
              walkthrough against your event calendar. No account was created and nothing was
              installed.
            </p>
            <p style={{ marginTop: 'var(--sp-6)' }}>
              <TLink to="/">Back to the overview</TLink>
            </p>
          </div>
        </Section>
      </>
    )
  }

  return (
    <>
      <Opener
        icon="calendar"
        label="Book a demo"
        title="Book a 20-minute demo"
        lead="A walkthrough mapped to your event, not a generic tour."
      />

      <Section alt>
        <div className="grid grid--2">
          <div className="cell">
            <span className="eyebrow">What the call covers</span>
            <div style={{ marginTop: 'var(--sp-5)' }}>
              <Checks items={demoPromises} />
            </div>
            <p className="card-c" style={{ marginTop: 'var(--sp-8)' }}>
              In a hurry? You can{' '}
              <a href={SIGN_UP} className="tlink">
                start free
              </a>{' '}
              and set up a real event without talking to anyone.
            </p>
          </div>
          <div className="cell">
            <span className="eyebrow">Your details</span>
            <form className="form" style={{ marginTop: 'var(--sp-5)' }} onSubmit={submit} noValidate>
              {demoFields.map((f) => (
                <div
                  className={`field${errors[f.key] ? ' field--bad' : ''}${f.type === 'select' ? ' field--full' : ''}`}
                  key={f.key}
                >
                  <label htmlFor={`f-${f.key}`}>
                    {f.label}
                    {f.required && <span aria-hidden="true"> *</span>}
                  </label>
                  {f.type === 'select' ? (
                    <select id={`f-${f.key}`} value={form[f.key] || ''} onChange={set(f.key)} aria-invalid={!!errors[f.key]}>
                      <option value="">Select organization type</option>
                      {orgTypes.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`f-${f.key}`}
                      type={f.type}
                      placeholder={f.ph}
                      value={form[f.key] || ''}
                      onChange={set(f.key)}
                      aria-invalid={!!errors[f.key]}
                    />
                  )}
                  {errors[f.key] && <p className="err">{errors[f.key]}</p>}
                </div>
              ))}

              <div className="field field--full">
                <label htmlFor="f-message">Anything else about the event</label>
                <textarea
                  id="f-message"
                  placeholder="Sports, categories, venues, dates — whatever is useful"
                  value={form.message || ''}
                  onChange={set('message')}
                />
              </div>

              <div className="field field--full">
                <label className="consent" htmlFor="f-consent">
                  <input id="f-consent" type="checkbox" checked={!!form.consent} onChange={set('consent')} />
                  <span>I agree to be contacted about this enquiry.</span>
                </label>
                {errors.consent && <p className="err">{errors.consent}</p>}
              </div>

              <div className="field field--full">
                <button type="submit" className="btn btn--primary btn--lg" disabled={sending}>
                  {sending ? 'Sending…' : 'Schedule my 20-minute demo'}
                </button>
                {/* role="alert" so the failure is announced, not just coloured -
                    a visitor using a screen reader otherwise gets no signal that
                    the button did anything at all. */}
                {failed && (
                  <p className="err" role="alert" style={{ marginTop: 'var(--sp-3)' }}>
                    {failed}
                  </p>
                )}
              </div>
            </form>
          </div>
        </div>
      </Section>
    </>
  )
}

/* ---- Contact ----------------------------------------------------------- */
export function Contact() {
  const href = (i) => (i === 0 ? `mailto:${CONTACT.email}` : i === 1 ? CONTACT.phoneHref : SIGN_IN)
  return (
    <>
      <Opener
        icon="mail"
        label="Contact"
        title="Contact Sportagon"
        lead="Sales and proposals for institutions and organizers, and support for events already running on EOS."
      />

      <Section alt>
        <div className="cards cards--3">
          {contactCards.map(([icon, label, value, note], i) => (
            <a
              className="card card--link"
              key={label}
              href={href(i)}
              {...(i === 2 ? { target: '_blank', rel: 'noopener' } : {})}
            >
              <IconChip name={icon} />
              <span className="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>
                {label}
              </span>
              <div className="card-t">{value}</div>
              <p className="card-c">{note}</p>
            </a>
          ))}
        </div>
      </Section>

      <Section>
        <SHead
          label="Prefer a walkthrough"
          title="Most questions are faster on a 20-minute call"
          lead="Bring your event dates, sports and rough participant numbers and we will scope it on the call."
        />
        <TLink to="/demo">Book a demo</TLink>
      </Section>

      <Cta title="Or just start free and look around" />
    </>
  )
}

/* ---- 404 --------------------------------------------------------------- */
export function NotFound() {
  return (
    <>
      <Opener
        icon="compass"
        label="404"
        title="That page does not exist"
        lead="The link may be out of date. The overview is the best place to start."
      />
      <Section alt>
        <TLink to="/">Back to the overview</TLink>
      </Section>
    </>
  )
}
