import { mergeGaps, parseSnapshot, type DataGap } from '../../shared/raw-source'

/** Source-confirmed measurement loss is separate from missing processing work. */
export async function readDataGaps(r2: R2Bucket, rawKeys: Set<string>): Promise<DataGap[]> {
  const gaps: DataGap[] = []
  for (const key of rawKeys) {
    if (!key.includes('/raw/_sources/') || !key.endsWith('.json')) continue
    const obj = await r2.get(key)
    if (obj === null) throw new Error(`Raw source evidence disappeared: ${key}`)
    const snapshot = parseSnapshot(await obj.json())
    gaps.push(...snapshot.gaps)
  }
  return mergeGaps(gaps)
}
