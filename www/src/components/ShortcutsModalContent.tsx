import { useRecordHotkey, useKeyboardShortcutsContext } from '@rdub/use-hotkeys'
import React, { useState, useCallback } from 'react'
import { Tooltip } from './Tooltip'
import type { HotkeySequence, KeyCombinationDisplay, ShortcutGroup } from '@rdub/use-hotkeys'

// Descriptions for keyboard shortcuts modal
export const HOTKEY_DESCRIPTIONS: Record<string, string> = {
  // Left Y-axis
  'left:temp': 'Temperature',
  'left:co2': 'CO₂',
  'left:humid': 'Humidity',
  'left:pm25': 'PM2.5',
  'left:voc': 'VOC',
  'left:autorange': 'Toggle auto-range',
  // Right Y-axis
  'right:temp': 'Temperature',
  'right:co2': 'CO₂',
  'right:humid': 'Humidity',
  'right:pm25': 'PM2.5',
  'right:voc': 'VOC',
  'right:none': 'Clear',
  'right:autorange': 'Toggle auto-range',
  // Time ranges
  'time:01-1d': '1 day',
  'time:02-3d': '3 days',
  'time:03-7d': '1 week',
  'time:04-14d': '2 weeks',
  'time:05-30d': '1 month',
  'time:06-all': 'Full history',
  'time:07-latest': 'Latest',
  // Devices
  'device:gym': 'Toggle Gym',
  'device:br': 'Toggle BR',
  // Table pagination
  'table:prev-page': 'Prev table page',
  'table:next-page': 'Next table page',
  'table:prev-plot-page': 'Prev plot page',
  'table:next-plot-page': 'Next plot page',
  'table:first-page': 'First page',
  'table:last-page': 'Last page',
  // Modal
  'modal:shortcuts': 'This dialog',
}

// Group names for shortcuts modal
export const HOTKEY_GROUPS: Record<string, string> = {
  'left': 'Left Y-Axis',
  'right': 'Right Y-Axis',
  'time': 'Time Range',
  'device': 'Devices',
  'table': 'Table Navigation',
  'modal': 'Other',
}

export interface ShortcutsModalContentProps {
  groups: ShortcutGroup[]
  close: () => void
}

