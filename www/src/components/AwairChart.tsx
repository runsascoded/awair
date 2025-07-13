import { useState, useMemo, useCallback } from 'react';
import Plot from 'react-plotly.js';
import type { AwairRecord } from '../types/awair';

interface Props {
  data: AwairRecord[];
}

interface TimeWindow {
  label: string;
  minutes: number;
}

interface AggregatedData {
  timestamp: string;
  temp_avg: number;
  temp_min: number;
  temp_max: number;
  co2_avg: number;
  co2_min: number;
  co2_max: number;
  humid_avg: number;
  humid_min: number;
  humid_max: number;
  pm25_avg: number;
  pm25_min: number;
  pm25_max: number;
  voc_avg: number;
  voc_min: number;
  voc_max: number;
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
        temp_min: record.temp,
        temp_max: record.temp,
        co2_avg: record.co2,
        co2_min: record.co2,
        co2_max: record.co2,
        humid_avg: record.humid,
        humid_min: record.humid,
        humid_max: record.humid,
        pm25_avg: record.pm25,
        pm25_min: record.pm25,
        pm25_max: record.pm25,
        voc_avg: record.voc,
        voc_min: record.voc,
        voc_max: record.voc,
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
        temp_min: Math.min(...temps),
        temp_max: Math.max(...temps),
        co2_avg: co2s.reduce((a, b) => a + b, 0) / co2s.length,
        co2_min: Math.min(...co2s),
        co2_max: Math.max(...co2s),
        humid_avg: humids.reduce((a, b) => a + b, 0) / humids.length,
        humid_min: Math.min(...humids),
        humid_max: Math.max(...humids),
        pm25_avg: pm25s.reduce((a, b) => a + b, 0) / pm25s.length,
        pm25_min: Math.min(...pm25s),
        pm25_max: Math.max(...pm25s),
        voc_avg: vocs.reduce((a, b) => a + b, 0) / vocs.length,
        voc_min: Math.min(...vocs),
        voc_max: Math.max(...vocs),
      };
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// Find the optimal aggregation window size to keep around 200 data points
// This ensures good performance while maintaining visual detail
function findOptimalWindow(dataLength: number, timeRangeMinutes?: number, data?: AwairRecord[]): TimeWindow {
  const targetPoints = 200;

  if (timeRangeMinutes) {
    // When zoomed: calculate window size based on visible time range
    let selectedWindow = TIME_WINDOWS[TIME_WINDOWS.length - 1];

    for (let i = TIME_WINDOWS.length - 1; i >= 0; i--) {
      const window = TIME_WINDOWS[i];
      const estimatedPoints = Math.ceil(timeRangeMinutes / window.minutes);

      if (estimatedPoints < targetPoints) {
        selectedWindow = window;
      } else {
        // Too many points, use the previous (larger) window
        if (i < TIME_WINDOWS.length - 1) {
          selectedWindow = TIME_WINDOWS[i + 1];
        }
        break;
      }
    }
    return selectedWindow;
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
  const [metric, setMetric] = useState<'temp' | 'co2' | 'humid' | 'pm25' | 'voc'>('temp');
  const [xAxisRange, setXAxisRange] = useState<[string, string] | null>(null);

  const handleRelayout = useCallback((eventData: any) => {
    const xRange0 = eventData['xaxis.range[0]'];
    const xRange1 = eventData['xaxis.range[1]'];

    if (xRange0 && xRange1) {
      // Only update if actually different to prevent loops
      if (!xAxisRange || xAxisRange[0] !== xRange0 || xAxisRange[1] !== xRange1) {
        setXAxisRange([xRange0, xRange1]);
      }
    } else if (eventData['xaxis.autorange'] === true) {
      setXAxisRange(null);
    }
  }, [xAxisRange]);



  // Calculate optimal window based on visible range or full data
  const selectedWindow = useMemo(() => {
    if (xAxisRange) {
      const [start, end] = xAxisRange;
      const rangeMinutes = (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60);
      return findOptimalWindow(data.length, rangeMinutes, data);
    }
    return findOptimalWindow(data.length, undefined, data);
  }, [data, xAxisRange]);

  const aggregatedData = useMemo(() => {
    // Filter data to visible range if zoomed
    let dataToAggregate = data;
    if (xAxisRange) {
      const [start, end] = xAxisRange;
      const startDate = new Date(start);
      const endDate = new Date(end);

      dataToAggregate = data.filter(record => {
        const recordDate = new Date(record.timestamp);
        return recordDate >= startDate && recordDate <= endDate;
      });

      // Sort filtered data chronologically (oldest first) for proper aggregation
      dataToAggregate.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    return aggregateData(dataToAggregate, selectedWindow.minutes);
  }, [data, selectedWindow, xAxisRange]);

  const metricConfig = {
    temp: { label: 'Temperature', unit: '°F', color: '#e74c3c' },
    co2: { label: 'CO₂', unit: 'ppm', color: '#3498db' },
    humid: { label: 'Humidity', unit: '%', color: '#2ecc71' },
    pm25: { label: 'PM2.5', unit: 'μg/m³', color: '#f39c12' },
    voc: { label: 'VOC', unit: 'ppb', color: '#9b59b6' }
  };

  const config = metricConfig[metric];
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
  const minValues = aggregatedData.map(d => d[`${metric}_min`]);
  const maxValues = aggregatedData.map(d => d[`${metric}_max`]);

  return (
    <div className="awair-chart">
      <div className="chart-header">
        <h2>Awair Data Visualization</h2>
        <p>
          Showing {aggregatedData.length} {selectedWindow.label} windows
          {xAxisRange && data.length > 1 ? ` (${Math.ceil((new Date(data[0].timestamp).getTime() - new Date(data[data.length - 1].timestamp).getTime()) / (1000 * 60 * selectedWindow.minutes))} total)` : ''} •
          Metric: {config.label} •
          {xAxisRange ? 'Zoomed view' : 'Full dataset'}
        </p>

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
            <span className="info-text">
              Window size adapts automatically to zoom level.
              Drag to select time range, double-click to reset.
            </span>
          </div>
        </div>
      </div>

      <div className="chart-container">
        <Plot
          data={[
            // Min-Max filled area
            {
              x: [...timestamps, ...timestamps.slice().reverse()],
              y: [...maxValues, ...minValues.slice().reverse()],
              fill: 'toself',
              fillcolor: `${config.color}20`,
              line: { color: 'transparent' },
              name: 'Min/Max Range',
              showlegend: true,
              hoverinfo: 'skip'
            },
            // Average line
            {
              x: timestamps,
              y: avgValues,
              type: 'scatter',
              mode: 'lines',
              name: `${config.label} (avg)`,
              line: { color: config.color, width: 3 },
              hovertemplate: `<b>%{fullData.name}</b><br>` +
                           `Time: %{x}<br>` +
                           `Value: %{y:.1f} ${config.unit}<extra></extra>`
            },
            // Min line (thin, dashed)
            {
              x: timestamps,
              y: minValues,
              type: 'scatter',
              mode: 'lines',
              name: `${config.label} (min)`,
              line: { color: config.color, width: 1, dash: 'dot' },
              opacity: 0.7,
              hovertemplate: `<b>%{fullData.name}</b><br>` +
                           `Time: %{x}<br>` +
                           `Value: %{y:.1f} ${config.unit}<extra></extra>`
            },
            // Max line (thin, dashed)
            {
              x: timestamps,
              y: maxValues,
              type: 'scatter',
              mode: 'lines',
              name: `${config.label} (max)`,
              line: { color: config.color, width: 1, dash: 'dot' },
              opacity: 0.7,
              hovertemplate: `<b>%{fullData.name}</b><br>` +
                           `Time: %{x}<br>` +
                           `Value: %{y:.1f} ${config.unit}<extra></extra>`
            }
          ]}
          layout={{
            width: 1000,
            height: 500,
            xaxis: {
              title: 'Time',
              type: 'date',
              ...(xAxisRange && { range: xAxisRange })
            },
            yaxis: {
              title: `${config.label} (${config.unit})`,
              gridcolor: '#f0f0f0',
              fixedrange: true
            },
            margin: { l: 60, r: 60, t: 60, b: 60 },
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
            dragmode: 'zoom',
            selectdirection: 'horizontal'
          }}
          config={{
            displayModeBar: true,
            displaylogo: false,
            responsive: true,
            scrollZoom: true
          }}
          onRelayout={handleRelayout}
        />
      </div>
    </div>
  );
}