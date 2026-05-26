/**
 * Data source interface for fetching Awair time-series data.
 * Multiple implementations can be benchmarked against each other.
 */

import type { AwairRecord } from '../types/awair'

export interface TimeRange {
  /** Start time (inclusive) */
  from: Date
  /** End time (inclusive) */
  to: Date
}

export interface FetchOptions {
  /** Device ID to fetch data for */
  deviceId: number
  /** Time range to fetch */
  range: TimeRange
  /** Optional: specific columns to fetch (default: all) */
  columns?: (keyof AwairRecord)[]
  /** Optional: maximum bins the source should return (pyrmts uses this to pick a tier). */
  binBudget?: number
  /**
   * Optional smoothing window. Numeric = minutes (≤1 means "off").
   * String = pyrmts Duration syntax (`'4h'`, `'30min'`, `'1d'`) or
   * `'auto'` / `'auto25'` etc. — passed through to the worker which
   * snaps it to a representable width and returns the chosen value
   * back on `plan.smoothing.smoothBin`.
   */
  smoothing?: number | string
}

export interface FetchResult {
  /** The fetched records */
  records: AwairRecord[]
  /** Performance metrics */
  timing: FetchTiming
  /** S3 file's Last-Modified timestamp (for smart polling) */
  lastModified?: Date
}

export interface FetchTiming {
  /** Total time from request to data ready (ms) */
  totalMs: number
  /** Network time (ms) - time spent fetching data */
  networkMs: number
  /** Parse/processing time (ms) */
  parseMs: number
  /** Bytes transferred over network */
  bytesTransferred: number
  /** Data source identifier */
  source: DataSourceType
}

// Only pyrmts-cfw is wired today. `HyparquetSource` was retired in favor of
// pyrmts (see `specs/pyrmts-migration.md`). Type kept as a union so future
// sources (s3-duckdb-wasm, lambda, etc.) can plug in via the same interface.
export type DataSourceType = 'pyrmts-cfw'

/**
 * Abstract interface for data sources.
 * Implementations must provide time-range based fetching.
 */
export interface DataSource {
  /** Identifier for this data source */
  readonly type: DataSourceType

  /** Human-readable name */
  readonly name: string

  /**
   * Fetch records within a time range.
   * Implementations should optimize to fetch minimal data.
   */
  fetch(options: FetchOptions): Promise<FetchResult>

  /**
   * Optional: Check if this data source is available/initialized.
   * Some sources (e.g., DuckDB-WASM) may need async initialization.
   */
  isReady?(): Promise<boolean>

  /**
   * Optional: Pre-warm or initialize the data source.
   * Called once on app startup if available.
   */
  initialize?(): Promise<void>
}

/**
 * Log fetch timing to console in a consistent format.
 */
export function logFetchTiming(timing: FetchTiming): void {
  const { totalMs, networkMs, parseMs, bytesTransferred, source } = timing
  const kbTransferred = (bytesTransferred / 1024).toFixed(1)
  console.log(
    `📊 [${source}] ${totalMs.toFixed(0)}ms total ` +
    `(${networkMs.toFixed(0)}ms network, ${parseMs.toFixed(0)}ms parse) ` +
    `${kbTransferred} KB`
  )
}
