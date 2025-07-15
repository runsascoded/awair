import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal
} from '@floating-ui/react'
import React, { useState } from 'react'
import type { DataSummary as DataSummaryType } from '../types/awair'

// Simple tooltip component
function Tooltip({ children, content }: { children: React.ReactElement; content: string }) {
  const [isOpen, setIsOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'top',
    middleware: [
      offset(5),
      flip(),
      shift()
    ],
    whileElementsMounted: autoUpdate,
  })

  const hover = useHover(context)
  const focus = useFocus(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ])

  return (
    <>
      {React.cloneElement(children, getReferenceProps({ ref: refs.setReference, ...children.props }))}
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              color: 'white',
              padding: '6px 10px',
              borderRadius: '4px',
              fontSize: '13px',
              maxWidth: '300px',
              zIndex: 1000,
            }}
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}

interface Props {
  summary: DataSummaryType;
}

export function DataSummary({ summary }: Props) {
  const formatCompactDate = (date: Date) => {
    const currentYear = new Date().getFullYear()
    const dateYear = date.getFullYear()

    const month = String(date.getMonth() + 1)
    const day = String(date.getDate())
    const hours = date.getHours()
    const minutes = String(date.getMinutes()).padStart(2, '0')

    // Convert to 12-hour format
    const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    const ampm = hours < 12 ? 'a' : 'p'

    // Include year only if different from current year (2-digit)
    const yearPart = dateYear !== currentYear ? `/${String(dateYear).slice(-2)}` : ''

    return `${month}/${day}${yearPart} ${hour12}:${minutes}${ampm}`
  }

  const formatFullDate = (date: Date) => {
    const month = String(date.getMonth() + 1)
    const day = String(date.getDate())
    const year = String(date.getFullYear()).slice(-2)
    const hours = date.getHours()
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')

    // Convert to 12-hour format
    const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    const ampm = hours < 12 ? 'am' : 'pm'

    return `${month}/${day}/${year} ${hour12}:${minutes}:${seconds}${ampm}`
  }

  return (
    <div className="data-summary">
      <Tooltip content="Data updated every 3 minutes">
        <h2 style={{ cursor: 'help' }}>Awair Data Summary</h2>
      </Tooltip>
      <div className="summary-grid">
        <div className="summary-item">
          <span className="label">Total Records:</span>
          <span className="value">{summary.count.toLocaleString()}</span>
        </div>
        <div className="summary-item">
          <span className="label">Date Range:</span>
          <span className="value">{summary.dateRange}</span>
        </div>
        {summary.latest && (
          <div className="summary-item">
            <span className="label">Latest Reading:</span>
            <Tooltip content={formatFullDate(new Date(summary.latest))}>
              <span className="value" style={{ cursor: 'help' }}>
                {formatCompactDate(new Date(summary.latest))}
              </span>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  )
}
