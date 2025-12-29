import { createTwoColumnRenderer, type TwoColumnRow } from 'use-kbd'
import { Tooltip } from './Tooltip'

// Metric display labels with tooltips
const METRIC_LABELS: Record<string, TwoColumnRow['label']> = {
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
  none: (
    <Tooltip content="Only applies to right Y-axis; left Y-axis always requires a metric">
      <span className="tooltip-trigger">None ⓘ</span>
    </Tooltip>
  ),
}

// Metrics in display order
const METRICS = ['temp', 'co2', 'humid', 'pm25', 'voc', 'autorange', 'none']

/**
 * Y-Axis Metrics: 2-column table pairing left:X with right:X
 */
export const YAxisMetricsRenderer = createTwoColumnRenderer({
  headers: ['Metric', 'Left', 'Right'],
  getRows: () => METRICS.map(m => ({
    label: METRIC_LABELS[m] ?? m,
    leftAction: `left:${m}`,
    rightAction: `right:${m}`,
  })),
})

/**
 * Table Navigation: 2-column table pairing prev/next actions
 */
export const TableNavigationRenderer = createTwoColumnRenderer({
  headers: ['Navigation', 'Back', 'Forward'],
  getRows: () => [
    { label: 'Table page', leftAction: 'table:prev-page', rightAction: 'table:next-page' },
    { label: 'Plot page', leftAction: 'table:prev-plot-page', rightAction: 'table:next-plot-page' },
    { label: 'All pages', leftAction: 'table:first-page', rightAction: 'table:last-page' },
  ],
})
