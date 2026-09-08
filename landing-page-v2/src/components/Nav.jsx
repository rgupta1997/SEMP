import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import Icon from './Icon'
import Brand from './Brand'
import ThemeToggle from './ThemeToggle'
import { nav, SIGN_IN, SIGN_UP } from '../data/site'

function Dropdown({ label, items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const { pathname } = useLocation()
  const active = items.some(([, href]) => href === pathname)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      className="nav-group"
      ref={ref}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        className="nav-link"
        data-active={active}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <Icon name="chevron-down" size={14} className={open ? 'flip' : undefined} />
      </button>
      {open && (
        <div className="nav-menu">
          {/* Label and icon only. Each item used to carry a line of description
              underneath, which tripled the menu's height and explained pages
              whose names already say what they are. */}
          {items.map(([t, href, icon]) => (
            <Link key={t} to={href} onClick={() => setOpen(false)}>
              <span className="mi-icon">
                <Icon name={icon} size={17} />
              </span>
              <span className="mi-t">{t}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Nav() {
  const [drawer, setDrawer] = useState(false)
  const { pathname } = useLocation()

  // Block body, not a concise arrow: a concise arrow hands setDrawer's return
  // value to React, which then calls it as the effect's cleanup function.
  useEffect(() => {
    setDrawer(false)
  }, [pathname])

  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawer])

  return (
    <header className="nav">
      <div className="nav-in">
        <Brand />

        <nav className="nav-links" aria-label="Main">
          <Dropdown label="Product" items={nav.product} />
          <Dropdown label="Solutions" items={nav.solutions} />
          {nav.flat.map(([t, href]) => (
            <NavLink key={t} to={href} className="nav-link" data-active={pathname === href}>
              {t}
            </NavLink>
          ))}
        </nav>

        <div className="nav-actions">
          <ThemeToggle />
          <a href={SIGN_IN} className="nav-signin">
            Sign in
          </a>
          <a href={SIGN_UP} className="btn btn--primary nav-cta">
            Start free
          </a>
          <button
            type="button"
            className="nav-burger"
            aria-label={drawer ? 'Close menu' : 'Open menu'}
            aria-expanded={drawer}
            onClick={() => setDrawer((v) => !v)}
          >
            <Icon name={drawer ? 'x' : 'menu'} size={20} />
          </button>
        </div>
      </div>

      {drawer && (
        <div className="nav-drawer">
          <span className="nav-drawer-h">Product</span>
          {nav.product.map(([t, href]) => (
            <Link key={t} to={href}>
              {t}
            </Link>
          ))}
          <span className="nav-drawer-h">Solutions</span>
          {nav.solutions.map(([t, href]) => (
            <Link key={t} to={href}>
              {t}
            </Link>
          ))}
          <span className="nav-drawer-h">More</span>
          {nav.flat.map(([t, href]) => (
            <Link key={t} to={href}>
              {t}
            </Link>
          ))}
          <Link to="/demo">Book a demo</Link>
          <a href={SIGN_IN}>
            Sign in
          </a>
          <a href={SIGN_UP} className="btn btn--primary btn--lg">
            Start free
          </a>
        </div>
      )}
    </header>
  )
}
