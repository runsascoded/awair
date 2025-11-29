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
  deviceAggregations: DeviceAggregatedData[];
  selectedDeviceId?: number;
  onDeviceChange: (deviceId: number) => void;
  latestModeIntended: boolean;
  xAxisRange: [string, string] | null;
  shiftTimeWindow: (shiftMs: number) => void;
  jumpToEarliest: () => void;
  onJumpToLatest: () => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
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

export function DataTable({ data, formatCompactDate, formatFullDate, isRawData, totalDataCount, windowLabel, plotStartTime, plotEndTime, fullDataStartTime, fullDataEndTime, windowMinutes, deviceAggregations, selectedDeviceId, onDeviceChange, latestModeIntended, xAxisRange, shiftTimeWindow, jumpToEarliest, onJumpToLatest, pageSize, onPageSizeChange }: Props) {
  const [page, setPage] = useState(0)

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
    // When windowsAfterPlot is negative (Latest mode buffer), we're viewing the most recent data
    // In that case, just use simple 1-indexed positions within the view
    if (windowsAfterPlot < 0) {
      return {
        globalStartIdx: startIdx + 1,
        globalEndIdx: endIdx
      }
    }

    // Otherwise calculate positions relative to full dataset
    const globalStart = Math.max(1, windowsAfterPlot + startIdx + 1)
    const globalEnd = Math.max(globalStart, windowsAfterPlot + endIdx)

    return { globalStartIdx: globalStart, globalEndIdx: globalEnd }
  }, [plotStartTime, plotEndTime, fullDataStartTime, fullDataEndTime, windowMinutes, startIdx, endIdx])

  // Check if we're at earliest data boundary
  const isAtEarliest = useMemo(() => {
    if (!xAxisRange || !fullDataStartTime) return false
    const plotStart = new Date(xAxisRange[0])
    const dataStart = fullDataStartTime
    // Within 1 minute of earliest
    return Math.abs(plotStart.getTime() - dataStart.getTime()) < 60 * 1000
  }, [xAxisRange, fullDataStartTime])

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
                onPageSizeChange(newSize)
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
                jumpToEarliest()
                setPage(0)
              }}
              disabled={isAtEarliest}
              title="Jump to earliest data"
              className="btn"
            >
              <i className="fas fa-backward-step"></i>
            </button>
            <button
              onClick={() => {
                if (!xAxisRange) return
                const rangeWidth = new Date(xAxisRange[1]).getTime() - new Date(xAxisRange[0]).getTime()
                shiftTimeWindow(-rangeWidth)
                setPage(0)
              }}
              disabled={isAtEarliest}
              title="Pan backward by plot width"
              className="btn"
            >
              <i className="fas fa-angles-left"></i>
            </button>
            <button
              onClick={() => {
                const pageShiftMs = pageSize * windowMinutes * 60 * 1000
                shiftTimeWindow(-pageShiftMs)
                setPage(0)
              }}
              disabled={isAtEarliest}
              title="Pan backward by one page"
              className="btn"
            >
              <i className="fas fa-angle-left"></i>
            </button>
            <span>
              {globalStartIdx.toLocaleString()}-{globalEndIdx.toLocaleString()} of {totalDataCount.toLocaleString()} × {windowLabel}
            </span>
            <button
              onClick={() => {
                const pageShiftMs = pageSize * windowMinutes * 60 * 1000
                shiftTimeWindow(pageShiftMs)
                setPage(0)
              }}
              disabled={latestModeIntended}
              title="Pan forward by one page"
              className="btn"
            >
              <i className="fas fa-angle-right"></i>
            </button>
            <button
              onClick={() => {
                if (!xAxisRange) return
                const rangeWidth = new Date(xAxisRange[1]).getTime() - new Date(xAxisRange[0]).getTime()
                shiftTimeWindow(rangeWidth)
                setPage(0)
              }}
              disabled={latestModeIntended}
              title="Pan forward by plot width"
              className="btn"
            >
              <i className="fas fa-angles-right"></i>
            </button>
            <button
              onClick={() => {
                onJumpToLatest()
                setPage(0)
              }}
              disabled={latestModeIntended}
              title="Jump to Latest"
              className="btn"
            >
              <i className="fas fa-forward-step"></i>
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
