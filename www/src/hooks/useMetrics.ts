import { useCallback } from 'react'
import { useUrlParam } from 'use-url-params'
import { defaultMetricsParam, type Metric } from '../lib/urlParams'

export type MetricsState = {
  l: { val: Metric, set: (metric: Metric) => void }
  r: { val: Metric | 'none', set: (metric: Metric | 'none') => void }
}

/**
 * Hook to manage metrics state (primary/left and secondary/right axes)
 * Persists state in URL as compact param (?m=tc for temp+CO2)
 */
export function useMetrics(): MetricsState {
  const [metrics, setMetrics] = useUrlParam('m', defaultMetricsParam)

  // Left (primary) axis
  const setLeft = useCallback((metric: Metric) => {
    setMetrics({ l: metric, r: metrics.r })
  }, [metrics.r, setMetrics])

  // Right (secondary) axis
  const setRight = useCallback((metric: Metric | 'none') => {
    setMetrics({ l: metrics.l, r: metric })
  }, [metrics.l, setMetrics])

  return {
    l: {
      val: metrics.l,
      set: setLeft,
    },
    r: {
      val: metrics.r,
      set: setRight,
    },
  }
}
