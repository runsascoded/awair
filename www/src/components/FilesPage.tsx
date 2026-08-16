import { FileTree } from '@rdub/file-tree/react'
import { makeJsonTreeRenderer } from '@rdub/file-tree/renderers/json'
import { ParquetViewer } from '@rdub/file-tree/renderers/parquet'
import { HttpStore } from '@rdub/file-tree/stores/http'
import { useCallback, useMemo } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { useDevices } from '../hooks/useDevices'
import { PYRMTS_ORIGIN } from '../services/awairService'
import './FilesPage.scss'

/** Device-id segment of a pyramid key, when the key *ends* at that
 *  segment (`pyramid/awair-17617/` — a device root, listed or crumbed).
 *  Deeper keys (`…/awair-17617/raw/1d/…`) are tier/shard paths, where
 *  the device is already established by the enclosing crumb. */
const DEVICE_DIR = /(?:^|\/)awair-(\d+)\/?$/

/** Invalidation-journal fields, all epoch *seconds* (float) — pyrmts
 *  writes `{start, end, requested_at}` per `specs/shard-invalidation.md`.
 *  Raw they're unreadable; annotated they're the whole point of the file. */
const TS_KEYS = new Set(['start', 'end', 'requested_at'])

const fmtEpochSec = (s: number) =>
  `${new Date(s * 1000).toISOString().slice(0, 19).replace('T', ' ')}Z`

/** Module-scope so the element type stays stable across renders (a new
 *  renderer identity each render would remount the viewer, dropping its
 *  expand/search state). */
const renderJson = makeJsonTreeRenderer({
  // The journal is an array of flat records, so the default (root only)
  // shows nothing but `[ {3 keys}, … ]` — depth 2 is the whole file.
  initialOpenDepth: 2,
  renderValue: ({ key, value, defaultNode }) =>
    key !== undefined && TS_KEYS.has(key) && typeof value === 'number' && Number.isFinite(value)
      ? <>{defaultNode}<span className="ft-ts">{fmtEpochSec(value)}</span></>
      : defaultNode,
})

/**
 * `/files/*` — `@rdub/file-tree` browser over the pyramid R2 bucket,
 * via `cfw/serve`'s `/files/{list,get}` endpoints (worker-proxy reads;
 * shards are small enough that presigned direct-from-R2 isn't worth
 * the token setup yet). Parquet paths render as a paginated table
 * (hyparquet, row-group fetch unit).
 *
 * Health-page shard rects and omnibar shard search deep-link here as
 * `/files/<r2-key>`.
 *
 * `FileTree` needs a react-router context for `useLocation`/`Link`
 * (in-tree navigation is pushState — no reloads while browsing); the
 * rest of the app is router-free, so the `BrowserRouter` lives here.
 */
export function FilesPage() {
  const store = useMemo(() => HttpStore(`${PYRMTS_ORIGIN}/files`), [])
  const { devices } = useDevices()

  // R2 keys identify devices by id (`awair-17617`); the dashboard knows
  // them by name ("Gym"). Annotate both listing rows and breadcrumbs so
  // the id→name translation isn't something you have to hold in your
  // head while browsing.
  const deviceName = useCallback(
    (key: string) => {
      const id = DEVICE_DIR.exec(key)?.[1]
      if (id === undefined) return null
      return devices.find(d => d.deviceId === Number(id))?.name ?? null
    },
    [devices],
  )

  return (
    <BrowserRouter>
      <div className="files-page">
        <FileTree
          store={store}
          routeBase="/files"
          title="Pyramid shards"
          parquetRenderer={ParquetViewer}
          // `pyramid/awair-_invalidations.json` is the only JSON in the
          // bucket today, but it's the one file you actually read by
          // hand. (The jq filter needs the optional `jq-web` peer;
          // without it the tree/search/copy-path still work.)
          jsonRenderer={renderJson}
          renderCell={({ entry, column, defaultNode }) => {
            if (column !== 'name') return defaultNode
            const name = deviceName(entry.key)
            return name === null
              ? defaultNode
              : <>{defaultNode}<span className="ft-device">{name}</span></>
          }}
          renderCrumb={({ crumb, defaultNode }) => {
            const name = deviceName(crumb.path ?? '')
            return name === null
              ? defaultNode
              : <>{defaultNode}<span className="ft-device">{name}</span></>
          }}
        />
      </div>
    </BrowserRouter>
  )
}
