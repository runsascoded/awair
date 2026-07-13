/**
 * Offline smoke test: run the full pyrmts read path (planQuery →
 * fetchSegmentRows → stitch) against pyramid shards on local disk.
 *
 * Validates end-to-end that:
 *   1. The shards `awair pyramid build` writes are parquet-readable.
 *   2. The schema (cols, dtypes) matches what pyrmts expects.
 *   3. The planner picks a sensible tier for typical chart queries.
 *   4. Stitching produces the expected number of bins.
 *
 * Run via `node --experimental-strip-types scripts/smoke-test.ts`.
 * Requires shards under `<repo>/tmp/pyramid/awair-<id>/<tier>/<period>.parquet`.
 */

import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  fetchSegmentRows,
  parsePyramidYaml,
  planQuery,
  pyramidFromConfig,
  stitch,
  type Storage,
} from 'pyrmts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../..')
const SHARD_BASE = join(REPO_ROOT, 'tmp')

// Storage adapter backed by the local filesystem. The key string is treated as
// a path under SHARD_BASE.
function fsStorage(root: string): Storage {
  return {
    async head(key) {
      try {
        const s = await stat(join(root, key))
        return { size: s.size }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    },
    async getRange(key, start, end) {
      const buf = await readFile(join(root, key))
      return new Uint8Array(buf.buffer, buf.byteOffset + start, end - start)
    },
    async get(key) {
      try {
        const buf = await readFile(join(root, key))
        return new Uint8Array(buf)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    },
    async put() {
      throw new Error('fsStorage smoke test: put not implemented')
    },
    async *list() {
      throw new Error('fsStorage smoke test: list not implemented')
    },
  }
}

async function main(): Promise<void> {
  const yamlText = await readFile(join(REPO_ROOT, 'src/awair/pyramid.yml'), 'utf-8')
  const config = parsePyramidYaml(yamlText)
  const pyramid = pyramidFromConfig(config, fsStorage(SHARD_BASE))

  console.log('Pyramid:', {
    tiers: pyramid.tiers.map(t => `${t.name} (bin=${t.bin}, shard=${t.shards[t.shards.length - 1]})`),
    dims: pyramid.dims.map(d => d.name),
    metrics: pyramid.metrics.map(m => `${m.name} (${m.monoid})`),
  })

  // Query the full month of May 2026 for Gym, asking for ~30 bins (≈ daily).
  const range = { from: new Date('2026-05-01T00:00:00Z'), to: new Date('2026-06-01T00:00:00Z') }
  const filter = { device_id: '17617' }

  for (const binBudget of [10, 50, 200, 1000, 50_000]) {
    const plan = planQuery(pyramid, { range, binBudget, filter })
    const shardRows = await Promise.all(
      plan.segments.map(seg => fetchSegmentRows(pyramid.storage, seg.keys, {
        binCol: pyramid.binCol,
        range: { from: seg.from, to: seg.to },
        tolerate404: true,
      })),
    )
    const records = stitch({ pyramid, plan, shardRows })
    console.log(
      `\nbinBudget=${binBudget.toString().padStart(6)} → tier=${plan.outputTier.name.padEnd(4)} bin=${plan.outputBin.padEnd(6)} records=${records.length}`,
    )
    console.log(
      `  segments: ${plan.segments.map(s => `${s.shardTier.name}[${s.keys.length}]`).join(', ')}`,
    )
    if (records.length > 0 && records.length <= 5) {
      for (const r of records) {
        const ts = new Date(r.ts as number).toISOString()
        const mean = (r.temp_sum as number) / (r.temp_n as number)
        console.log(`    ${ts}  temp_n=${r.temp_n}  mean(temp)=${mean.toFixed(2)}`)
      }
    } else if (records.length > 0) {
      const first = records[0]
      const last = records[records.length - 1]
      if (first !== undefined && last !== undefined) {
        console.log(`    first: ${new Date(first.ts as number).toISOString()}  last: ${new Date(last.ts as number).toISOString()}`)
      }
    }
  }
}

await main()
