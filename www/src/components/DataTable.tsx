import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal
} from '@floating-ui/react'
import React, { useState, useMemo } from 'react'

interface AggregatedData {
  timestamp: Date;
  temp_avg: number;
  temp_stddev: number;
  co2_avg: number;
  co2_stddev: number;
  humid_avg: number;
  humid_stddev: number;
  pm25_avg: number;
  pm25_stddev: number;
  voc_avg: number;
  voc_stddev: number;
  count: number;
}

interface DeviceAggregatedData {
  deviceId: number;
  deviceName: string;
  aggregatedData: AggregatedData[];
  isRawData: boolean;
}

interface Props {
  data: AggregatedData[];
  formatCompactDate: (date: Date) => string;
  formatFullDate: (date: Date) => string;
  isRawData: boolean;
  totalDataCount: number;
  windowLabel: string;
  plotStartTime?: string;
  plotEndTime?: string;
  fullDataStartTime?: Date;
  fullDataEndTime?: Date;
  windowMinutes: number;
  onPageChange?: (pageOffset: number) => void;
  onJumpToLatest?: () => void;
  deviceAggregations: DeviceAggregatedData[];
  selectedDeviceId?: number;
  onDeviceChange: (deviceId: number) => void;
}

// Simple tooltip component for table values
function ValueTooltip({ children, content }: { children: React.ReactElement; content: string }) {
  const [isOpen, setIsOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'top',
    middleware: [
      offset(5),
      flip(),
      shift()
    ],
    whileElementsMounted: autoUpdate,
  })

  const hover = useHover(context)
  const focus = useFocus(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ])

  return (
    <>
      {React.cloneElement(children, getReferenceProps({ ref: refs.setReference, ...(children.props as Record<string, unknown>) }))}
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              color: 'white',
              padding: '6px 10px',
              borderRadius: '4px',
              fontSize: '13px',
              maxWidth: '200px',
              zIndex: 1000,
            }}
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}

