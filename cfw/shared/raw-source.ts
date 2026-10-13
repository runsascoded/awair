/** Closed-month reconciliation evidence, kept separately from shard inventory. */
export interface DataGap {
  start: number
  end: number
}

export interface RawSourceSnapshot {
  version: 1
  month: string
  sourceUrl: string
  sourceEtag: string
  reconciledAt: number
  start: number
  end: number
  rows: number
  gaps: DataGap[]
}

export function sourcePrefix(deviceId: number): string {
  return `pyramid/awair-${deviceId}/raw/_sources/`
}

export function parseSnapshot(value: unknown): RawSourceSnapshot {
  const s = value as Partial<RawSourceSnapshot> | null
  if (s === null || typeof s !== 'object' || s.version !== 1 ||
      typeof s.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(s.month) ||
      typeof s.sourceUrl !== 'string' || typeof s.sourceEtag !== 'string' ||
      !Number.isFinite(s.reconciledAt) || !Number.isFinite(s.start) || !Number.isFinite(s.end) ||
      !(s.start! < s.end!) || !Number.isInteger(s.rows) || s.rows! < 0 || !Array.isArray(s.gaps)) {
    throw new Error('Invalid raw source snapshot')
  }
  for (const gap of s.gaps) {
    if (!Number.isFinite(gap.start) || !Number.isFinite(gap.end) ||
        !(s.start! <= gap.start && gap.start < gap.end && gap.end <= s.end!)) {
      throw new Error('Invalid raw source gap')
    }
  }
  return s as RawSourceSnapshot
}

/** Merge adjoining monthly gap fragments for display. */
export function mergeGaps(gaps: DataGap[]): DataGap[] {
  const merged: DataGap[] = []
  for (const gap of [...gaps].sort((a, b) => a.start - b.start)) {
    const prev = merged[merged.length - 1]
    if (prev !== undefined && gap.start <= prev.end) prev.end = Math.max(prev.end, gap.end)
    else merged.push({ ...gap })
  }
  return merged
}
