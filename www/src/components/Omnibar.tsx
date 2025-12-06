import { useKeyboardShortcutsContext } from '@rdub/use-hotkeys'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HOTKEY_DESCRIPTIONS, HOTKEY_GROUPS } from './ShortcutsModalContent'
import type { ActionSearchResult } from '@rdub/use-hotkeys'

// Keywords/synonyms for better search matching
const ACTION_KEYWORDS: Record<string, string[]> = {
  // CO₂ synonyms
  'left:co2': ['co2', 'carbon dioxide', 'carbon'],
  'right:co2': ['co2', 'carbon dioxide', 'carbon'],
  // Navigation synonyms
  'table:prev-page': ['back', 'previous', 'backward'],
  'table:next-page': ['forward', 'next'],
  'table:prev-plot-page': ['back', 'previous', 'backward'],
  'table:next-plot-page': ['forward', 'next'],
  'table:first-page': ['start', 'beginning', 'home'],
  'table:last-page': ['end', 'finish'],
  // Metric synonyms
  'left:temp': ['temperature', 'degrees'],
  'right:temp': ['temperature', 'degrees'],
  'left:humid': ['humidity', 'moisture', 'hum'],
  'right:humid': ['humidity', 'moisture', 'hum'],
  'left:pm25': ['pm2.5', 'particulate', 'particles', 'dust'],
  'right:pm25': ['pm2.5', 'particulate', 'particles', 'dust'],
  'left:voc': ['volatile', 'organic', 'compounds'],
  'right:voc': ['volatile', 'organic', 'compounds'],
  // Time range synonyms
  'time:06-all': ['everything', 'full', 'complete'],
  'time:07-latest': ['now', 'current', 'recent', 'live'],
}

interface OmnibarProps {
  isOpen: boolean
  onClose: () => void
  onExecute: (actionId: string) => void
}

export function Omnibar({ isOpen, onClose, onExecute }: OmnibarProps) {
  const { keymap } = useKeyboardShortcutsContext()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Build action registry from HOTKEY_DESCRIPTIONS with keywords
  const actions = useMemo(() => {
    const registry: Record<string, { label: string; category?: string; groupName?: string; keywords: string[] }> = {}
    for (const [actionId, label] of Object.entries(HOTKEY_DESCRIPTIONS)) {
      const [categoryKey] = actionId.split(':')
      const groupName = HOTKEY_GROUPS[categoryKey] || categoryKey

      // Combine explicit keywords with group name for searching
      const keywords = [
        ...(ACTION_KEYWORDS[actionId] || []),
        groupName.toLowerCase(),
        categoryKey,
      ]

      registry[actionId] = { label, category: categoryKey, groupName, keywords }
    }
    return registry
  }, [])

  // Get all bindings for each action
  const actionBindings = useMemo(() => {
    const bindings = new Map<string, string[]>()
    for (const [key, action] of Object.entries(keymap)) {
      const actionId = Array.isArray(action) ? action[0] : action
      if (!bindings.has(actionId)) {
        bindings.set(actionId, [])
      }
      bindings.get(actionId)!.push(key)
    }
    return bindings
  }, [keymap])

  // Search - filter actions by query, matching label, group, keywords, and bindings
  const results: ActionSearchResult[] = useMemo(() => {
    const q = query.toLowerCase().trim()
    const queryTerms = q.split(/\s+/).filter(Boolean)
    const matches: ActionSearchResult[] = []

    for (const [id, action] of Object.entries(actions)) {
      const label = action.label.toLowerCase()
      const groupName = action.groupName?.toLowerCase() || ''
      const keywords = action.keywords
      const bindings = actionBindings.get(id) || []

      // Build searchable text for this action
      const searchableTexts = [label, groupName, ...keywords, ...bindings.map(b => b.toLowerCase())]
      const allText = searchableTexts.join(' ')

      // Check if ALL query terms match something
      const matchesQuery = !q || queryTerms.every(term =>
        searchableTexts.some(text => text.includes(term))
      )

      if (matchesQuery) {
        // Calculate score: prefer label matches, then group, then keywords
        let score = 0
        if (q) {
          if (label.startsWith(q)) score = 4
          else if (label.includes(q)) score = 3
          else if (groupName.includes(q)) score = 2
          else if (keywords.some(k => k.includes(q))) score = 1
          // Multi-term queries get a bonus if they match
          if (queryTerms.length > 1 && queryTerms.every(t => allText.includes(t))) {
            score += 1
          }
        }

        matches.push({
          id,
          action: { label: action.label, category: action.groupName },
          bindings,
          score,
          labelMatches: [],
        })
      }
    }

    // Sort by score (higher first), then alphabetically
    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.action.label.localeCompare(b.action.label)
    })

    return matches.slice(0, 15)
  }, [query, actions, actionBindings])

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      // Focus input after render
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [results])

  // Global escape/meta+k handler - use capture phase to run before input handlers
  useEffect(() => {
    if (!isOpen) return

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    // Capture phase ensures this runs before the input's handlers
    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true })
  }, [isOpen, onClose])

  // Handle keyboard navigation (Escape/meta+k handled by global capture handler)
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (results[selectedIndex]) {
          onExecute(results[selectedIndex].id)
          onClose()
        }
        break
    }
  }, [results, selectedIndex, onExecute, onClose])

  // Close on blur (e.g., when Escape blurs the input)
  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Check if focus is moving to something within the omnibar (e.g., clicking a result)
    const omnibar = e.currentTarget.closest('.omnibar')
    if (omnibar && e.relatedTarget && omnibar.contains(e.relatedTarget as Node)) {
      return // Don't close if focus is staying within omnibar
    }
    // Small delay to allow click events to fire first
    setTimeout(() => onClose(), 0)
  }, [onClose])

  // Execute action on click
  const handleResultClick = useCallback((actionId: string) => {
    onExecute(actionId)
    onClose()
  }, [onExecute, onClose])

  // Format key for display
  const formatKey = (key: string) => {
    return key
      .replace('meta+', '⌘')
      .replace('shift+', '⇧')
      .replace('ctrl+', '⌃')
      .replace('alt+', '⌥')
      .toUpperCase()
  }

  if (!isOpen) return null

  return (
    <div
      className="omnibar-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="omnibar">
        <input
          ref={inputRef}
          type="text"
          className="omnibar-input"
          placeholder="Search actions..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />

        <div className="omnibar-results">
          {results.length === 0 && query && (
            <div className="omnibar-no-results">No matching actions</div>
          )}
          {results.map((result, index) => (
            <div
              key={result.id}
              className={`omnibar-result ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => handleResultClick(result.id)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="result-label">{result.action.label}</span>
              {result.action.category && (
                <span className="result-category">{result.action.category}</span>
              )}
              <span className="result-bindings">
                {result.bindings.slice(0, 2).map((key, i) => (
                  <kbd key={i}>{formatKey(key)}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
