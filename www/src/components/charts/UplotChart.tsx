import { useRef, useEffect } from 'react'
import uPlot from 'uplot'
import type { AwairRecord } from '../../types/awair'

interface Props {
  data: AwairRecord[];
}

export function UplotChart({ data }: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return

    // Prepare data for uPlot
    const timestamps = data.map(r => new Date(r.timestamp).getTime() / 1000)
    const temps = data.map(r => r.temp)
    const co2s = data.map(r => r.co2)

    const plotData = [timestamps, temps, co2s]

    const opts: uPlot.Options = {
      width: 800,
      height: 400,
      series: [
        {},
        {
          label: 'Temperature (°F)',
          stroke: '#e74c3c',
          width: 2
        },
        {
          label: 'CO₂ (ppm)',
          stroke: '#3498db',
          width: 2,
          scale: 'co2'
        }
      ],
      axes: [
        {
          values: (u, vals) => vals.map(v => new Date(v * 1000).toLocaleTimeString())
        },
        {
          label: 'Temperature (°F)',
          side: 3,
          stroke: '#e74c3c'
        },
        {
          label: 'CO₂ (ppm)',
          side: 1,
          scale: 'co2',
          stroke: '#3498db'
        }
      ],
      scales: {
        x: {
          time: true
        },
        y: {},
        co2: {}
      }
    }

    // Clean up previous plot
    if (plotRef.current) {
      plotRef.current.destroy()
    }

    plotRef.current = new uPlot(opts, plotData, chartRef.current)

    return () => {
      if (plotRef.current) {
        plotRef.current.destroy()
        plotRef.current = null
      }
    }
  }, [data])

  return (
    <div>
      <h3>uPlot - Temperature & CO₂</h3>
      <div ref={chartRef}></div>
    </div>
  )
}
