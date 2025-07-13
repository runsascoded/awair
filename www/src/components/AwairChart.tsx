import { useState, useMemo } from 'react';
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

  // Aggregate each group
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

function findOptimalWindow(dataLength: number): TimeWindow {
  // Find the smallest window that results in < 200 data points
  for (const window of TIME_WINDOWS) {
    const estimatedPoints = dataLength / (window.minutes * 5); // Assuming 5min intervals
    if (estimatedPoints < 200) {
      return window;
    }
  }
  return TIME_WINDOWS[TIME_WINDOWS.length - 1]; // Use largest window if all exceed 200
}

export function AwairChart({ data }: Props) {
  const [metric, setMetric] = useState<'temp' | 'co2' | 'humid' | 'pm25' | 'voc'>('temp');

  const optimalWindow = useMemo(() => findOptimalWindow(data.length), [data.length]);
  const [selectedWindow, setSelectedWindow] = useState<TimeWindow>(optimalWindow);

  const aggregatedData = useMemo(() =>
    aggregateData(data, selectedWindow.minutes),
    [data, selectedWindow]
  );

  const metricConfig = {
    temp: { label: 'Temperature', unit: '°F', color: '#e74c3c' },
    co2: { label: 'CO₂', unit: 'ppm', color: '#3498db' },
    humid: { label: 'Humidity', unit: '%', color: '#2ecc71' },
    pm25: { label: 'PM2.5', unit: 'μg/m³', color: '#f39c12' },
    voc: { label: 'VOC', unit: 'ppb', color: '#9b59b6' }
  };

  const config = metricConfig[metric];
  const timestamps = aggregatedData.map(d => d.timestamp);
  const avgValues = aggregatedData.map(d => d[`${metric}_avg`]);
  const minValues = aggregatedData.map(d => d[`${metric}_min`]);
  const maxValues = aggregatedData.map(d => d[`${metric}_max`]);

  return (
    <div className="awair-chart">
      <div className="chart-header">
        <h2>Awair Data Visualization</h2>
        <p>
          Showing {aggregatedData.length} data points •
          Window: {selectedWindow.label} •
          Metric: {config.label}
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
            <label>Time Window:</label>
            <select
              value={selectedWindow.label}
              onChange={(e) => {
                const window = TIME_WINDOWS.find(w => w.label === e.target.value);
                if (window) setSelectedWindow(window);
              }}
            >
              {TIME_WINDOWS.map(window => (
                <option key={window.label} value={window.label}>
                  {window.label}
                </option>
              ))}
            </select>
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
              type: 'date'
            },
            yaxis: {
              title: `${config.label} (${config.unit})`,
              gridcolor: '#f0f0f0'
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
            }
          }}
          config={{
            displayModeBar: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d'],
            responsive: true
          }}
        />
      </div>
    </div>
  );
}