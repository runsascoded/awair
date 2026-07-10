// Device list — Phase 1b source is D1 (schema in `migrations/0002_devices.sql`).
// Refreshed by `awair api devices --refresh` (dual-writes S3 parquet + D1
// during the transition); FE reads from `cfw/serve /devices` which
// consults this same table.

export interface Device {
  id: number
  name: string
  // First-of-month UTC of the device's earliest raw shard, as ms since
  // epoch. pyrmts uses it to clip shard `effective{Start,End}` around
  // range boundaries so pre-genesis periods don't count as "missing
  // inputs".
  genesisDate: Date
}

/** Read active devices from D1. Ordered by `device_id` so per-device
 *  reports have a stable device sequence across ticks. */
export async function readDevices(db: D1Database): Promise<Device[]> {
  const stmt = db.prepare(
    'SELECT device_id, name, genesis_ts FROM devices WHERE active = 1 ORDER BY device_id',
  )
  const { results } = await stmt.all<{ device_id: number; name: string; genesis_ts: number }>()
  return results.map(r => ({
    id: r.device_id,
    name: r.name,
    genesisDate: new Date(r.genesis_ts),
  }))
}
