import { formatCombination, useDynamicHotkeysContext } from '@rdub/use-hotkeys'
import { useMemo } from 'react'
import type { HotkeySequence, SequenceCompletion } from '@rdub/use-hotkeys'

interface SequenceModalProps {
  pendingKeys: HotkeySequence
  isAwaitingSequence: boolean
  timeoutStartedAt?: number | null
  sequenceTimeout?: number
}

export function SequenceModal({
  pendingKeys,
  isAwaitingSequence,
  timeoutStartedAt,
  sequenceTimeout = 1000,
}: SequenceModalProps) {
  const { getCompletions, registry } = useDynamicHotkeysContext()

  // Get completions for the current pending keys
  const completions = useMemo(() => {
    if (pendingKeys.length === 0) return []
    return getCompletions(pendingKeys)
  }, [getCompletions, pendingKeys])

  // Format pending keys for display
  const formattedPendingKeys = useMemo(() => {
    if (pendingKeys.length === 0) return ''
    return formatCombination(pendingKeys).display
  }, [pendingKeys])

  // Get human-readable label for an action from registry
  const getActionLabel = (actionId: string) => {
    const action = registry.actions.get(actionId)
    return action?.config.label || actionId
  }

  // Group completions by what happens next
  // Each completion shows: nextKeys → actionLabel
  const groupedCompletions = useMemo(() => {
    // Create map of nextKey -> completions
    const byNextKey = new Map<string, SequenceCompletion[]>()
    for (const c of completions) {
      const existing = byNextKey.get(c.nextKeys)
      if (existing) {
        existing.push(c)
      } else {
        byNextKey.set(c.nextKeys, [c])
      }
    }
    return byNextKey
  }, [completions])

  // Don't render if not awaiting sequence or no pending keys
  if (!isAwaitingSequence || pendingKeys.length === 0) {
    return null
  }

  return (
    <div className="sequence-modal-backdrop">
      <div className="sequence-modal">
        {/* Current sequence at top */}
        <div className="sequence-current">
          <kbd className="sequence-keys">{formattedPendingKeys}</kbd>
          <span className="sequence-ellipsis">…</span>
        </div>

        {/* Timeout progress bar */}
        {timeoutStartedAt && (
          <div
            className="sequence-timeout-bar"
            key={timeoutStartedAt}
            style={{ animationDuration: `${sequenceTimeout}ms` }}
          />
        )}

        {/* Completions list */}
        {completions.length > 0 && (
          <div className="sequence-completions">
            {Array.from(groupedCompletions.entries()).map(([nextKey, comps]) => (
              <div key={nextKey} className="sequence-completion">
                <kbd className="completion-key">{nextKey.toUpperCase()}</kbd>
                <span className="completion-arrow">→</span>
                <span className="completion-actions">
                  {comps.flatMap(c => c.actions).map((action, i) => (
                    <span key={action} className="completion-action">
                      {i > 0 && ', '}
                      {getActionLabel(action)}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* No completions message */}
        {completions.length === 0 && (
          <div className="sequence-no-match">
            No matching shortcuts
          </div>
        )}
      </div>
    </div>
  )
}
