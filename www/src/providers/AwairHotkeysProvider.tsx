import { DynamicHotkeysProvider } from '@rdub/use-hotkeys'
import type { ReactNode } from "react"

interface AwairHotkeysProviderProps {
  children: ReactNode
}

/**
 * Awair-specific wrapper around DynamicHotkeysProvider.
 * Actions are registered by individual components using useAction.
 */
export function AwairHotkeysProvider({ children }: AwairHotkeysProviderProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <DynamicHotkeysProvider config={{ storageKey: 'awair-hotkeys' }} children={children as any} />
}
