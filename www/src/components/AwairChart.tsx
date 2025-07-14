import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Plot from 'react-plotly.js';
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
} from '@floating-ui/react';
import { DataTable } from './DataTable';
import type { AwairRecord } from '../types/awair';

interface Props {
  data: AwairRecord[];
}

// Simple tooltip component using Floating UI
function Tooltip({ children, content }: { children: React.ReactElement; content: string }) {
  const [isOpen, setIsOpen] = useState(false);

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
  });

  const hover = useHover(context);
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ]);

  return (
    <>
      {React.cloneElement(children, getReferenceProps({ ref: refs.setReference, ...children.props }))}
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
              maxWidth: '300px',
              zIndex: 1000,
            }}
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

interface TimeWindow {
  label: string;
  minutes: number;
}

interface AggregatedData {
  timestamp: string;
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
}

const TIME_WINDOWS: TimeWindow[] = [
  { label: '1m', minutes: 1 },
  { label: '2m', minutes: 2 },
  { label: '3m', minutes: 3 },
  { label: '4m', minutes: 4 },
  { label: '5m', minutes: 5 },
  { label: '6m', minutes: 6 },
  { label: '10m', minutes: 10 },
  { label: '12m', minutes: 12 },
  { label: '15m', minutes: 15 },
  { label: '20m', minutes: 20 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '3h', minutes: 180 },
  { label: '4h', minutes: 240 },
  { label: '6h', minutes: 360 },
  { label: '8h', minutes: 480 },
  { label: '12h', minutes: 720 },
  { label: '1d', minutes: 1440 },
  { label: '2d', minutes: 2880 },
  { label: '3d', minutes: 4320 },
  { label: '4d', minutes: 5760 },
  { label: '5d', minutes: 7200 },
  { label: '6d', minutes: 8640 },
  { label: '7d', minutes: 10080 },
  { label: '14d', minutes: 20160 },
  { label: '28d', minutes: 40320 },
  { label: '1mo', minutes: 43200 }, // 30 days
];

