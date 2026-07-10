// Device list for cascade Phase 1a. Hardcoded here (mirrors `cfw/monitor`
// style) — cheap and lets Phase 1a ship without a D1 devices table.
// Phase 1b migrates this to D1 alongside the ShardIndex tables.
//
// `genesisDate` is each device's earliest S3 monthly shard (first-of-
// month UTC). pyrmts uses it via `filter={device_id, genesisDate}` to
// clip shard `effective{Start,End}` — a shard straddling genesis emits
// `inputsExpected` counting only post-genesis source periods, not
// pre-existent-source ones that will never materialize.

export interface Device {
  id: number
  name: string
  // First-of-month UTC of the device's earliest raw shard. Cheap approx
  // (a few extra pre-genesis-day tiles for the current month at that
  // resolution — negligible cost).
  genesisDate: Date
}

// Sourced from `aws s3 ls s3://380nwk/awair-<id>/` — first monthly shard
// present. Update when a new device is provisioned.
export const DEVICES: Device[] = [
  { id: 17617,  name: 'Gym',  genesisDate: new Date('2025-06-01T00:00:00Z') },
  { id: 137496, name: 'BR',   genesisDate: new Date('2025-11-01T00:00:00Z') },
  { id: 137506, name: 'RT',   genesisDate: new Date('2025-12-01T00:00:00Z') },
  { id: 136824, name: 'Desk', genesisDate: new Date('2026-02-01T00:00:00Z') },
]