export function ShortcutsModalContent({ groups, close }: ShortcutsModalContentProps) {
  const [editingAction, setEditingAction] = useState<string | null>(null)
  const [addingAction, setAddingAction] = useState<string | null>(null)

  // Access shortcuts state from context
  const shortcutsState = useKeyboardShortcutsContext()

  const { isRecording, startRecording, cancel, sequence, pendingKeys } = useRecordHotkey({
    onCapture: useCallback(
      (_sequence: HotkeySequence, display: KeyCombinationDisplay) => {
        if (addingAction) {
          // Adding a new key for an action
          shortcutsState.addBinding(addingAction, display.id)
          setAddingAction(null)
        } else if (editingAction) {
          // Editing/replacing an existing key
          shortcutsState.setBinding(editingAction, display.id)
          setEditingAction(null)
        }
      },
      [editingAction, addingAction, shortcutsState],
    ),
    onCancel: useCallback(() => {
      setEditingAction(null)
      setAddingAction(null)
    }, []),
  })

  const startEditing = useCallback(
    (action: string) => {
      setAddingAction(null)
      setEditingAction(action)
      startRecording()
    },
    [startRecording],
  )

  const startAdding = useCallback(
    (action: string) => {
      setEditingAction(null)
      setAddingAction(action)
      startRecording()
    },
    [startRecording],
  )

  const handleRemoveKey = useCallback(
    (key: string) => {
      shortcutsState.removeBinding(key)
    },
    [shortcutsState],
  )

  // Extract shortcuts by group
  const leftGroup = groups.find(g => g.name === 'Left Y-Axis')
  const rightGroup = groups.find(g => g.name === 'Right Y-Axis')
  const timeGroup = groups.find(g => g.name === 'Time Range')
  const deviceGroup = groups.find(g => g.name === 'Devices')
  const tableGroup = groups.find(g => g.name === 'Table Navigation')
  const modalGroup = groups.find(g => g.name === 'Other')

  // Build metric rows: pair left and right shortcuts
  const metricNames = ['temp', 'co2', 'humid', 'pm25', 'voc', 'autorange']
  const metricLabels: Record<string, React.ReactNode> = {
    temp: 'Temperature',
    co2: 'CO₂',
    humid: 'Humidity',
    pm25: 'PM2.5',
    voc: 'VOC',
    autorange: (
      <Tooltip content="Scale Y-axis to fit data in view (vs. fixed floor at 0 or metric minimum)">
        <span className="tooltip-trigger">Auto-range ⓘ</span>
      </Tooltip>
    ),
  }

  // Tooltips for time range items
  const timeTooltips: Record<string, string> = {
    'time:06-all': 'Show entire data history from first to last record',
    'time:07-latest': 'Jump to most recent data and auto-update as new data arrives',
  }

  const getShortcut = (group: typeof leftGroup, metric: string) => {
    return group?.shortcuts.find(s => s.action.endsWith(`:${metric}`))
  }

  // Shift arrow SVG - consistent across all browsers/platforms
  const ShiftIcon = () => (
    <svg className="modifier-icon" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 4l-8 8h5v8h6v-8h5z"/>
    </svg>
  )

  // Render a single key combination with nice modifier symbols
  const renderSingleKey = (key: string) => {
    const upper = key.toUpperCase()
    if (upper.startsWith('META+')) {
      const mainKey = upper.replace('META+', '')
      return <>⌘{mainKey}</>
    }
    if (upper.startsWith('SHIFT+')) {
      const mainKey = upper.replace('SHIFT+', '')
      // Show the shifted character for punctuation
      if (mainKey === ',') return '<'
      if (mainKey === '.') return '>'
      return <><ShiftIcon />{mainKey}</>
    }
    return upper
  }

  // Render a key or sequence (space-separated keys)
  const renderKey = (key: string) => {
    if (!key) return '-'
    // Check if it's a sequence (contains space but not in modifier syntax)
    if (key.includes(' ') && !key.includes('+')) {
      // It's a sequence like "1 d" or "2 w"
      const parts = key.split(' ')
      return (
        <>
          {parts.map((part, i) => (
            <React.Fragment key={i}>
              {i > 0 && ' '}
              {renderSingleKey(part)}
            </React.Fragment>
          ))}
        </>
      )
    }
    return renderSingleKey(key)
  }

  // Check if a key has a conflict
  const hasConflict = (key: string) => shortcutsState.conflicts.has(key.toLowerCase())

  // Format a sequence for display during recording
  const formatRecordingSequence = () => {
    if (!sequence || sequence.length === 0) return '...'
    // Format each key in the sequence
    const parts = sequence.map(combo => {
      let key = combo.key.toUpperCase()
      if (combo.modifiers.shift) key = `SHIFT+${key}`
      if (combo.modifiers.ctrl) key = `CTRL+${key}`
      if (combo.modifiers.alt) key = `ALT+${key}`
      if (combo.modifiers.meta) key = `META+${key}`
      return key
    })
    // Show pending indicator if sequence is incomplete
    return parts.join(' → ') + (pendingKeys && pendingKeys.length > 0 ? ' → ...' : '')
  }

  // Render an editable kbd element with optional remove button
  const renderEditableKbd = (action: string, key: string, showRemove = false) => {
    const isEditing = editingAction === action && !addingAction
    const displayKey = renderKey(key)
    const isConflict = key && hasConflict(key)

    if (isEditing) {
      return (
        <kbd className="editing">
          {formatRecordingSequence()}
        </kbd>
      )
    }

    const classes = ['editable', isConflict && 'conflict'].filter(Boolean).join(' ')
    const title = isConflict
      ? `Conflict! This key is bound to multiple actions. Click to change.`
      : 'Click to change'

    return (
      <span className="key-with-remove">
        <kbd
          className={classes}
          onClick={() => startEditing(action)}
          title={title}
        >
          {displayKey || '-'}
        </kbd>
        {showRemove && key && (
          <button
            className="remove-key-btn"
            onClick={(e) => {
              e.stopPropagation()
              handleRemoveKey(key)
            }}
            title="Remove this shortcut"
          >
            ×
          </button>
        )}
      </span>
    )
  }

  // Render add button for an action
  const renderAddButton = (action: string) => {
    const isAdding = addingAction === action

    if (isAdding) {
      return (
        <kbd className="editing adding">
          {formatRecordingSequence() || '...'}
        </kbd>
      )
    }

    return (
      <button
        className="add-key-btn"
        onClick={() => startAdding(action)}
        title="Add another shortcut"
      >
        +
      </button>
    )
  }

  return (
    <div
      className="shortcuts-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (isRecording) cancel()
          close()
        }
      }}
    >
      <div className="shortcuts-modal" role="dialog" aria-modal="true">
        <div className="shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <div className="shortcuts-header-buttons">
            <button
              className="reset-button"
              onClick={() => shortcutsState.reset()}
              title="Reset all shortcuts to defaults"
            >
              Reset
            </button>
            <button onClick={close} aria-label="Close">×</button>
          </div>
        </div>

        {shortcutsState.hasConflicts && (
          <div className="shortcuts-conflict-warning">
            <span className="warning-icon">⚠</span>
            Some shortcuts have conflicts and are disabled. Click to reassign.
          </div>
        )}

        <p className="shortcuts-hint">Click any key to customize</p>

        <h3>Y-Axis Metrics</h3>
        <table className="shortcuts-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Left</th>
              <th>Right</th>
            </tr>
          </thead>
          <tbody>
            {metricNames.map(metric => {
              const left = getShortcut(leftGroup, metric)
              const right = getShortcut(rightGroup, metric)
              return (
                <tr key={metric}>
                  <td>{metricLabels[metric]}</td>
                  <td>{renderEditableKbd(left?.action || `left:${metric}`, left?.key || '')}</td>
                  <td>{renderEditableKbd(right?.action || `right:${metric}`, right?.key || '')}</td>
                </tr>
              )
            })}
            <tr>
              <td>None</td>
              <td>-</td>
              <td>{renderEditableKbd('right:none', getShortcut(rightGroup, 'none')?.key || 'shift+n')}</td>
            </tr>
          </tbody>
        </table>

        <h3>Time Range</h3>
        <table className="shortcuts-table">
          <tbody>
            {(() => {
              // Group shortcuts by action to handle multiple keys per action
              const actionMap = new Map<string, { keys: string[]; description?: string }>()
              timeGroup?.shortcuts.forEach(s => {
                const existing = actionMap.get(s.action)
                if (existing) {
                  existing.keys.push(s.key)
                } else {
                  actionMap.set(s.action, { keys: [s.key], description: s.description })
                }
              })
              // Sort by action name and render
              return Array.from(actionMap.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([action, { keys, description }]) => {
                  const tooltip = timeTooltips[action]
                  return (
                    <tr key={action}>
                      <td>
                        {tooltip ? (
                          <Tooltip content={tooltip}>
                            <span className="tooltip-trigger">{description} ⓘ</span>
                          </Tooltip>
                        ) : description}
                      </td>
                      <td className="multi-keys">
                        {keys.map(key => (
                          <React.Fragment key={key}>
                            {renderEditableKbd(action, key, keys.length > 1)}
                          </React.Fragment>
                        ))}
                        {renderAddButton(action)}
                      </td>
                    </tr>
                  )
                })
            })()}
          </tbody>
        </table>

        {deviceGroup && deviceGroup.shortcuts.length > 0 && (
          <>
            <h3>Devices</h3>
            <table className="shortcuts-table">
              <tbody>
                {deviceGroup.shortcuts.map(s => (
                  <tr key={s.action}>
                    <td>{s.description}</td>
                    <td>{renderEditableKbd(s.action, s.key)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {tableGroup && tableGroup.shortcuts.length > 0 && (
          <>
            <h3>Table Navigation</h3>
            <table className="shortcuts-table">
              <thead>
                <tr>
                  <th>Navigation</th>
                  <th>Back</th>
                  <th>Forward</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Pair prev/next shortcuts
                  const pairs = [
                    { label: 'Table page', prev: 'table:prev-page', next: 'table:next-page' },
                    { label: 'Plot page', prev: 'table:prev-plot-page', next: 'table:next-plot-page' },
                    { label: 'All pages', prev: 'table:first-page', next: 'table:last-page' },
                  ]
                  const getShortcutByAction = (action: string) =>
                    tableGroup.shortcuts.find(s => s.action === action)
                  return pairs.map(({ label, prev, next }) => {
                    const prevShortcut = getShortcutByAction(prev)
                    const nextShortcut = getShortcutByAction(next)
                    return (
                      <tr key={label}>
                        <td>{label}</td>
                        <td>{renderEditableKbd(prev, prevShortcut?.key || '')}</td>
                        <td>{renderEditableKbd(next, nextShortcut?.key || '')}</td>
                      </tr>
                    )
                  })
                })()}
              </tbody>
            </table>
          </>
        )}

        <h3>Other</h3>
        <table className="shortcuts-table">
          <tbody>
            {modalGroup?.shortcuts.map(s => (
              <tr key={s.action}>
                <td>{s.description}</td>
                <td>{renderEditableKbd(s.action, s.key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
