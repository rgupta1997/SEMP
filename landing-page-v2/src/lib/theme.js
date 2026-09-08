import { useCallback, useEffect, useState } from 'react'

/* Theme state for the marketing site.
   =============================================================================
   Three states, matching what site.css already styles:

     stored 'dark'  -> :root[data-theme='dark']
     stored 'light' -> :root[data-theme='light']
     nothing stored -> no attribute, so @media (prefers-color-scheme) decides

   The third state is the default and it matters: a visitor who has never
   touched the switch should get the theme their OS asked for, and should keep
   following it if they change it later. Only an explicit tap pins the site.

   index.html applies the stored value before first paint; this hook owns it
   from there. Keep KEY in sync with the inline script in index.html.
   ============================================================================= */

const KEY = 'sportagon_theme'
const DARK = '(prefers-color-scheme: dark)'

function stored() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function systemTheme() {
  return window.matchMedia?.(DARK).matches ? 'dark' : 'light'
}

export function useTheme() {
  // `pref` is the pin (or null for "follow the OS"); `theme` is what's on screen.
  const [pref, setPref] = useState(stored)
  const [system, setSystem] = useState(systemTheme)

  // Only worth listening while unpinned, but the listener is cheap and keeping
  // it unconditional means unpinning later needs no re-subscribe.
  useEffect(() => {
    const mq = window.matchMedia?.(DARK)
    if (!mq) return
    const onChange = (e) => setSystem(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (pref) root.setAttribute('data-theme', pref)
    else root.removeAttribute('data-theme')
    try {
      if (pref) localStorage.setItem(KEY, pref)
      else localStorage.removeItem(KEY)
    } catch {
      /* private mode; the attribute is still set, it just won't survive a reload */
    }
  }, [pref])

  const theme = pref ?? system
  const toggle = useCallback(() => {
    setPref((p) => ((p ?? systemTheme()) === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, pref, setPref, toggle }
}
