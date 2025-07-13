import { useState } from 'react';
import type { AwairRecord } from '../types/awair';

interface Props {
  data: AwairRecord[];
}

export function DataTable({ data }: Props) {
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const totalPages = Math.ceil(data.length / pageSize);
  const startIdx = page * pageSize;
  const endIdx = Math.min(startIdx + pageSize, data.length);
  const pageData = data.slice(startIdx, endIdx);

  return (
    <div className="data-table">
      <div className="table-header">
        <h3>Recent Readings</h3>
        <div className="pagination">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {totalPages}
            ({startIdx + 1}-{endIdx} of {data.length})
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
          </button>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Temp (°F)</th>
              <th>Humidity (%)</th>
              <th>CO₂ (ppm)</th>
              <th>VOC (ppb)</th>
              <th>PM2.5 (μg/m³)</th>
              <th>PM10 (μg/m³)</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((record, idx) => (
              <tr key={startIdx + idx}>
                <td>{new Date(record.timestamp).toLocaleString()}</td>
                <td>{record.temp.toFixed(1)}</td>
                <td>{record.humid.toFixed(1)}</td>
                <td>{Math.round(record.co2)}</td>
                <td>{Math.round(record.voc)}</td>
                <td>{record.pm25.toFixed(1)}</td>
                <td>{record.pm10.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}