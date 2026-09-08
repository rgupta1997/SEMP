import { Link } from 'react-router-dom'

/* The wordmark, theme-aware.
   Two <img> toggled by CSS rather than one src swapped in JS: the correct logo
   then paints on the first frame, with no flash of the wrong one and no
   dependence on a media-query listener. The blue mark was unreadable on the
   dark ground, which is what this fixes. */
export default function Brand({ to = '/' }) {
  return (
    <Link to={to} className="brand" aria-label="Sportagon EOS home">
      <img className="brand-light" src="/sportagon-logo-blue.png" alt="Sportagon" />
      <img className="brand-dark" src="/sportagon-logo-white.png" alt="" aria-hidden="true" />
      <span className="brand-badge">EOS</span>
    </Link>
  )
}
