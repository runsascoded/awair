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
import { cloneElement, type ReactElement, type ReactNode, useState } from 'react'

interface TooltipProps {
  children: ReactElement
  content: ReactNode
  maxWidth?: number
}

/**
 * Adapter for use-kbd's TooltipComponent interface.
 * Wraps children in a span to ensure cloneability.
 */
interface KbdTooltipProps {
  title: string
  children: ReactNode
}

export function KbdTooltip({ title, children }: KbdTooltipProps) {
  return (
    <Tooltip content={title}>
      <span style={{ display: 'contents' }}>{children}</span>
    </Tooltip>
  )
}

export function Tooltip({ children, content, maxWidth = 300 }: TooltipProps) {
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
      {cloneElement(children, getReferenceProps({ ref: refs.setReference, ...(children.props as Record<string, unknown>) }))}
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className="tooltip-content"
            style={{
              ...floatingStyles,
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              color: 'white',
              padding: '6px 10px',
              borderRadius: '4px',
              fontSize: '13px',
              maxWidth,
              zIndex: 10000,
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
