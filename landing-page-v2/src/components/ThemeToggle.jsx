import Icon from './Icon'
import { useTheme } from '../lib/theme'

/* The light/dark switch. Lives in the nav bar at every width, including phone:
   the drawer was tried and the control ended up below Sign in, three
   interactions and a scroll deep, for something that should cost one tap. */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`

  return (
    <button
      type="button"
      className="nav-theme"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={theme === 'dark'}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  )
}
