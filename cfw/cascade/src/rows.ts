import { parquetReadObjects } from 'hyparquet'
import { ByteWriter, ParquetWriter, schemaFromColumnData } from 'hyparquet-writer'
import { PYRAMID_CONFIG } from './pyramid'

/** Match pyrmts' initial metadata fetch window. */
export const FOOTER_CACHE_SIZE = 64 * 1024

export const METRIC_NAMES = PYRAMID_CONFIG.metrics.map(m => m.name)
const STATE_SUFFIXES = ['_n', '_sum', '_sumsq'] as const

export interface AwairRow {
  ts: number             // ms since epoch (source parquet stores INT64 → we normalize to number)
  device_id: number
  [stateCol: string]: number
}

/** Coerce a hyparquet cell (bigint | number | string | null) to a plain JS number. */
function asNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'number') return v
  return Number(v)
}

/** Read one source shard from R2, filter rows to `[effStart, effEnd)` in ms. */
export async function readSourceShard(
  r2: R2Bucket,
  key: string,
  effStartMs: number,
  effEndMs: number,
): Promise<AwairRow[] | null> {
  const obj = await r2.get(key)
  if (obj === null) return null
  const buf = await obj.arrayBuffer()
  const raw = (await parquetReadObjects({ file: buf })) as Record<string, unknown>[]
  const rows: AwairRow[] = []
  for (const r of raw) {
    const ts = asNum(r['ts'])
    if (ts < effStartMs || ts >= effEndMs) continue
    const out: AwairRow = { ts, device_id: asNum(r['device_id']) }
    for (const m of METRIC_NAMES) {
      for (const suf of STATE_SUFFIXES) {
        const col = `${m}${suf}`
        out[col] = asNum(r[col])
      }
    }
    rows.push(out)
  }
  return rows
}

/**
 * Sum-monoid coarsen: bucket rows by `floor(ts, targetBinMs)` and
 * column-wise sum every `{metric}{_n,_sum,_sumsq}` field per bucket.
 *
 * Emits sorted-by-ts output. `device_id` is constant per-shard, so
 * we assert that assumption and carry it forward on the output rows.
 */
export function coarsen(rows: AwairRow[], targetBinMs: number, deviceId: number): AwairRow[] {
  const buckets = new Map<number, AwairRow>()
  for (const row of rows) {
    if (row.device_id !== deviceId) {
      throw new Error(`coarsen: expected device_id=${deviceId}, got ${row.device_id}`)
    }
    const binTs = Math.floor(row.ts / targetBinMs) * targetBinMs
    let out = buckets.get(binTs)
    if (out === undefined) {
      out = { ts: binTs, device_id: deviceId }
      for (const m of METRIC_NAMES) for (const s of STATE_SUFFIXES) out[`${m}${s}`] = 0
      buckets.set(binTs, out)
    }
    for (const m of METRIC_NAMES) {
      for (const s of STATE_SUFFIXES) {
        const col = `${m}${s}`
        out[col] = (out[col] as number) + (row[col] as number)
      }
    }
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts)
}

/** Column layout matching the Python builder output (`aggregate_raw` /
 *  `coarsen` in `src/awair/pyramid/builder.py`). */
function rowsToColumns(rows: AwairRow[]) {
  const cols: Array<{ name: string; data: unknown[]; type: 'INT64' | 'INT32' | 'DOUBLE' }> = []
  cols.push({ name: 'ts',        data: rows.map(r => BigInt(r.ts)),        type: 'INT64' })
  cols.push({ name: 'device_id', data: rows.map(r => r.device_id),          type: 'INT32' })
  for (const m of METRIC_NAMES) {
    cols.push({ name: `${m}_n`,     data: rows.map(r => r[`${m}_n`]     as number), type: 'INT32'  })
    cols.push({ name: `${m}_sum`,   data: rows.map(r => r[`${m}_sum`]   as number), type: 'DOUBLE' })
    cols.push({ name: `${m}_sumsq`, data: rows.map(r => r[`${m}_sumsq`] as number), type: 'DOUBLE' })
  }
  return cols
}

/** Serialize rows to a parquet byte buffer. */
export function encodeShard(rows: AwairRow[]): Uint8Array {
  const columnData = rowsToColumns(rows)
  const schema = schemaFromColumnData({ columnData })
  const bw = new ByteWriter(64 * 1024)
  // Keep the existing uncompressed encoding; SNAPPY needs a bundled
  // compressor and ZSTD needs a wasm module.
  const pq = new ParquetWriter({ writer: bw, schema })
  pq.write({ columnData })
  pq.finish()
  return new Uint8Array(bw.buffer, 0, bw.index)
}
