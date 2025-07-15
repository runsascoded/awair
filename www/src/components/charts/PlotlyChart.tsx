import Plot from 'react-plotly.js'
import type { AwairRecord } from '../../types/awair'

interface Props {
  data: AwairRecord[];
}

export function PlotlyChart({ data }: Props) {
  const timestamps = data.map(r => r.timestamp)
  const temps = data.map(r => r.temp)
  const co2s = data.map(r => r.co2)

  return (
    <div>
      <h3>Plotly.js - Temperature & CO₂</h3>
      <Plot
        data={[
          {
            x: timestamps,
            y: temps,
            type: 'scatter',
            mode: 'lines',
            name: 'Temperature (°F)',
            line: { color: '#e74c3c', width: 2 },
            yaxis: 'y'
          },
          {
            x: timestamps,
            y: co2s,
            type: 'scatter',
            mode: 'lines',
            name: 'CO₂ (ppm)',
            line: { color: '#3498db', width: 2 },
            yaxis: 'y2'
          }
        ]}
        layout={{
          width: 800,
          height: 400,
          xaxis: { title: 'Time' },
          yaxis: { title: 'Temperature (°F)', side: 'left' },
          yaxis2: { title: 'CO₂ (ppm)', side: 'right', overlaying: 'y' },
          margin: { l: 50, r: 50, t: 50, b: 50 }
        }}
        config={{
          displayModeBar: false,
          responsive: true
        }}
      />
    </div>
  )
}
