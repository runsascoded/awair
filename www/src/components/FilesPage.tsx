import { FileTree } from '@rdub/file-tree/react'
import { ParquetViewer } from '@rdub/file-tree/renderers/parquet'
import { HttpStore } from '@rdub/file-tree/stores/http'
import { useMemo } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { PYRMTS_ORIGIN } from '../services/awairService'
import './FilesPage.scss'

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
  return (
    <BrowserRouter>
      <div className="files-page">
        <FileTree
          store={store}
          routeBase="/files"
          title="Pyramid shards"
          parquetRenderer={ParquetViewer}
        />
      </div>
    </BrowserRouter>
  )
}
