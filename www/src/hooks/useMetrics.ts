import { useCallback } from 'react'
import { useUrlParam } from 'use-prms'
import { defaultYAxesParam, type Metric } from '../lib/urlParams'

export type MetricsState = {
  l: { val: Metric, set: (metric: Metric) => void, autoRange: boolean, setAutoRange: (val: boolean) => void }
  r: { val: Metric | 'none', set: (metric: Metric | 'none') => void, autoRange: boolean, setAutoRange: (val: boolean) => void }
}

/**
 * Hook to manage Y-axes state (primary/left, secondary/right, and per-axis auto-range)
 * Persists state in URL as compact param (?y=tc for temp+CO2, ?y=tca for temp auto-range + CO2 tozero)
 */
export function useMetrics(): MetricsState {
  const [yAxes, setYAxes] = useUrlParam('y', defaultYAxesParam)

  // Left (primary) axis metric
  const setLeft = useCallback((metric: Metric) => {
    setYAxes({ l: metric, r: yAxes.r, lAutoRange: yAxes.lAutoRange, rAutoRange: yAxes.rAutoRange })
  }, [yAxes.r, yAxes.lAutoRange, yAxes.rAutoRange, setYAxes])

  // Right (secondary) axis metric
  const setRight = useCallback((metric: Metric | 'none') => {
    setYAxes({ l: yAxes.l, r: metric, lAutoRange: yAxes.lAutoRange, rAutoRange: yAxes.rAutoRange })
  }, [yAxes.l, yAxes.lAutoRange, yAxes.rAutoRange, setYAxes])

  // Left axis auto-range
  const setLeftAutoRange = useCallback((val: boolean) => {
    setYAxes({ l: yAxes.l, r: yAxes.r, lAutoRange: val, rAutoRange: yAxes.rAutoRange })
  }, [yAxes.l, yAxes.r, yAxes.rAutoRange, setYAxes])

  // Right axis auto-range
  const setRightAutoRange = useCallback((val: boolean) => {
    setYAxes({ l: yAxes.l, r: yAxes.r, lAutoRange: yAxes.lAutoRange, rAutoRange: val })
  }, [yAxes.l, yAxes.r, yAxes.lAutoRange, setYAxes])

  return {
    l: {
      val: yAxes.l,
      set: setLeft,
      autoRange: yAxes.lAutoRange,
      setAutoRange: setLeftAutoRange,
    },
    r: {
      val: yAxes.r,
      set: setRight,
      autoRange: yAxes.rAutoRange,
      setAutoRange: setRightAutoRange,
    },
  }
}
