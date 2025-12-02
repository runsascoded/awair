import React, { useState, useEffect, type ReactNode } from 'react'

interface HoverableToggleButtonProps {
  value: boolean
  onChange: (value: boolean) => void
  onDisplayChange?: (displayValue: boolean) => void
  activeLabel?: string
  inactiveLabel?: string
  children: ReactNode
  className?: string
  title?: string
}

/**
 * A toggle button that shows a hover preview of the toggled state.
 *
 * Behavior:
 * - Hover shows preview of toggled state with reduced opacity
 * - Click toggles the actual state
 * - After clicking while hovered, preview is disabled until mouseout/mousein
 *
 * Visual states:
 * - Not active, not hovered: default styling
 * - Active, not hovered: 'active' class (100% opacity)
 * - Not active, hovered: 'active preview' classes (60% opacity)
 * - Active, hovered (before click): no classes (preview showing inactive)
 * - Active, hovered (after click): 'active' class (no preview, shows actual state)
 */
export function HoverableToggleButton({
  value,
  onChange,
  onDisplayChange,
  children,
  className = '',
  title
}: HoverableToggleButtonProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [clickedWhileHovered, setClickedWhileHovered] = useState(false)

  // Determine display state
  const shouldShowPreview = isHovered && !clickedWhileHovered
  const displayValue = shouldShowPreview ? !value : value

  // Notify parent when display value changes (for plot preview)
  useEffect(() => {
    onDisplayChange?.(displayValue)
  }, [displayValue, onDisplayChange])

  const handleClick = () => {
    onChange(!value)
    if (isHovered) {
      setClickedWhileHovered(true)
    }
  }

  const handleMouseEnter = () => {
    setIsHovered(true)
    // Don't reset clickedWhileHovered here - it persists until mouseout
  }

  const handleMouseLeave = () => {
    setIsHovered(false)
    setClickedWhileHovered(false)
  }

  // Build class names
  const classes = [
    className,
    displayValue ? 'active' : '',
    shouldShowPreview ? 'preview' : ''
  ].filter(Boolean).join(' ')

  return (
    <button
      className={classes}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      title={title}
    >
      {children}
    </button>
  )
}
