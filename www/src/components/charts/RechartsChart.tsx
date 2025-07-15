import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { AwairRecord } from '../../types/awair'

interface Props {
  data: AwairRecord[];
}

export function RechartsChart({ data }: Props) {
  const chartData = data.map(record => ({
    time: new Date(record.timestamp).getTime(),
    timeStr: new Date(record.timestamp).toLocaleTimeString(),
    temp: record.temp,
    co2: record.co2,
    humidity: record.humid,
    pm25: record.pm25
  }))

  return (
    <div style={{ width: '100%', height: '400px' }}>
      <h3>Recharts - Temperature & CO₂</h3>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(time) => new Date(time).toLocaleTimeString()}
          />
          <YAxis yAxisId="temp" orientation="left" />
          <YAxis yAxisId="co2" orientation="right" />
          <Tooltip
            labelFormatter={(time) => new Date(time).toLocaleString()}
          />
          <Line yAxisId="temp" type="monotone" dataKey="temp" stroke="#e74c3c" strokeWidth={2} dot={false} />
          <Line yAxisId="co2" type="monotone" dataKey="co2" stroke="#3498db" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
