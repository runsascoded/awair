import { useRecordHotkey } from '@rdub/use-hotkeys'
import React, { useState, useCallback } from 'react'
import { Tooltip } from './Tooltip'
import type { KeyboardShortcutsState } from '../hooks/useKeyboardShortcuts'
import type { KeyCombination, KeyCombinationDisplay, ShortcutGroup } from '@rdub/use-hotkeys'

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
  'time:03-7d': '7 days',
  'time:04-14d': '14 days',
  'time:05-30d': '30 days',
  'time:06-all': 'Full history',
  'time:07-latest': 'Latest',
  // Modal
  'modal:shortcuts': 'This dialog',
}

// Group names for shortcuts modal
export const HOTKEY_GROUPS: Record<string, string> = {
  'left': 'Left Y-Axis',
  'right': 'Right Y-Axis',
  'time': 'Time Range',
  'modal': 'Other',
}

export interface ShortcutsModalContentProps {
  groups: ShortcutGroup[]
  close: () => void
  shortcutsState: KeyboardShortcutsState
}

export function ShortcutsModalContent({ groups, close, shortcutsState }: ShortcutsModalContentProps) {
  const [editingAction, setEditingAction] = useState<string | null>(null)

  const { isRecording, startRecording, cancel, activeKeys } = useRecordHotkey({
    onCapture: useCallback(
      (_combo: KeyCombination, display: KeyCombinationDisplay) => {
        if (editingAction) {
          shortcutsState.setBinding(editingAction, display.id)
          setEditingAction(null)
        }
      },
      [editingAction, shortcutsState],
    ),
    onCancel: useCallback(() => {
      setEditingAction(null)
    }, []),
  })

  const startEditing = useCallback(
    (action: string) => {
      setEditingAction(action)
      startRecording()
    },
    [startRecording],
  )

  // Extract shortcuts by group
  const leftGroup = groups.find(g => g.name === 'Left Y-Axis')
  const rightGroup = groups.find(g => g.name === 'Right Y-Axis')
  const timeGroup = groups.find(g => g.name === 'Time Range')
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

  // Render a key with nice modifier symbols
  const renderKey = (key: string) => {
    const upper = key.toUpperCase()
    if (upper.startsWith('SHIFT+')) {
      const mainKey = upper.replace('SHIFT+', '')
      return <><ShiftIcon />{mainKey}</>
    }
    return upper
  }

  // Render an editable kbd element
  const renderEditableKbd = (action: string, key: string, useShiftIcon = false) => {
    const isEditing = editingAction === action
    const displayKey = useShiftIcon ? renderKey(key) : key.toUpperCase()

    if (isEditing) {
      return (
        <kbd className="editing">
          {activeKeys ? renderKey(activeKeys.key) : '...'}
        </kbd>
      )
    }

    return (
      <kbd
        className="editable"
        onClick={() => startEditing(action)}
        title="Click to change"
      >
        {displayKey || '-'}
      </kbd>
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
                  <td>{renderEditableKbd(right?.action || `right:${metric}`, right?.key || '', true)}</td>
                </tr>
              )
            })}
            <tr>
              <td>None</td>
              <td>-</td>
              <td>{renderEditableKbd('right:none', getShortcut(rightGroup, 'none')?.key || 'shift+n', true)}</td>
            </tr>
          </tbody>
        </table>

        <h3>Time Range</h3>
        <table className="shortcuts-table">
          <tbody>
            {timeGroup?.shortcuts
              .slice()
              .sort((a, b) => a.action.localeCompare(b.action))
              .map(s => {
                const tooltip = timeTooltips[s.action]
                return (
                  <tr key={s.action}>
                    <td>
                      {tooltip ? (
                        <Tooltip content={tooltip}>
                          <span className="tooltip-trigger">{s.description} ⓘ</span>
                        </Tooltip>
                      ) : s.description}
                    </td>
                    <td>{renderEditableKbd(s.action, s.key)}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>

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
