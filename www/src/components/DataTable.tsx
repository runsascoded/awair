import React, { useMemo, useState } from 'react'
import { Tooltip } from './Tooltip'

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
  fullDataStartTime?: Date;
  fullDataEndTime?: Date;
  windowMinutes: number;
  deviceAggregations: DeviceAggregatedData[];
  selectedDeviceId?: number;
  onDeviceChange: (deviceId: number) => void;
  timeRange: { timestamp: Date | null; duration: number };
  setTimeRange: (range: { timestamp: Date | null; duration: number }) => void;
  formatForPlotly: (date: Date) => string;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}

export function DataTable({ data, formatCompactDate, formatFullDate, isRawData, totalDataCount, windowLabel, fullDataStartTime, fullDataEndTime, windowMinutes, deviceAggregations, selectedDeviceId, onDeviceChange, timeRange, setTimeRange, formatForPlotly: _formatForPlotly, pageSize, onPageSizeChange }: Props) {
  const [page, setPage] = useState(0)

  // Reverse the data to show most recent first (reverse chronological)
  const reversedData = [...data].reverse()

  const startIdx = page * pageSize
  const endIdx = Math.min(startIdx + pageSize, reversedData.length)
  const pageData = reversedData.slice(startIdx, endIdx)

  // Calculate position within total dataset (reverse chronological)
  // Based on timeRange.timestamp (from URL ?t= param)
  const { globalStartIdx, globalEndIdx } = useMemo(() => {
    if (!fullDataEndTime) {
      return { globalStartIdx: 1, globalEndIdx: pageSize }
    }

    const windowMs = windowMinutes * 60 * 1000
    const fullEnd = fullDataEndTime.getTime()

    // timeRange.timestamp = null means Latest mode (at index 1)
    // Otherwise, calculate index based on how far back from fullEnd we are
    const isLatestMode = timeRange.timestamp === null

    let firstVisibleIndex: number
    if (isLatestMode) {
      firstVisibleIndex = 1
    } else {
      const rangeEnd = timeRange.timestamp!.getTime()
      const windowsFromEnd = (fullEnd - rangeEnd) / windowMs
      // Round to handle millisecond precision mismatch between Parquet metadata and URL encoding
      firstVisibleIndex = Math.round(windowsFromEnd + 1)
    }

    const globalStart = Math.max(1, firstVisibleIndex)
    const globalEnd = globalStart + pageSize - 1

    console.log('📊 Table index calc:', {
      isLatestMode,
      rangeEnd: timeRange.timestamp ? new Date(timeRange.timestamp).toISOString() : 'null (latest)',
      fullEnd: new Date(fullEnd).toISOString(),
      diffMs: timeRange.timestamp ? fullEnd - timeRange.timestamp.getTime() : 0,
      diffMin: timeRange.timestamp ? (fullEnd - timeRange.timestamp.getTime()) / 60000 : 0,
      windowMs,
      windows: timeRange.timestamp ? (fullEnd - timeRange.timestamp.getTime()) / windowMs : 0,
      firstVisibleIndex,
      range: `${globalStart}-${globalEnd}`
    })

    return { globalStartIdx: globalStart, globalEndIdx: globalEnd }
  }, [fullDataEndTime, windowMinutes, pageSize, timeRange])

  // Check if we're at earliest data boundary
  const isAtEarliest = useMemo(() => {
    if (!fullDataStartTime || !timeRange.timestamp) return false
    const rangeStart = new Date(timeRange.timestamp.getTime() - timeRange.duration)
    // Within 1 minute of earliest
    return Math.abs(rangeStart.getTime() - fullDataStartTime.getTime()) < 60 * 1000
  }, [timeRange, fullDataStartTime])

  // Check if we're at or past latest data
  const isAtLatest = useMemo(() => {
    if (!fullDataEndTime) return false
    // In Latest mode
    if (timeRange.timestamp === null) return true
    // At or past the latest data - don't allow any forward movement
    return timeRange.timestamp.getTime() >= fullDataEndTime.getTime()
  }, [timeRange.timestamp, fullDataEndTime])

  return (
    <div className="data-table">
      <div className="header">
        <h3>{isRawData ? 'Raw Data' : 'Aggregated Data'}</h3>
        <div className="table-controls">
          <div className="selects-row">
            {deviceAggregations.length > 1 && (
              <select
                id="device-select"
                value={selectedDeviceId}
                onChange={(e) => onDeviceChange(parseInt(e.target.value))}
              >
                {deviceAggregations.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.deviceName}
                  </option>
                ))}
              </select>
            )}
            <div className="rows-picker">
              <label htmlFor="rows-per-page">Rows:</label>
              <select
                id="rows-per-page"
                value={pageSize}
                onChange={(e) => {
                  const newSize = parseInt(e.target.value)
                  onPageSizeChange(newSize)
                  setPage(0)
                }}
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
            </div>
          </div>
          <div className="pagination">
            <Tooltip
              content={
                fullDataStartTime
                  ? `Jump to earliest plot-width page: ${formatFullDate(new Date(fullDataStartTime.getTime() + timeRange.duration))}`
                  : "Jump to earliest data"
              }
            >
              <button
                onClick={() => {
                  if (!fullDataStartTime) return
                  // Jump to earliest: position plot to show full duration starting from earliest
                  // Range will be [fullDataStartTime, fullDataStartTime + duration]
                  // Table shows first pageSize windows, leaving (duration_in_windows - pageSize) gap to end
                  const timestamp = new Date(fullDataStartTime.getTime() + timeRange.duration)
                  setTimeRange({ timestamp, duration: timeRange.duration })
                  setPage(0)
                }}
                disabled={isAtEarliest}
                aria-label="Jump to earliest data"
                className="btn"
              >
                <i className="fas fa-backward-step"></i>
              </button>
            </Tooltip>
            <Tooltip
              content={
                timeRange.timestamp || fullDataEndTime
                  ? `Rewind by ${Math.round(timeRange.duration / (windowMinutes * 60 * 1000))} time points (plot width), to ${formatFullDate(new Date(((timeRange.timestamp || fullDataEndTime)!).getTime() - timeRange.duration))}`
                  : "Pan backward by one plot width"
              }
            >
              <button
                onClick={() => {
                  // Pan backward by plot width
                  // Clamp currentTimestamp to not exceed fullDataEndTime
                  const currentTimestamp = timeRange.timestamp
                    ? new Date(Math.min(timeRange.timestamp.getTime(), fullDataEndTime?.getTime() ?? Infinity))
                    : fullDataEndTime
                  if (!currentTimestamp) return
                  const newTimestamp = new Date(currentTimestamp.getTime() - timeRange.duration)
                  setTimeRange({ timestamp: newTimestamp, duration: timeRange.duration })
                  setPage(0)
                }}
                disabled={isAtEarliest}
                aria-label="Pan backward by one plot width"
                className="btn"
              >
                <i className="fas fa-angles-left"></i>
              </button>
            </Tooltip>
            <Tooltip
              content={
                timeRange.timestamp || fullDataEndTime
                  ? `Rewind by ${pageSize} time points, to ${formatFullDate(new Date(((timeRange.timestamp || fullDataEndTime)!).getTime() - pageSize * windowMinutes * 60 * 1000))}`
                  : "Pan backward by one table page"
              }
            >
              <button
                onClick={() => {
                  // Pan backward by one table page
                  // Clamp currentTimestamp to not exceed fullDataEndTime
                  const currentTimestamp = timeRange.timestamp
                    ? new Date(Math.min(timeRange.timestamp.getTime(), fullDataEndTime?.getTime() ?? Infinity))
                    : fullDataEndTime
                  if (!currentTimestamp) return
                  const pageShiftMs = pageSize * windowMinutes * 60 * 1000
                  const newTimestamp = new Date(currentTimestamp.getTime() - pageShiftMs)
                  setTimeRange({ timestamp: newTimestamp, duration: timeRange.duration })
                  setPage(0)
                }}
                disabled={isAtEarliest}
                aria-label="Pan backward by one table page"
                className="btn"
              >
                <i className="fas fa-angle-left"></i>
              </button>
            </Tooltip>
            <span className="page-info">
              <span className="range">{globalStartIdx.toLocaleString()}-{globalEndIdx.toLocaleString()}</span>
              {' of '}
              <span className="total">{totalDataCount.toLocaleString()} × {windowLabel}</span>
            </span>
            <Tooltip
              content={
                timeRange.timestamp && fullDataEndTime
                  ? `Forward by ${pageSize} windows (table page) to ${timeRange.timestamp.getTime() + pageSize * windowMinutes * 60 * 1000 >= fullDataEndTime.getTime() ? "Latest" : formatFullDate(new Date(timeRange.timestamp.getTime() + pageSize * windowMinutes * 60 * 1000))}`
                  : "Pan forward by one table page"
              }
            >
              <button
                onClick={() => {
                  if (!timeRange.timestamp || !fullDataEndTime) return
                  // Pan forward by one table page - clamp to not exceed latest
                  const pageShiftMs = pageSize * windowMinutes * 60 * 1000
                  const newTime = timeRange.timestamp.getTime() + pageShiftMs
                  // If would exceed latest, go to Latest mode instead
                  const newTimestamp = newTime >= fullDataEndTime.getTime() ? null : new Date(newTime)
                  setTimeRange({ timestamp: newTimestamp, duration: timeRange.duration })
                  setPage(0)
                }}
                disabled={isAtLatest}
                aria-label="Pan forward by one table page"
                className="btn"
              >
                <i className="fas fa-angle-right"></i>
              </button>
            </Tooltip>
            <Tooltip
              content={
                timeRange.timestamp && fullDataEndTime
                  ? `Forward by ${Math.round(timeRange.duration / (windowMinutes * 60 * 1000))} time points (plot width), to ${timeRange.timestamp.getTime() + timeRange.duration >= fullDataEndTime.getTime() ? "Latest" : formatFullDate(new Date(timeRange.timestamp.getTime() + timeRange.duration))}`
                  : "Pan forward by one plot width"
              }
            >
              <button
                onClick={() => {
                  if (!timeRange.timestamp || !fullDataEndTime) return
                  // Pan forward by one plot width - clamp to not exceed latest
                  const newTime = timeRange.timestamp.getTime() + timeRange.duration
                  // If would exceed latest, go to Latest mode instead
                  const newTimestamp = newTime >= fullDataEndTime.getTime() ? null : new Date(newTime)
                  setTimeRange({ timestamp: newTimestamp, duration: timeRange.duration })
                  setPage(0)
                }}
                disabled={isAtLatest}
                aria-label="Pan forward by one plot width"
                className="btn"
              >
                <i className="fas fa-angles-right"></i>
              </button>
            </Tooltip>
            <Tooltip
              content={
                fullDataEndTime
                  ? `Jump to Latest: ${formatFullDate(fullDataEndTime)}`
                  : "Jump to Latest"
              }
            >
              <button
                onClick={() => {
                  // Jump to latest: set timestamp to null
                  setTimeRange({ timestamp: null, duration: timeRange.duration })
                  setPage(0)
                }}
                disabled={isAtLatest}
                aria-label="Jump to Latest"
                className="btn"
              >
                <i className="fas fa-forward-step"></i>
              </button>
            </Tooltip>
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
                    <Tooltip maxWidth={200} content={formatFullDate(record.timestamp)}>
                      <span className="help-cursor">{formatCompactDate(record.timestamp)}</span>
                    </Tooltip>
                  ) : (
                    formatCompactDate(record.timestamp)
                  )}
                </td>
                <td>
                  {isRawData ? (
                    record.temp_avg.toFixed(1)
                  ) : (
                    <Tooltip maxWidth={200} content={`±σ: ${(record.temp_avg - record.temp_stddev).toFixed(1)} - ${(record.temp_avg + record.temp_stddev).toFixed(1)} °F${record.count > 1 ? ` | n = ${record.count}` : ''}`}>
                      <span className="help-cursor">{record.temp_avg.toFixed(1)}</span>
                    </Tooltip>
                  )}
                </td>
                <td>
                  {isRawData ? (
                    record.humid_avg.toFixed(1)
                  ) : (
                    <Tooltip maxWidth={200} content={`±σ: ${(record.humid_avg - record.humid_stddev).toFixed(1)} - ${(record.humid_avg + record.humid_stddev).toFixed(1)} %${record.count > 1 ? ` | n = ${record.count}` : ''}`}>
                      <span className="help-cursor">{record.humid_avg.toFixed(1)}</span>
                    </Tooltip>
                  )}
                </td>
                <td>
                  {isRawData ? (
                    Math.round(record.co2_avg)
                  ) : (
                    <Tooltip maxWidth={200} content={`±σ: ${Math.round(record.co2_avg - record.co2_stddev)} - ${Math.round(record.co2_avg + record.co2_stddev)} ppm${record.count > 1 ? ` | n = ${record.count}` : ''}`}>
                      <span className="help-cursor">{Math.round(record.co2_avg)}</span>
                    </Tooltip>
                  )}
                </td>
                <td>
                  {isRawData ? (
                    Math.round(record.voc_avg)
                  ) : (
                    <Tooltip maxWidth={200} content={`±σ: ${Math.round(record.voc_avg - record.voc_stddev)} - ${Math.round(record.voc_avg + record.voc_stddev)} ppb${record.count > 1 ? ` | n = ${record.count}` : ''}`}>
                      <span className="help-cursor">{Math.round(record.voc_avg)}</span>
                    </Tooltip>
                  )}
                </td>
                <td>
                  {isRawData ? (
                    record.pm25_avg.toFixed(1)
                  ) : (
                    <Tooltip maxWidth={200} content={`±σ: ${(record.pm25_avg - record.pm25_stddev).toFixed(1)} - ${(record.pm25_avg + record.pm25_stddev).toFixed(1)} μg/m³${record.count > 1 ? ` | n = ${record.count}` : ''}`}>
                      <span className="help-cursor">{record.pm25_avg.toFixed(1)}</span>
                    </Tooltip>
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
