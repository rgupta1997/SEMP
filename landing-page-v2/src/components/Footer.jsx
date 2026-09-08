import { Link } from 'react-router-dom'
import Icon from './Icon'
import Brand from './Brand'
import { nav, CONTACT, SIGN_IN, SIGN_UP } from '../data/site'

export default function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-in">
          <div>
            <Brand />
            <p className="foot-blurb">
              End-to-end multi-sport tournament management: registrations, teams, fixtures, live
              scoring, standings, certificates and reports in one system.
            </p>
            <div className="foot-social">
              <a href={CONTACT.instagram} aria-label="Sportagon on Instagram" target="_blank" rel="noopener">
                <Icon name="instagram" size={19} />
              </a>
              <a href={CONTACT.linkedin} aria-label="Sportagon on LinkedIn" target="_blank" rel="noopener">
                <Icon name="linkedin" size={19} />
              </a>
              <a href={CONTACT.whatsapp} aria-label="Sportagon on WhatsApp" target="_blank" rel="noopener">
                <Icon name="whatsapp" size={19} />
              </a>
            </div>
          </div>

          <nav className="foot-cols" aria-label="Footer">
            <div>
              <h4>Product</h4>
              <ul>
                {nav.product.map(([t, href]) => (
                  <li key={t}>
                    <Link to={href}>{t}</Link>
                  </li>
                ))}
                <li>
                  <Link to="/pricing">Pricing</Link>
                </li>
              </ul>
            </div>
            <div>
              <h4>Solutions</h4>
              <ul>
                {nav.solutions.map(([t, href]) => (
                  <li key={t}>
                    <Link to={href}>{t}</Link>
                  </li>
                ))}
                <li>
                  <Link to="/solutions">All solutions</Link>
                </li>
              </ul>
            </div>
            <div>
              <h4>Get started</h4>
              <ul>
                <li>
                  <a href={SIGN_UP}>
                    Start free
                  </a>
                </li>
                <li>
                  <Link to="/demo">Book a demo</Link>
                </li>
                <li>
                  <Link to="/players">For players</Link>
                </li>
                <li>
                  <Link to="/contact">Contact</Link>
                </li>
                <li>
                  <a href={SIGN_IN}>
                    Sign in
                  </a>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <div className="foot-legal">
          <p>© {new Date().getFullYear()} Sportagon. All rights reserved.</p>
          <p>
            Sales and proposals, {CONTACT.hours} ·{' '}
            <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
          </p>
        </div>
      </div>
    </footer>
  )
}