function aggregateData(data: AwairRecord[], windowMinutes: number): AggregatedData[] {
  if (data.length === 0) return [];

  // Special case: if window is 1 minute and data points are ~1 minute apart,
  // just return the raw data converted to the aggregated format
  if (windowMinutes === 1 && data.length > 1) {
    const interval = Math.abs(new Date(data[0].timestamp).getTime() - new Date(data[1].timestamp).getTime()) / (1000 * 60);

    if (interval <= 1.5) {
      // Data is already at ~1 minute intervals, just convert format
      return data.map(record => ({
        timestamp: record.timestamp,
        temp_avg: record.temp,
        temp_stddev: 0,
        co2_avg: record.co2,
        co2_stddev: 0,
        humid_avg: record.humid,
        humid_stddev: 0,
        pm25_avg: record.pm25,
        pm25_stddev: 0,
        voc_avg: record.voc,
        voc_stddev: 0,
      }));
    }
  }

  const windowMs = windowMinutes * 60 * 1000;
  const groups: { [key: string]: AwairRecord[] } = {};

  // Group data by time windows
  data.forEach(record => {
    const timestamp = new Date(record.timestamp).getTime();
    const windowStart = Math.floor(timestamp / windowMs) * windowMs;
    const key = new Date(windowStart).toISOString();

    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(record);
  });

  // Calculate standard deviation
  const calculateStdDev = (values: number[]): number => {
    if (values.length <= 1) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(avgSquaredDiff);
  };

  // Aggregate each group and ensure chronological order
  return Object.entries(groups)
    .map(([timestamp, records]) => {
      const temps = records.map(r => r.temp);
      const co2s = records.map(r => r.co2);
      const humids = records.map(r => r.humid);
      const pm25s = records.map(r => r.pm25);
      const vocs = records.map(r => r.voc);

      return {
        timestamp,
        temp_avg: temps.reduce((a, b) => a + b, 0) / temps.length,
        temp_stddev: calculateStdDev(temps),
        co2_avg: co2s.reduce((a, b) => a + b, 0) / co2s.length,
        co2_stddev: calculateStdDev(co2s),
        humid_avg: humids.reduce((a, b) => a + b, 0) / humids.length,
        humid_stddev: calculateStdDev(humids),
        pm25_avg: pm25s.reduce((a, b) => a + b, 0) / pm25s.length,
        pm25_stddev: calculateStdDev(pm25s),
        voc_avg: vocs.reduce((a, b) => a + b, 0) / vocs.length,
        voc_stddev: calculateStdDev(vocs),
      };
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// Find the optimal aggregation window size to keep around 300 data points
// This ensures good performance while maintaining visual detail
function findOptimalWindow(dataLength: number, timeRangeMinutes?: number, data?: AwairRecord[]): TimeWindow {
  const targetPoints = 300;

  if (timeRangeMinutes) {
    // When zoomed: calculate window size based on visible time range
    // Go from smallest to largest to find the smallest window that keeps us under target
    for (let i = 0; i < TIME_WINDOWS.length; i++) {
      const window = TIME_WINDOWS[i];
      const estimatedPoints = Math.ceil(timeRangeMinutes / window.minutes);

      if (estimatedPoints <= targetPoints) {
        return window;
      }
    }

    // If even the largest window gives too many points, use it anyway
    return TIME_WINDOWS[TIME_WINDOWS.length - 1];
  } else if (data && data.length > 1) {
    // Full dataset: calculate window based on total time span
    const firstTime = new Date(data[data.length - 1].timestamp).getTime();
    const lastTime = new Date(data[0].timestamp).getTime();
    const totalMinutes = (lastTime - firstTime) / (1000 * 60);

    let selectedWindow = TIME_WINDOWS[TIME_WINDOWS.length - 1];

    for (let i = TIME_WINDOWS.length - 1; i >= 0; i--) {
      const window = TIME_WINDOWS[i];
      const estimatedPoints = Math.ceil(totalMinutes / window.minutes);

      if (estimatedPoints < targetPoints) {
        selectedWindow = window;
      } else {
        if (i < TIME_WINDOWS.length - 1) {
          selectedWindow = TIME_WINDOWS[i + 1];
        }
        break;
      }
    }
    return selectedWindow;
  } else {
    // Fallback to middle window
    return TIME_WINDOWS[Math.floor(TIME_WINDOWS.length / 2)];
  }
}

export function AwairChart({ data }: Props) {
  const [metric, setMetric] = useState<'temp' | 'co2' | 'humid' | 'pm25' | 'voc'>(() => {
    const stored = sessionStorage.getItem('awair-metric') as 'temp' | 'co2' | 'humid' | 'pm25' | 'voc';
    const validMetrics = ['temp', 'co2', 'humid', 'pm25', 'voc'];
    return validMetrics.includes(stored) ? stored : 'temp';
  });
  const [xAxisRange, setXAxisRange] = useState<[string, string] | null>(() => {
    const stored = sessionStorage.getItem('awair-time-range');
    return stored ? JSON.parse(stored) : null;
  });

  const [hasSetDefaultRange, setHasSetDefaultRange] = useState(false);

  // Flag to ignore the next relayout event from double-click
  const ignoreNextRelayoutRef = useRef(false);

  // Format date for Plotly (YYYY-MM-DD HH:MM:SS)
  const formatForPlotly = useCallback((date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }, []);

  // Save to session storage when values change
  useEffect(() => {
    sessionStorage.setItem('awair-metric', metric);
  }, [metric]);

  useEffect(() => {
    if (xAxisRange) {
      sessionStorage.setItem('awair-time-range', JSON.stringify(xAxisRange));
    } else {
      sessionStorage.removeItem('awair-time-range');
    }
  }, [xAxisRange]);

  // Set default range to latest 3d on first load
  useEffect(() => {
    if (!hasSetDefaultRange && data.length > 0 && !xAxisRange) {
      const latestTime = new Date(data[0].timestamp);
      const earliestTime = new Date(latestTime.getTime() - (3 * 24 * 60 * 60 * 1000));
      const defaultRange: [string, string] = [formatForPlotly(earliestTime), formatForPlotly(latestTime)];
      setXAxisRange(defaultRange);
      setHasSetDefaultRange(true);
    }
  }, [data, xAxisRange, hasSetDefaultRange, formatForPlotly]);

  // Compact date formatter for display
  const formatCompactDate = useCallback((date: Date) => {
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1);
    const day = String(date.getDate());
    const hours = String(date.getHours());
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}/${day}/${year} ${hours}:${minutes}`;
  }, []);

  const handleTimeRangeClick = useCallback((hours: number) => {
    if (data.length === 0) return;

    // Get the most recent timestamp (data is sorted newest first)
    const latestTime = new Date(data[0].timestamp);
    const earliestTime = new Date(latestTime.getTime() - (hours * 60 * 60 * 1000));

    const newRange: [string, string] = [formatForPlotly(earliestTime), formatForPlotly(latestTime)];
    setXAxisRange(newRange);
  }, [data, formatForPlotly]);

  const setRangeByWidth = useCallback((hours: number, centerTime?: Date) => {
    if (data.length === 0) return;

    const center = centerTime || new Date();
    const halfSpan = (hours * 60 * 60 * 1000) / 2;

    let startTime = new Date(center.getTime() - halfSpan);
    let endTime = new Date(center.getTime() + halfSpan);

    // Clamp to global data bounds
    const globalStart = new Date(data[data.length - 1].timestamp);
    const globalEnd = new Date(data[0].timestamp);

    if (startTime < globalStart) {
      const diff = globalStart.getTime() - startTime.getTime();
      startTime = globalStart;
      endTime = new Date(endTime.getTime() + diff);
    }
    if (endTime > globalEnd) {
      const diff = endTime.getTime() - globalEnd.getTime();
      endTime = globalEnd;
      startTime = new Date(startTime.getTime() - diff);
    }

    // Final clamp
    startTime = new Date(Math.max(startTime.getTime(), globalStart.getTime()));
    endTime = new Date(Math.min(endTime.getTime(), globalEnd.getTime()));

    const newRange: [string, string] = [formatForPlotly(startTime), formatForPlotly(endTime)];
    setXAxisRange(newRange);
  }, [data, formatForPlotly]);

  const handleDoubleClick = useCallback(() => {
    if (data.length > 0) {
      // Set our desired full range
      const fullRange: [string, string] = [
        formatForPlotly(new Date(data[data.length - 1].timestamp)),
        formatForPlotly(new Date(data[0].timestamp))
      ];

      // Set the flag BEFORE setting the range
      ignoreNextRelayoutRef.current = true;
      setXAxisRange(fullRange);
    }
  }, [data, formatForPlotly]);

  const handleRelayout = useCallback((eventData: any) => {
    // Check if we should ignore this event (from double-click)
    if (ignoreNextRelayoutRef.current) {
      ignoreNextRelayoutRef.current = false;
      return;
    }

    // Check if this is a range update
    const xRange0 = eventData['xaxis.range[0]'] || (eventData['xaxis.range'] && eventData['xaxis.range'][0]);
    const xRange1 = eventData['xaxis.range[1]'] || (eventData['xaxis.range'] && eventData['xaxis.range'][1]);

    if (xRange0 && xRange1) {
      let newStart = new Date(String(xRange0));
      let newEnd = new Date(String(xRange1));

      // Clamp to data bounds if we have data
      if (data.length > 0) {
        const globalStart = new Date(data[data.length - 1].timestamp);
        const globalEnd = new Date(data[0].timestamp);

        // If panned beyond bounds, clamp and shift
        if (newStart < globalStart) {
          const diff = globalStart.getTime() - newStart.getTime();
          newStart = globalStart;
          newEnd = new Date(newEnd.getTime() + diff);
        }
        if (newEnd > globalEnd) {
          const diff = newEnd.getTime() - globalEnd.getTime();
          newEnd = globalEnd;
          newStart = new Date(newStart.getTime() - diff);
        }

        // Final clamp
        newStart = new Date(Math.max(newStart.getTime(), globalStart.getTime()));
        newEnd = new Date(Math.min(newEnd.getTime(), globalEnd.getTime()));
      }

      const newRange: [string, string] = [formatForPlotly(newStart), formatForPlotly(newEnd)];
      setXAxisRange(newRange);
    }
  }, [xAxisRange, data, setRangeByWidth, formatForPlotly]);

  // Determine which time range button is active
  const getActiveTimeRange = useCallback(() => {
    if (!xAxisRange || data.length === 0) return 'all';

    const rangeStart = new Date(xAxisRange[0]);
    const rangeEnd = new Date(xAxisRange[1]);
    const rangeHours = (rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60);

    // Check if it's a "latest" view (ends at most recent data)
    const latestTime = new Date(data[0].timestamp);
    const isLatestView = Math.abs(rangeEnd.getTime() - latestTime.getTime()) < 60 * 60 * 1000; // 1 hour tolerance

    // Check if this is the full data range (all data) - this also counts as "latest"
    if (data.length > 0) {
      const dataStart = new Date(data[data.length - 1].timestamp);
      const dataEnd = new Date(data[0].timestamp);
      const isFullRange = Math.abs(rangeStart.getTime() - dataStart.getTime()) < 60 * 1000 && // 1 minute tolerance
                         Math.abs(rangeEnd.getTime() - dataEnd.getTime()) < 60 * 1000;
      if (isFullRange) return 'all'; // This will activate both "All" and "Latest" buttons
    }

    // Check range width with tolerance and return latest version if applicable
    if (Math.abs(rangeHours - 24) < 2) {
      return isLatestView ? 'latest-24h' : '24h';
    }
    if (Math.abs(rangeHours - (24 * 3)) < 6) {
      return isLatestView ? 'latest-3d' : '3d';
    }
    if (Math.abs(rangeHours - (24 * 7)) < 12) {
      return isLatestView ? 'latest-7d' : '7d';
    }
    if (Math.abs(rangeHours - (24 * 14)) < 24) {
      return isLatestView ? 'latest-14d' : '14d';
    }
    if (Math.abs(rangeHours - (24 * 30)) < 48) {
      return isLatestView ? 'latest-30d' : '30d';
    }

    // For custom ranges, still check if they end at latest
    return isLatestView ? 'latest-custom' : 'custom';
  }, [xAxisRange, data]);


  // Create a string key for xAxisRange to ensure proper dependency tracking
  const rangeKey = xAxisRange ? `${xAxisRange[0]}-${xAxisRange[1]}` : 'null';

  // First filter the data, then calculate optimal window
  const { dataToAggregate, selectedWindow } = useMemo(() => {
    let filteredData = data;

    if (xAxisRange) {
      const [start, end] = xAxisRange;
      const startDate = new Date(start);
      const endDate = new Date(end);

      filteredData = data.filter(record => {
        const recordDate = new Date(record.timestamp);
        return recordDate >= startDate && recordDate <= endDate;
      });

      // Sort filtered data chronologically (oldest first) for proper aggregation
      filteredData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // Calculate window based on actual visible time range
      const rangeMinutes = (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60);
      const window = findOptimalWindow(filteredData.length, rangeMinutes, filteredData);

      return { dataToAggregate: filteredData, selectedWindow: window };
    }

    // For full dataset view
    const window = findOptimalWindow(data.length, undefined, data);
    return { dataToAggregate: data, selectedWindow: window };
  }, [data, rangeKey]);

  const aggregatedData = useMemo(() => {
    return aggregateData(dataToAggregate, selectedWindow.minutes);
  }, [dataToAggregate, selectedWindow]);

  const metricConfig = {
    temp: { label: 'Temperature', unit: '°F', color: '#e74c3c' },
    co2: { label: 'CO₂', unit: 'ppm', color: '#3498db' },
    humid: { label: 'Humidity', unit: '%', color: '#2ecc71' },
    pm25: { label: 'PM2.5', unit: 'μg/m³', color: '#f39c12' },
    voc: { label: 'VOC', unit: 'ppb', color: '#9b59b6' }
  };

  const config = metricConfig[metric] || metricConfig.temp;
  // Convert timestamps to Plotly's expected format (YYYY-MM-DD HH:MM:SS)
  // This ensures consistent handling of timezones - Plotly returns zoom ranges
  // in this format as local time strings, so we need to provide data the same way
  const timestamps = aggregatedData.map(d => {
    const date = new Date(d.timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  });
  const avgValues = aggregatedData.map(d => d[`${metric}_avg`]);
  const stddevValues = aggregatedData.map(d => d[`${metric}_stddev`]);
  const upperValues = avgValues.map((avg, i) => avg + stddevValues[i]);
  const lowerValues = avgValues.map((avg, i) => avg - stddevValues[i]);

  return (
    <div className="awair-chart">
      <div className="chart-header">
        <h2>Awair Data Visualization</h2>

        <div className="chart-controls">
          <div className="control-group">
            <label>Metric:</label>
            <select value={metric} onChange={(e) => setMetric(e.target.value as any)}>
              {Object.entries(metricConfig).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label>Range Width:</label>
            <div className="time-range-buttons">
              <button
                className={getActiveTimeRange() === '24h' || getActiveTimeRange() === 'latest-24h' ? 'active' : ''}
                onClick={() => {
                  const activeRange = getActiveTimeRange();
                  if (activeRange.startsWith('latest-') || activeRange === 'all') {
                    // Stay anchored to latest
                    handleTimeRangeClick(24);
                  } else if (xAxisRange && data.length > 0) {
                    // Preserve current center
                    const currentCenter = new Date((new Date(xAxisRange[0]).getTime() + new Date(xAxisRange[1]).getTime()) / 2);
                    setRangeByWidth(24, currentCenter);
                  } else {
                    handleTimeRangeClick(24);
                  }
                }}
              >
                1d
              </button>
              <button
                className={getActiveTimeRange() === '3d' || getActiveTimeRange() === 'latest-3d' ? 'active' : ''}
                onClick={() => {
                  const activeRange = getActiveTimeRange();
                  if (activeRange.startsWith('latest-') || activeRange === 'all') {
                    // Stay anchored to latest
                    handleTimeRangeClick(24 * 3);
                  } else if (xAxisRange && data.length > 0) {
                    // Preserve current center
                    const currentCenter = new Date((new Date(xAxisRange[0]).getTime() + new Date(xAxisRange[1]).getTime()) / 2);
                    setRangeByWidth(24 * 3, currentCenter);
                  } else {
                    handleTimeRangeClick(24 * 3);
                  }
                }}
              >
                3d
              </button>
              <button
                className={getActiveTimeRange() === '7d' || getActiveTimeRange() === 'latest-7d' ? 'active' : ''}
                onClick={() => {
                  const activeRange = getActiveTimeRange();
                  if (activeRange.startsWith('latest-') || activeRange === 'all') {
                    // Stay anchored to latest
                    handleTimeRangeClick(24 * 7);
                  } else if (xAxisRange && data.length > 0) {
                    // Preserve current center
                    const currentCenter = new Date((new Date(xAxisRange[0]).getTime() + new Date(xAxisRange[1]).getTime()) / 2);
                    setRangeByWidth(24 * 7, currentCenter);
                  } else {
                    handleTimeRangeClick(24 * 7);
                  }
                }}
              >
                7d
              </button>
              <button
                className={getActiveTimeRange() === '14d' || getActiveTimeRange() === 'latest-14d' ? 'active' : ''}
                onClick={() => {
                  const activeRange = getActiveTimeRange();
                  if (activeRange.startsWith('latest-') || activeRange === 'all') {
                    // Stay anchored to latest
                    handleTimeRangeClick(24 * 14);
                  } else if (xAxisRange && data.length > 0) {
                    // Preserve current center
                    const currentCenter = new Date((new Date(xAxisRange[0]).getTime() + new Date(xAxisRange[1]).getTime()) / 2);
                    setRangeByWidth(24 * 14, currentCenter);
                  } else {
                    handleTimeRangeClick(24 * 14);
                  }
                }}
              >
                14d
              </button>
              <button
                className={getActiveTimeRange() === '30d' || getActiveTimeRange() === 'latest-30d' ? 'active' : ''}
                onClick={() => {
                  const activeRange = getActiveTimeRange();
                  if (activeRange.startsWith('latest-') || activeRange === 'all') {
                    // Stay anchored to latest
                    handleTimeRangeClick(24 * 30);
                  } else if (xAxisRange && data.length > 0) {
                    // Preserve current center
                    const currentCenter = new Date((new Date(xAxisRange[0]).getTime() + new Date(xAxisRange[1]).getTime()) / 2);
                    setRangeByWidth(24 * 30, currentCenter);
                  } else {
                    handleTimeRangeClick(24 * 30);
                  }
                }}
              >
                30d
              </button>
              <button
                className={getActiveTimeRange() === 'all' ? 'active' : ''}
                onClick={() => {
                  if (data.length > 0) {
                    // Explicitly set range to full data bounds
                    const fullRange: [string, string] = [
                      formatForPlotly(new Date(data[data.length - 1].timestamp)),
                      formatForPlotly(new Date(data[0].timestamp))
                    ];
                    setXAxisRange(fullRange);
                  } else {
                    setXAxisRange(null);
                  }
                }}
              >
                All
              </button>
            </div>
          </div>

          <div className="control-group">
            <label>Range:</label>
            <div className="range-info">
              {xAxisRange ? (
                <Tooltip content={`${new Date(xAxisRange[0]).toLocaleString()} → ${new Date(xAxisRange[1]).toLocaleString()}`}>
                  <div className="range-display">
                    <span className="range-start">{formatCompactDate(new Date(xAxisRange[0]))}</span>
                    <span className="range-separator"> → </span>
                    <span className="range-end">{formatCompactDate(new Date(xAxisRange[1]))}</span>
                  </div>
                </Tooltip>
              ) : (
                <span className="range-display">All data</span>
              )}
              <button
                className={`latest-button ${getActiveTimeRange().startsWith('latest-') || getActiveTimeRange() === 'all' ? 'active' : ''}`}
                onClick={() => {
                  if (xAxisRange && data.length > 0) {
                    const rangeStart = new Date(xAxisRange[0]);
                    const rangeEnd = new Date(xAxisRange[1]);
                    const currentWidth = rangeEnd.getTime() - rangeStart.getTime();
                    const latestTime = new Date(data[0].timestamp);
                    const newStart = new Date(latestTime.getTime() - currentWidth);
                    const newRange: [string, string] = [formatForPlotly(newStart), formatForPlotly(latestTime)];
                    setXAxisRange(newRange);
                  }
                }}
              >
                Latest
              </button>
            </div>
          </div>

        </div>
      </div>

      <div className="chart-container">
        <Plot
          data={[
            // ±1 stddev filled area
            {
              x: [...timestamps, ...timestamps.slice().reverse()],
              y: [...upperValues, ...lowerValues.slice().reverse()],
              fill: 'toself',
              fillcolor: `${config.color}20`,
              line: { color: 'transparent' },
              name: '±1σ Range',
              showlegend: false,
              hoverinfo: 'skip'
            },
            // Average line with comprehensive hover
            {
              x: timestamps,
              y: avgValues,
              type: 'scatter',
              mode: 'lines',
              name: `${config.label}`,
              line: { color: config.color, width: 3 },
              customdata: aggregatedData.map((d, i) => ({
                avg: avgValues[i],
                upper: upperValues[i],
                lower: lowerValues[i],
                stddev: stddevValues[i]
              })),
              hovertemplate: `<b>%{x}</b><br>` +
                           `Avg: %{y:.1f} ${config.unit}<br>` +
                           `±1σ: %{customdata.lower:.1f} - %{customdata.upper:.1f} ${config.unit}<br>` +
                           `σ: %{customdata.stddev:.1f} ${config.unit}<extra></extra>`
            },
            // Upper stddev line (thin, dashed) - hidden hover
            {
              x: timestamps,
              y: upperValues,
              type: 'scatter',
              mode: 'lines',
              name: `${config.label} (+1σ)`,
              line: { color: config.color, width: 1, dash: 'dot' },
              opacity: 0.7,
              showlegend: false,
              hoverinfo: 'skip'
            },
            // Lower stddev line (thin, dashed) - hidden hover
            {
              x: timestamps,
              y: lowerValues,
              type: 'scatter',
              mode: 'lines',
              name: `${config.label} (-1σ)`,
              line: { color: config.color, width: 1, dash: 'dot' },
              opacity: 0.7,
              showlegend: false,
              hoverinfo: 'skip'
            }
          ]}
          layout={{
            autosize: true,
            height: 500,
            xaxis: {
              title: 'Time',
              type: 'date',
              ...(xAxisRange && { range: xAxisRange }),
              ...(data.length > 0 && {
                rangeslider: { visible: false },
                constraintoward: 'center',
                autorange: false
              })
            },
            yaxis: {
              title: `${config.label} (${config.unit})`,
              gridcolor: '#f0f0f0',
              fixedrange: true
            },
            margin: { l: 80, r: 20, t: 40, b: 60 },
            hovermode: 'x',
            plot_bgcolor: 'white',
            paper_bgcolor: 'white',
            legend: {
              x: 0.02,
              y: 0.98,
              bgcolor: 'rgba(255,255,255,0.8)',
              bordercolor: '#ddd',
              borderwidth: 1
            },
            dragmode: 'pan',
            // Mobile-friendly touch interactions
            showlegend: true,
            autosize: true,
            // Enable touch interactions
            hovermode: 'closest',
            // Prevent text selection on mobile
            selectdirection: 'horizontal'
          }}
          config={{
            displayModeBar: true,
            displaylogo: false,
            responsive: true,
            scrollZoom: true,
            doubleClick: false,
            showTips: false,
            modeBarButtonsToRemove: ['select2d', 'lasso2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d'],
            toImageButtonOptions: {
              format: 'png',
              filename: 'awair-chart',
              height: 500,
              width: 1000,
              scale: 1
            }
          }}
          useResizeHandler={true}
          style={{ width: '100%', height: '100%' }}
          onRelayout={handleRelayout}
          onDoubleClick={handleDoubleClick}
        />
      </div>

      <Tooltip content="Window size adapts automatically to zoom level. Drag to pan, wheel to zoom, double-click to show all data.">
        <div className="chart-status">
          Showing {aggregatedData.length} {selectedWindow.label} windows
        </div>
      </Tooltip>

      <DataTable
        data={aggregatedData}
        formatCompactDate={formatCompactDate}
        totalDataCount={useMemo(() => {
          // Calculate total possible windows for the entire dataset with current window size
          if (data.length === 0) return 0;
          const firstTime = new Date(data[data.length - 1].timestamp).getTime();
          const lastTime = new Date(data[0].timestamp).getTime();
          const totalMinutes = (lastTime - firstTime) / (1000 * 60);
          return Math.ceil(totalMinutes / selectedWindow.minutes);
        }, [data, selectedWindow])}
        windowLabel={selectedWindow.label}
        plotStartTime={xAxisRange?.[0]}
        plotEndTime={xAxisRange?.[1]}
        fullDataStartTime={data.length > 0 ? data[data.length - 1].timestamp : undefined}
        fullDataEndTime={data.length > 0 ? data[0].timestamp : undefined}
        windowMinutes={selectedWindow.minutes}
      />
    </div>
  );
}
