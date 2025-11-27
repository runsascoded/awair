import { useUrlParam } from '@rdub/use-url-params'
import { useCallback } from 'react'
import { defaultYAxesParam, type Metric } from '../lib/urlParams'

export type MetricsState = {
  l: { val: Metric, set: (metric: Metric) => void }
  r: { val: Metric | 'none', set: (metric: Metric | 'none') => void }
  fromZero: { val: boolean, set: (val: boolean) => void }
}

/**
 * Hook to manage Y-axes state (primary/left, secondary/right, and fromZero)
 * Persists state in URL as compact param (?y=tc for temp+CO2, ?y=tcZ for fromZero=false)
 */
export function useMetrics(): MetricsState {
  const [yAxes, setYAxes] = useUrlParam('y', defaultYAxesParam)

  // Left (primary) axis
  const setLeft = useCallback((metric: Metric) => {
    setYAxes({ l: metric, r: yAxes.r, fromZero: yAxes.fromZero })
  }, [yAxes.r, yAxes.fromZero, setYAxes])

  // Right (secondary) axis
  const setRight = useCallback((metric: Metric | 'none') => {
    setYAxes({ l: yAxes.l, r: metric, fromZero: yAxes.fromZero })
  }, [yAxes.l, yAxes.fromZero, setYAxes])

  // From zero setting
  const setFromZero = useCallback((val: boolean) => {
    setYAxes({ l: yAxes.l, r: yAxes.r, fromZero: val })
  }, [yAxes.l, yAxes.r, setYAxes])

  return {
    l: {
      val: yAxes.l,
      set: setLeft,
    },
    r: {
      val: yAxes.r,
      set: setRight,
    },
    fromZero: {
      val: yAxes.fromZero,
      set: setFromZero,
    },
  }
}