export function DataTable({ data, formatCompactDate, formatFullDate, isRawData, totalDataCount, windowLabel, plotStartTime, plotEndTime, fullDataStartTime, fullDataEndTime, windowMinutes, onPageChange, onJumpToLatest, deviceAggregations, selectedDeviceId, onDeviceChange }: Props) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)

  const handlePageChange = (newPage: number) => {
    const pageOffset = newPage - page
    console.log('📋 Table pagination:', { oldPage: page, newPage, pageOffset })
    setPage(newPage)
    if (onPageChange && pageOffset !== 0) {
      console.log('📋 Calling onPageChange with offset:', pageOffset)
      onPageChange(pageOffset)
    }
  }

  // Reverse the data to show most recent first (reverse chronological)
  const reversedData = [...data].reverse()

  const totalPages = Math.ceil(reversedData.length / pageSize)
  const startIdx = page * pageSize
  const endIdx = Math.min(startIdx + pageSize, reversedData.length)
  const pageData = reversedData.slice(startIdx, endIdx)

  // Calculate position within total dataset (reverse chronological)
  const { globalStartIdx, globalEndIdx } = useMemo(() => {
    if (!plotStartTime || !plotEndTime || !fullDataStartTime || !fullDataEndTime) {
      return { globalStartIdx: startIdx + 1, globalEndIdx: endIdx }
    }

    // Calculate how many windows from the end of full dataset to end of plot
    const fullEnd = fullDataEndTime.getTime()
    const plotEnd = new Date(plotEndTime).getTime()
    const windowsAfterPlot = Math.floor((fullEnd - plotEnd) / (windowMinutes * 60 * 1000))

    // In reverse chronological order, latest data has lowest indices
    // The current page shows windows starting from windowsAfterPlot + startIdx
    const globalStart = windowsAfterPlot + startIdx + 1
    const globalEnd = windowsAfterPlot + endIdx

    return { globalStartIdx: globalStart, globalEndIdx: globalEnd }
  }, [plotStartTime, plotEndTime, fullDataStartTime, fullDataEndTime, windowMinutes, startIdx, endIdx])

  return (
    <div className="data-table">
      <div className="header">
        <h3>{isRawData ? 'Raw Data' : 'Aggregated Data'}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {deviceAggregations.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label htmlFor="device-select" style={{ fontSize: '14px' }}>Device:</label>
              <select
                id="device-select"
                value={selectedDeviceId}
                onChange={(e) => onDeviceChange(parseInt(e.target.value))}
                style={{
                  padding: '4px 8px',
                  fontSize: '14px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-primary)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer'
                }}
              >
                {deviceAggregations.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.deviceName}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label htmlFor="rows-per-page" style={{ fontSize: '14px' }}>Rows:</label>
            <select
              id="rows-per-page"
              value={pageSize}
              onChange={(e) => {
                const newSize = parseInt(e.target.value)
                setPageSize(newSize)
                setPage(0) // Reset to first page when changing page size
              }}
              style={{
                padding: '4px 8px',
                fontSize: '14px',
                borderRadius: '4px',
                border: '1px solid var(--border-primary)',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </div>
          <div className="pagination">
            <button
              onClick={() => {
                if (plotStartTime && plotEndTime && onPageChange) {
                // Calculate how many pages needed to reach oldest data, then go to last page of that
                  const totalGlobalPages = Math.ceil(totalDataCount / 20)
                  const currentPagesInView = totalPages
                  const pagesNeededToReachOldest = totalGlobalPages - currentPagesInView + (totalPages - 1)
                  console.log('📋 Going to oldest data:', { totalGlobalPages, currentPagesInView, pagesNeededToReachOldest })
                  // Request navigation to oldest data and go to its last page
                  onPageChange(pagesNeededToReachOldest)
                } else {
                // No time filtering, just go to last page
                  handlePageChange(totalPages - 1)
                }
              }}
              disabled={
              // Disable if we're already at the last page AND we're viewing the oldest possible data
                page >= totalPages - 1 &&
              globalEndIdx >= totalDataCount
              }
              title="Oldest data"
              className="btn"
            >
              <i className="fas fa-angles-left"></i>
            </button>
            <button
              onClick={() => handlePageChange(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1 || globalEndIdx >= totalDataCount}
              title="Older data"
              className="btn"
            >
              <i className="fas fa-angle-left"></i>
            </button>
            <span>
              {globalStartIdx.toLocaleString()}-{globalEndIdx.toLocaleString()} of {totalDataCount.toLocaleString()} × {windowLabel}
            </span>
            <button
              onClick={() => {
                if (onPageChange && globalStartIdx > 20) {
                // We're not at latest data, so navigate toward latest (negative offset = toward present)
                  onPageChange(-1)
                  setPage(Math.max(0, page - 1))
                } else if (page > 0) {
                // We're at latest data but not on first page, go to previous page
                  handlePageChange(page - 1)
                }
              }}
              disabled={page === 0 && globalStartIdx <= 20}
              title="Newer data"
              className="btn"
            >
              <i className="fas fa-angle-right"></i>
            </button>
            <button
              onClick={() => {
                if (onJumpToLatest) {
                // Jump to Latest mode (like clicking the Latest button)
                  onJumpToLatest()
                  setPage(0) // Reset to first page
                } else {
                // Fallback to just going to first page
                  handlePageChange(0)
                }
              }}
              disabled={page === 0 && globalStartIdx <= 20}
              title="Jump to Latest"
              className="btn"
            >
              <i className="fas fa-angles-right"></i>
            </button>
          </div>
        </div>
      </div>

      <div className="container">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Temp (°F)</th>
              <th>Humidity (%)</th>
              <th>CO₂ (ppm)</th>
              <th>VOC (ppb)</th>
              <th>PM2.5 (μg/m³)</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((record, idx) => (
              <tr key={startIdx + idx}>
                <td>
                  {isRawData ? (
                    <ValueTooltip content={formatFullDate(record.timestamp)}>
                      <span style={{ cursor: 'help' }}>{formatCompactDate(record.timestamp)}</span>
                    </ValueTooltip>
                  ) : (
                    formatCompactDate(record.timestamp)
                  )}
                </td>
                <td>
                  {isRawData ? (
                    record.temp_avg.toFixed(1)
                  ) : (
                    <ValueTooltip content={`±σ: ${(record.temp_avg - record.temp_stddev).toFixed(1)} - ${(record.temp_avg + record.temp_stddev).toFixed(1)} °F${record.count > 1 ? ` | n = ${record.count}` : ''}`}>
                      <span style={{ cursor: 'help' }}>{record.temp_avg.toFixed(1)}</span>
                    </ValueTooltip>
                  )}
                </td>
                <td>
                  {isRawData ? (
                    record.humid_avg.toFixed(1)
                  ) : (
                    <ValueTooltip content={`±σ: ${(record.humid_avg - record.humid_stddev).toFixed(1)} - ${(record.humid_avg + record.humid_stddev).toFixed(1)} %${record.count > 1 ? ` | n = ${record.count}` : ''}`}>
                      <span style={{ cursor: 'help' }}>{record.humid_avg.toFixed(1)}</span>
                    </ValueTooltip>
                  )}
                </td>
                <td>
                  {isRawData ? (
                    Math.round(record.co2_avg)
                  ) : (
                    <ValueTooltip content={`±σ: ${Math.round(record.co2_avg - record.co2_stddev)} - ${Math.round(record.co2_avg + record.co2_stddev)} ppm${record.count > 1 ? ` | n = ${record.count}` : ''}`}>
                      <span style={{ cursor: 'help' }}>{Math.round(record.co2_avg)}</span>
                    </ValueTooltip>
                  )}
                </td>
                <td>
                  {isRawData ? (
                    Math.round(record.voc_avg)
                  ) : (
                    <ValueTooltip content={`±σ: ${Math.round(record.voc_avg - record.voc_stddev)} - ${Math.round(record.voc_avg + record.voc_stddev)} ppb${record.count > 1 ? ` | n = ${record.count}` : ''}`}>
                      <span style={{ cursor: 'help' }}>{Math.round(record.voc_avg)}</span>
                    </ValueTooltip>
                  )}
                </td>
                <td>
                  {isRawData ? (
                    record.pm25_avg.toFixed(1)
                  ) : (
                    <ValueTooltip content={`±σ: ${(record.pm25_avg - record.pm25_stddev).toFixed(1)} - ${(record.pm25_avg + record.pm25_stddev).toFixed(1)} μg/m³${record.count > 1 ? ` | n = ${record.count}` : ''}`}>
                      <span style={{ cursor: 'help' }}>{record.pm25_avg.toFixed(1)}</span>
                    </ValueTooltip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
