import { useRecordHotkey, useHotkeysContext, CommandIcon, CtrlIcon, ShiftIcon, OptIcon, parseHotkeyString } from '@rdub/use-hotkeys'
import { useState, useCallback, useEffect, useMemo, type ReactNode, Fragment } from 'react'
import { Tooltip } from './Tooltip'
import type { HotkeySequence, KeyCombinationDisplay, ShortcutGroup, KeyCombination } from '@rdub/use-hotkeys'

export interface ShortcutsModalContentProps {
  groups: ShortcutGroup[]
  close: () => void
}

// Default sequence timeout from useRecordHotkey
const SEQUENCE_TIMEOUT_MS = 1000

export function ShortcutsModalContent({ groups, close }: ShortcutsModalContentProps) {
  // Track which specific binding is being edited (action + key)
  const [editingAction, setEditingAction] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [addingAction, setAddingAction] = useState<string | null>(null)
  // Key to restart timeout animation when pendingKeys changes
  const [timeoutAnimKey, setTimeoutAnimKey] = useState(0)

  // Access shortcuts state from context
  const { registry, conflicts, hasConflicts } = useHotkeysContext()

  // Build ordered list of all editable actions for Tab navigation
  const editableActions = useMemo(() => {
    const allActions = Array.from(registry.actions.keys())
    const actions: string[] = []
    // Y-Axis metrics (left then right per row)
    const metricSuffixes = ['temp', 'co2', 'humid', 'pm25', 'voc', 'autorange']
    for (const metric of metricSuffixes) {
      actions.push(`left:${metric}`, `right:${metric}`)
    }
    actions.push('right:none')
    // Time range actions (sorted)
    const timeActions = allActions
      .filter(a => a.startsWith('time:'))
      .sort()
    actions.push(...timeActions)
    // Device actions
    const deviceActions = allActions
      .filter(a => a.startsWith('device:'))
    actions.push(...deviceActions)
    // Table navigation (prev/next pairs)
    actions.push('table:prev-page', 'table:next-page')
    actions.push('table:prev-plot-page', 'table:next-plot-page')
    actions.push('table:first-page', 'table:last-page')
    // Other
    const otherActions = allActions
      .filter(a => a.startsWith('modal:') || a.startsWith('omnibar:'))
    actions.push(...otherActions)
    return actions
  }, [registry.actions])

  // Navigate to next/previous action in the list
  const navigateToAction = useCallback((direction: 'next' | 'prev') => {
    const currentAction = editingAction || addingAction
    if (!currentAction) return

    const currentIndex = editableActions.indexOf(currentAction)
    if (currentIndex === -1) return

    const newIndex = direction === 'next'
      ? (currentIndex + 1) % editableActions.length
      : (currentIndex - 1 + editableActions.length) % editableActions.length

    const newAction = editableActions[newIndex]

    // Get the first binding for the new action (or null if none)
    const bindings = registry.getBindingsForAction(newAction)
    const firstKey = bindings.length > 0 ? bindings[0] : null

    // Start editing the new action's first key (or adding if no bindings)
    if (firstKey) {
      setEditingAction(newAction)
      setEditingKey(firstKey)
      setAddingAction(null)
    } else {
      // No existing bindings, switch to adding mode
      setEditingAction(null)
      setEditingKey(null)
      setAddingAction(newAction)
    }
  }, [editingAction, addingAction, editableActions, registry])

  // Track pending conflict state - initially false, updated after pendingKeys changes
  const [hasPendingConflict, setHasPendingConflict] = useState(false)

  const { isRecording, startRecording, cancel, pendingKeys, activeKeys } = useRecordHotkey({
    onCapture: useCallback(
      (_sequence: HotkeySequence, display: KeyCombinationDisplay) => {
        if (addingAction) {
          // Adding a new key for an action
          registry.setBinding(addingAction, display.id)
          setAddingAction(null)
        } else if (editingAction && editingKey) {
          // Editing/replacing a specific existing key
          registry.removeBinding(editingKey)
          registry.setBinding(editingAction, display.id)
          setEditingAction(null)
          setEditingKey(null)
        }
      },
      [editingAction, editingKey, addingAction, registry],
    ),
    onCancel: useCallback(() => {
      setEditingAction(null)
      setEditingKey(null)
      setAddingAction(null)
    }, []),
    // Tab navigation: onCapture is called first (by useRecordHotkey) with pending keys,
    // then onTab/onShiftTab moves to next/prev action
    onTab: useCallback(() => navigateToAction('next'), [navigateToAction]),
    onShiftTab: useCallback(() => navigateToAction('prev'), [navigateToAction]),
    // Pause timeout when there's a pending conflict - gives user time to refine
    pauseTimeout: hasPendingConflict,
  })

  // Restart timeout animation when pendingKeys changes
  useEffect(() => {
    if (pendingKeys.length > 0) {
      setTimeoutAnimKey(k => k + 1)
    }
  }, [pendingKeys.length])

  const startEditing = useCallback(
    (action: string, key: string) => {
      setAddingAction(null)
      setEditingAction(action)
      setEditingKey(key)
      startRecording()
    },
    [startRecording],
  )

  const startAdding = useCallback(
    (action: string) => {
      setEditingAction(null)
      setEditingKey(null)
      setAddingAction(action)
      startRecording()
    },
    [startRecording],
  )

  const handleRemoveKey = useCallback(
    (_action: string, key: string) => {
      registry.removeBinding(key)
    },
    [registry],
  )

  // Extract shortcuts by group (only used for Y-axis metrics which have paired columns)
  const leftGroup = groups.find(g => g.name === 'Left Y-Axis')
  const rightGroup = groups.find(g => g.name === 'Right Y-Axis')

  // Build metric rows: pair left and right shortcuts
  const metricNames = ['temp', 'co2', 'humid', 'pm25', 'voc', 'autorange']
  const metricLabels: Record<string, ReactNode> = {
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

  // Get all shortcuts for a given action (using registry to include unbound actions)
  const getShortcutsForAction = (_group: typeof leftGroup, actionSuffix: string, prefix: string = ''): string[] => {
    // Determine the full action name
    let actionName: string
    if (prefix) {
      actionName = `${prefix}:${actionSuffix}`
    } else if (_group) {
      // Try to infer from group
      const sample = _group.shortcuts.find(s => s.actionId.endsWith(`:${actionSuffix}`))
      actionName = sample?.actionId || actionSuffix
    } else {
      actionName = actionSuffix
    }
    return registry.getBindingsForAction(actionName)
  }

  // Get action name from group and metric
  const getActionName = (prefix: string, metric: string) => `${prefix}:${metric}`

  // Render multi-key cell with +/x controls
  const renderMultiKeyCell = (action: string, keys: string[]) => {
    return (
      <span className="multi-keys">
        {keys.map((key) => (
          <Fragment key={key}>
            {renderEditableKbd(action, key, true)}
          </Fragment>
        ))}
        {renderAddButton(action)}
      </span>
    )
  }

  // Render a single key combination with nice modifier symbols
  // Handles formats like "ctrl+shift+z", "meta+k", "shift+,", etc.
  const renderSingleKey = (key: string) => {
    const lower = key.toLowerCase()
    const parts = lower.split('+')
    const result: ReactNode[] = []

    // Check for modifiers (all parts except the last one)
    const modifiers = parts.slice(0, -1)
    const mainKey = parts[parts.length - 1]

    // Render modifiers in standard order: ctrl, meta, alt, shift
    if (modifiers.includes('ctrl')) result.push(<CtrlIcon key="ctrl" />)
    if (modifiers.includes('meta')) result.push(<CommandIcon key="meta" />)
    if (modifiers.includes('alt')) result.push(<OptIcon key="alt" />)
    if (modifiers.includes('shift')) {
      // For shifted punctuation, show the shifted character instead
      if (mainKey === ',') {
        result.push(<span key="main">{'<'}</span>)
        return <>{result}</>
      }
      if (mainKey === '.') {
        result.push(<span key="main">{'>'}</span>)
        return <>{result}</>
      }
      result.push(<ShiftIcon key="shift" />)
    }

    // Add the main key
    if (mainKey) {
      result.push(<span key="main">{mainKey.toUpperCase()}</span>)
    }

    return <>{result}</>
  }

  // Render a key or sequence (space-separated keys)
  const renderKey = (key: string) => {
    if (!key) return '-'
    // Check if it's a sequence (contains space but not in modifier syntax)
    if (key.includes(' ') && !key.includes('+')) {
      // It's a sequence like "d 1" or "w 2"
      const parts = key.split(' ')
      return (
        <>
          {parts.map((part, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="sequence-sep">›</span>}
              {renderSingleKey(part)}
            </Fragment>
          ))}
        </>
      )
    }
    return renderSingleKey(key)
  }

  // Check if a key has a conflict
  const hasConflict = (key: string) => conflicts.has(key.toLowerCase())

  // Check if two key combinations are equal
  const combinationsEqual = (a: KeyCombination, b: KeyCombination): boolean => {
    return (
      a.key === b.key &&
      a.modifiers.ctrl === b.modifiers.ctrl &&
      a.modifiers.alt === b.modifiers.alt &&
      a.modifiers.shift === b.modifiers.shift &&
      a.modifiers.meta === b.modifiers.meta
    )
  }

  // Check if sequence A is a prefix of sequence B
  const isPrefix = (a: HotkeySequence, b: HotkeySequence): boolean => {
    if (a.length >= b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!combinationsEqual(a[i], b[i])) return false
    }
    return true
  }

  // Check if pending keys would conflict with existing bindings
  // Returns { hasConflict, conflictingKeys } where conflictingKeys are the existing bindings that conflict
  const checkPendingConflict = useMemo(() => {
    return (pending: HotkeySequence, excludeKey?: string): { hasConflict: boolean; conflictingKeys: string[] } => {
      if (pending.length === 0) return { hasConflict: false, conflictingKeys: [] }

      const conflictingKeys: string[] = []

      for (const key of Object.keys(registry.keymap)) {
        // Skip the key we're currently editing (it will be replaced)
        if (excludeKey && key.toLowerCase() === excludeKey.toLowerCase()) continue

        const keySequence = parseHotkeyString(key)

        // Exact match conflict
        if (pending.length === keySequence.length) {
          let isExact = true
          for (let i = 0; i < pending.length; i++) {
            if (!combinationsEqual(pending[i], keySequence[i])) {
              isExact = false
              break
            }
          }
          if (isExact) {
            conflictingKeys.push(key)
            continue
          }
        }

        // Prefix conflict: pending is a prefix of existing key
        if (isPrefix(pending, keySequence)) {
          conflictingKeys.push(key)
          continue
        }

        // Prefix conflict: existing key is a prefix of pending
        if (isPrefix(keySequence, pending)) {
          conflictingKeys.push(key)
        }
      }

      return { hasConflict: conflictingKeys.length > 0, conflictingKeys }
    }
  }, [registry.keymap])

  // Get pending conflict status for the current recording
  const pendingConflict = useMemo(() => {
    if (!isRecording || pendingKeys.length === 0) {
      return { hasConflict: false, conflictingKeys: [] }
    }
    // When editing, exclude the key being edited
    const excludeKey = editingKey || undefined
    return checkPendingConflict(pendingKeys, excludeKey)
  }, [isRecording, pendingKeys, editingKey, checkPendingConflict])

  // Update hasPendingConflict state to pause/resume timeout
  useEffect(() => {
    setHasPendingConflict(pendingConflict.hasConflict)
  }, [pendingConflict.hasConflict])

  // Render a single KeyCombination with our SVG icons
  const renderCombination = (combo: { key: string; modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } }) => {
    const parts: ReactNode[] = []
    if (combo.modifiers.ctrl) parts.push(<CtrlIcon key="ctrl" />)
    if (combo.modifiers.meta) parts.push(<CommandIcon key="meta" />)
    if (combo.modifiers.alt) parts.push(<OptIcon key="alt" />)
    if (combo.modifiers.shift) parts.push(<ShiftIcon key="shift" />)
    if (combo.key) parts.push(<span key="key">{combo.key.toUpperCase()}</span>)
    return <>{parts}</>
  }

  // Format keys for display during recording
  // Shows pendingKeys (released keys) + activeKeys (currently held)
  const renderRecordingSequence = (): ReactNode => {
    // Nothing pressed yet
    if (pendingKeys.length === 0 && (!activeKeys || !activeKeys.key)) {
      return '...'
    }

    const parts: ReactNode[] = []

    // Render pending keys (already pressed and released)
    pendingKeys.forEach((combo, i) => {
      if (i > 0) parts.push(<span key={`sep-${i}`}> </span>)
      parts.push(<span key={`pending-${i}`}>{renderCombination(combo)}</span>)
    })

    // Add currently held keys
    if (activeKeys && activeKeys.key) {
      if (parts.length > 0) parts.push(<span key="arrow"> → </span>)
      parts.push(<span key="active">{renderCombination(activeKeys)}</span>)
    }

    // Ellipsis indicates we're waiting for timeout or more keys
    parts.push(<span key="ellipsis">...</span>)
    return <>{parts}</>
  }

  // Render an editable kbd element with optional remove button
  const renderEditableKbd = (action: string, key: string, showRemove = false) => {
    // Check if THIS specific binding is being edited (not just the action)
    const isEditing = editingAction === action && editingKey === key && !addingAction
    const displayKey = renderKey(key)
    const isConflict = key && hasConflict(key)

    if (isEditing) {
      // Only show timeout bar when there's no conflict (timeout is paused during conflict)
      const showTimeoutBar = pendingKeys.length > 0 && !pendingConflict.hasConflict
      const editingClasses = ['editing', pendingConflict.hasConflict && 'conflict'].filter(Boolean).join(' ')
      return (
        <kbd className={editingClasses} title={pendingConflict.hasConflict ? `Conflicts with: ${pendingConflict.conflictingKeys.join(', ')}` : undefined}>
          {renderRecordingSequence()}
          {showTimeoutBar && (
            <span
              key={timeoutAnimKey}
              className="kbd-timeout-bar"
              style={{ animationDuration: `${SEQUENCE_TIMEOUT_MS}ms` }}
            />
          )}
        </kbd>
      )
    }

    // Check if this key would conflict with current pending keys
    const isPendingConflict = isRecording && pendingConflict.conflictingKeys.includes(key)
    const isDefault = registry.actions.get(action)?.config.defaultBindings?.includes(key) ?? false
    const classes = [
      'editable',
      isConflict && 'conflict',
      isPendingConflict && 'pending-conflict',
      isDefault && 'default-binding',
    ].filter(Boolean).join(' ')
    const title = isConflict
      ? `Conflict! This key is bound to multiple actions. Click to change.`
      : isPendingConflict
        ? 'This binding would conflict with your current input'
        : isDefault
          ? 'Default binding. Click to change.'
          : 'Custom binding. Click to change.'

    return (
      <span className="key-with-remove">
        <kbd
          className={classes}
          onClick={() => startEditing(action, key)}
          title={title}
        >
          {displayKey || '-'}
        </kbd>
        {showRemove && key && (
          <button
            className="remove-key-btn"
            onClick={(e) => {
              e.stopPropagation()
              handleRemoveKey(action, key)
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
      // Only show timeout bar when there's no conflict (timeout is paused during conflict)
      const showTimeoutBar = pendingKeys.length > 0 && !pendingConflict.hasConflict
      const addingClasses = ['editing', 'adding', pendingConflict.hasConflict && 'conflict'].filter(Boolean).join(' ')
      return (
        <kbd className={addingClasses} title={pendingConflict.hasConflict ? `Conflicts with: ${pendingConflict.conflictingKeys.join(', ')}` : undefined}>
          {renderRecordingSequence()}
          {showTimeoutBar && (
            <span
              key={timeoutAnimKey}
              className="kbd-timeout-bar"
              style={{ animationDuration: `${SEQUENCE_TIMEOUT_MS}ms` }}
            />
          )}
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
          // Cancel any pending recording before closing (discards uncommitted changes)
          if (isRecording) cancel()
          close()
        }
      }}
    >
      <div
        className="shortcuts-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          // Cancel when clicking inside modal but not on kbd/button
          // This discards pending keys - use Tab/Enter to commit
          if (isRecording) {
            const target = e.target as HTMLElement
            const isInteractive = target.closest('kbd, button')
            if (!isInteractive) {
              cancel()
            }
          }
        }}
      >
        <div className="shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <div className="shortcuts-header-buttons">
            <button
              className="reset-button"
              onClick={() => registry.resetOverrides()}
              title="Reset all shortcuts to defaults"
            >
              Reset
            </button>
            <button onClick={close} aria-label="Close">×</button>
          </div>
        </div>

        {hasConflicts && (
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
              const leftKeys = getShortcutsForAction(leftGroup, metric, 'left')
              const rightKeys = getShortcutsForAction(rightGroup, metric, 'right')
              const leftAction = getActionName('left', metric)
              const rightAction = getActionName('right', metric)
              return (
                <tr key={metric}>
                  <td>{metricLabels[metric]}</td>
                  <td>{renderMultiKeyCell(leftAction, leftKeys)}</td>
                  <td>{renderMultiKeyCell(rightAction, rightKeys)}</td>
                </tr>
              )
            })}
            <tr>
              <td>
                <Tooltip content="Only applies to right Y-axis; left Y-axis always requires a metric">
                  <span className="tooltip-trigger">None ⓘ</span>
                </Tooltip>
              </td>
              <td>-</td>
              <td>{renderMultiKeyCell('right:none', getShortcutsForAction(rightGroup, 'none', 'right'))}</td>
            </tr>
          </tbody>
        </table>

        <h3>Time Range</h3>
        <table className="shortcuts-table">
          <tbody>
            {(() => {
              // Include all time actions from registry
              const timeActions = Array.from(registry.actions.entries())
                .filter(([action]) => action.startsWith('time:'))
                .sort(([a], [b]) => a.localeCompare(b))
              return timeActions.map(([action, { config }]) => {
                const tooltip = timeTooltips[action]
                const keys = registry.getBindingsForAction(action)
                return (
                  <tr key={action}>
                    <td>
                      {tooltip ? (
                        <Tooltip content={tooltip}>
                          <span className="tooltip-trigger">{config.label} ⓘ</span>
                        </Tooltip>
                      ) : config.label}
                    </td>
                    <td>{renderMultiKeyCell(action, keys)}</td>
                  </tr>
                )
              })
            })()}
          </tbody>
        </table>

        {/* Devices section - show if any device actions exist */}
        {(() => {
          const deviceActions = Array.from(registry.actions.entries())
            .filter(([action]) => action.startsWith('device:'))
          if (deviceActions.length === 0) return null
          return (
            <>
              <h3>Devices</h3>
              <table className="shortcuts-table">
                <tbody>
                  {deviceActions.map(([action, { config }]) => (
                    <tr key={action}>
                      <td>{config.label}</td>
                      <td>{renderMultiKeyCell(action, registry.getBindingsForAction(action))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )
        })()}

        {/* Table Navigation - always show if any table actions exist */}
        {(() => {
          const tableActions = Array.from(registry.actions.keys())
            .filter(action => action.startsWith('table:'))
          if (tableActions.length === 0) return null
          // Pair prev/next shortcuts
          const pairs = [
            { label: 'Table page', prev: 'table:prev-page', next: 'table:next-page' },
            { label: 'Plot page', prev: 'table:prev-plot-page', next: 'table:next-plot-page' },
            { label: 'All pages', prev: 'table:first-page', next: 'table:last-page' },
          ]
          return (
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
                  {pairs.map(({ label, prev, next }) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>{renderMultiKeyCell(prev, registry.getBindingsForAction(prev))}</td>
                      <td>{renderMultiKeyCell(next, registry.getBindingsForAction(next))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )
        })()}

        <h3>Other</h3>
        <table className="shortcuts-table">
          <tbody>
            {(() => {
              // Include all actions from 'modal' and 'omnibar' groups
              const otherActions = Array.from(registry.actions.entries())
                .filter(([action]) => action.startsWith('modal:') || action.startsWith('omnibar:'))
              return otherActions.map(([action, { config }]) => (
                <tr key={action}>
                  <td>{config.label}</td>
                  <td>{renderMultiKeyCell(action, registry.getBindingsForAction(action))}</td>
                </tr>
              ))
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}
