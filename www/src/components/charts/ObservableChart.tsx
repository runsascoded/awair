import { useRef, useEffect } from 'react';
import * as Plot from '@observablehq/plot';
import * as d3 from 'd3';
import type { AwairRecord } from '../../types/awair';

interface Props {
  data: AwairRecord[];
}

export function ObservableChart({ data }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    // Prepare data with parsed dates
    const plotData = data.map(r => ({
      timestamp: new Date(r.timestamp),
      temp: r.temp,
      co2: r.co2,
      humid: r.humid,
      pm25: r.pm25
    }));

    const plot = Plot.plot({
      width: 800,
      height: 400,
      marginLeft: 60,
      marginRight: 60,
      x: {
        type: "time",
        label: "Time"
      },
      y: {
        label: "Temperature (°F)",
        grid: true
      },
      color: {
        legend: true
      },
      marks: [
        Plot.lineY(plotData, {
          x: "timestamp",
          y: "temp",
          stroke: "#e74c3c",
          strokeWidth: 2
        }),
        Plot.lineY(plotData, {
          x: "timestamp",
          y: d => d.co2 / 10, // Scale down CO2 to fit on same axis
          stroke: "#3498db",
          strokeWidth: 2,
          opacity: 0.7
        })
      ]
    });

    chartRef.current.innerHTML = '';
    chartRef.current.appendChild(plot);

    return () => {
      if (chartRef.current) {
        chartRef.current.innerHTML = '';
      }
    };
  }, [data]);

  return (
    <div>
      <h3>Observable Plot - Temperature & CO₂ (scaled)</h3>
      <div ref={chartRef}></div>
    </div>
  );
}