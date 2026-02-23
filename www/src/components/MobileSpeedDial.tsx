import { useState, useRef, useCallback, useEffect } from 'react'
import { FaGithub, FaSearch } from 'react-icons/fa'
import { MdBrightnessAuto, MdLightMode, MdDarkMode, MdExpandMore } from 'react-icons/md'
import { useHotkeysContext } from 'use-kbd'
import { useTheme } from '../contexts/ThemeContext'

const LONG_PRESS_DURATION = 400 // ms

/**
 * Mobile-only speed dial FAB that combines:
 * - Primary action: open omnibar (tap)
 * - Secondary actions revealed on long-press: GitHub, theme toggle
 *
 * Always visible in bottom-right corner on mobile.
 */
export function MobileSpeedDial() {
  const ctx = useHotkeysContext()
  const { theme, setTheme } = useTheme()
  const [isExpanded, setIsExpanded] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPress = useRef(false)
  const touchHandledRef = useRef(false)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)

  const cycleTheme = useCallback(() => {
    if (theme === 'light') setTheme('dark')
    else if (theme === 'dark') setTheme('system')
    else setTheme('light')
  }, [theme, setTheme])

  const getThemeIcon = () => {
    switch (theme) {
      case 'light': return <MdLightMode />
      case 'dark': return <MdDarkMode />
      case 'system': return <MdBrightnessAuto />
    }
  }

  const handlePrimaryTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault() // Prevent default touch behavior (e.g., scroll, pan)
    e.stopPropagation()
    didLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true
      setIsExpanded(prev => !prev)
    }, LONG_PRESS_DURATION)
  }, [])

  const handlePrimaryTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault() // Prevent click event from also firing
    e.stopPropagation()
    touchHandledRef.current = true // Mark that touch handled this interaction
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    // If it wasn't a long press...
    if (!didLongPress.current) {
      if (isExpanded) {
        // Collapse if expanded
        setIsExpanded(false)
      } else {
        // Open omnibar if not expanded
        ctx?.openOmnibar()
      }
    }
  }, [ctx, isExpanded])

  const handlePrimaryClick = useCallback((e: React.MouseEvent) => {
    // For mouse users (desktop fallback) - touch devices use touchend
    e.stopPropagation()
    // Skip if touch already handled this interaction
    if (touchHandledRef.current) {
      touchHandledRef.current = false
      return
    }
    if (isExpanded) {
      setIsExpanded(false)
    } else {
      ctx?.openOmnibar()
    }
  }, [ctx, isExpanded])

  // Attach non-passive touchstart listener (React's onTouchStart is passive by default)
  useEffect(() => {
    const button = primaryButtonRef.current
    if (!button) return
    button.addEventListener('touchstart', handlePrimaryTouchStart, { passive: false })
    return () => {
      button.removeEventListener('touchstart', handlePrimaryTouchStart)
    }
  }, [handlePrimaryTouchStart])

  // Close on click outside
  useEffect(() => {
    if (!isExpanded) return

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.mobile-speed-dial')) {
        setIsExpanded(false)
      }
    }

    document.addEventListener('click', handleClickOutside)
    document.addEventListener('touchend', handleClickOutside)
    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('touchend', handleClickOutside)
    }
  }, [isExpanded])

  // Only render on mobile/touch devices
  const isMobile = typeof window !== 'undefined' &&
    (window.matchMedia('(max-width: 640px)').matches || !window.matchMedia('(hover: hover)').matches)

  if (!isMobile) return null

  return (
    <div className={`mobile-speed-dial ${isExpanded ? 'expanded' : ''}`}>
      {/* Secondary actions - shown when expanded */}
      <div className="speed-dial-actions">
        <a
          href="https://github.com/runsascoded/awair"
          target="_blank"
          rel="noopener noreferrer"
          className="speed-dial-action"
          aria-label="View on GitHub"
          onClick={() => setIsExpanded(false)}
        >
          <FaGithub />
        </a>
        <button
          className="speed-dial-action"
          onClick={() => {
            cycleTheme()
            setIsExpanded(false)
          }}
          aria-label={`Theme: ${theme}`}
        >
          {getThemeIcon()}
        </button>
      </div>

      {/* Primary FAB */}
      <button
        ref={primaryButtonRef}
        className="speed-dial-primary"
        onTouchEnd={handlePrimaryTouchEnd}
        onTouchCancel={() => {
          if (longPressTimer.current) {
            clearTimeout(longPressTimer.current)
            longPressTimer.current = null
          }
        }}
        onClick={handlePrimaryClick}
        aria-label={isExpanded ? 'Close menu' : 'Search actions (hold for more)'}
      >
        {isExpanded ? <MdExpandMore /> : <FaSearch />}
        {/* Small dot indicator hinting at long-press */}
        {!isExpanded && <span className="long-press-hint" />}
      </button>
    </div>
  )
}
