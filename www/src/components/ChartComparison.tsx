import { useState } from 'react'
import { ObservableChart } from './charts/ObservableChart'
import { PlotlyChart } from './charts/PlotlyChart'
import { RechartsChart } from './charts/RechartsChart'
import { UplotChart } from './charts/UplotChart'
import type { AwairRecord } from '../types/awair'

interface Props {
  data: AwairRecord[];
}

type ChartLibrary = 'recharts' | 'plotly' | 'uplot' | 'observable';

interface RenderTime {
  library: ChartLibrary;
  time: number;
}

export function ChartComparison({ data }: Props) {
  const [activeLibrary, setActiveLibrary] = useState<ChartLibrary>('recharts')
  const [renderTimes, setRenderTimes] = useState<RenderTime[]>([])

  // Use last 1000 points for comparison to avoid overwhelming
  const chartData = data.slice(0, 1000)

  const measureRenderTime = (library: ChartLibrary) => {
    const start = performance.now()
    setActiveLibrary(library)

    // Measure after next render
    setTimeout(() => {
      const end = performance.now()
      const time = end - start

      setRenderTimes(prev => {
        const filtered = prev.filter(rt => rt.library !== library)
        return [...filtered, { library, time }].sort((a, b) => a.time - b.time)
      })
    }, 100)
  }

  const libraries: { key: ChartLibrary; name: string; description: string }[] = [
    { key: 'recharts', name: 'Recharts', description: 'React-native, composable, SSR-friendly' },
    { key: 'plotly', name: 'Plotly.js', description: 'Feature-rich, heavy bundle' },
    { key: 'uplot', name: 'uPlot', description: 'Minimal, ultra-fast' },
    { key: 'observable', name: 'Observable Plot', description: 'Grammar of graphics, D3-based' }
  ]

  return (
    <div className="chart-comparison">
      <div className="comparison-header">
        <h2>Chart Library Performance Comparison</h2>
        <p>Testing with {chartData.length.toLocaleString()} data points (last 1000 records)</p>

        <div className="library-buttons">
          {libraries.map(lib => (
            <button
              key={lib.key}
              onClick={() => measureRenderTime(lib.key)}
              className={activeLibrary === lib.key ? 'active' : ''}
            >
              {lib.name}
              <span className="lib-desc">{lib.description}</span>
            </button>
          ))}
        </div>

        {renderTimes.length > 0 && (
          <div className="render-times">
            <h3>Render Times</h3>
            {renderTimes.map((rt, idx) => (
              <div key={rt.library} className={`time-result ${idx === 0 ? 'fastest' : ''}`}>
                <span className="library">{libraries.find(l => l.key === rt.library)?.name}</span>
                <span className="time">{rt.time.toFixed(1)}ms</span>
                {idx === 0 && <span className="badge">Fastest</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="chart-container">
        {activeLibrary === 'recharts' && <RechartsChart data={chartData} />}
        {activeLibrary === 'plotly' && <PlotlyChart data={chartData} />}
        {activeLibrary === 'uplot' && <UplotChart data={chartData} />}
        {activeLibrary === 'observable' && <ObservableChart data={chartData} />}
      </div>
    </div>
  )
}
