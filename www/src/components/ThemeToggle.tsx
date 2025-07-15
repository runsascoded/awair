import { useState, useEffect } from 'react'
import { FaGithub } from 'react-icons/fa'
import { useTheme } from '../contexts/ThemeContext'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [isVisible, setIsVisible] = useState(false)
  const [lastScrollY, setLastScrollY] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY

      // Show when scrolling down, hide when scrolling up
      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setIsVisible(true)
      } else if (currentScrollY < lastScrollY) {
        setIsVisible(false)
      }

      setLastScrollY(currentScrollY)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [lastScrollY])

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark')
    else if (theme === 'dark') setTheme('system')
    else setTheme('light')
  }

  const getThemeIcon = () => {
    switch (theme) {
      case 'light': return '☀️'
      case 'dark': return '🌙'
      case 'system': return '💻'
    }
  }

  const getThemeLabel = () => {
    switch (theme) {
      case 'light': return 'Light'
      case 'dark': return 'Dark'
      case 'system': return 'System'
    }
  }

  return (
    <div className={`theme-controls ${isVisible ? 'visible' : ''}`}>
      <a
        href="https://github.com/runsascoded/awair"
        target="_blank"
        rel="noopener noreferrer"
        className="github-link"
        title="View on GitHub"
        aria-label="View project on GitHub"
      >
        <FaGithub />
      </a>
      <button
        className="theme-toggle"
        onClick={cycleTheme}
        title={`Theme: ${getThemeLabel()}`}
        aria-label={`Current theme: ${getThemeLabel()}. Click to cycle themes.`}
      >
        <span className="theme-icon">{getThemeIcon()}</span>
      </button>
    </div>
  )
}
