import React, { useState } from 'react';
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

interface Props {
  data: AggregatedData[];
  formatCompactDate: (date: Date) => string;
  totalDataCount: number;
  windowLabel: string;
}

// Simple tooltip component for table values
function ValueTooltip({ children, content }: { children: React.ReactElement; content: string }) {
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
              maxWidth: '200px',
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

export function DataTable({ data, formatCompactDate, totalDataCount, windowLabel }: Props) {
  const [page, setPage] = useState(0);
  const pageSize = 20;

  // Reverse the data to show most recent first (reverse chronological)
  const reversedData = [...data].reverse();

  const totalPages = Math.ceil(reversedData.length / pageSize);
  const startIdx = page * pageSize;
  const endIdx = Math.min(startIdx + pageSize, reversedData.length);
  const pageData = reversedData.slice(startIdx, endIdx);

  return (
    <div className="data-table">
      <div className="table-header">
        <h3>Aggregated Data</h3>
        <div className="pagination">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Newer
          </button>
          <span>
            {startIdx + 1}-{endIdx} of {totalDataCount} {windowLabel}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Older
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
            </tr>
          </thead>
          <tbody>
            {pageData.map((record, idx) => (
              <tr key={startIdx + idx}>
                <td>{formatCompactDate(new Date(record.timestamp))}</td>
                <td>
                  <ValueTooltip content={`±1σ: ${(record.temp_avg - record.temp_stddev).toFixed(1)} - ${(record.temp_avg + record.temp_stddev).toFixed(1)} °F`}>
                    <span style={{ cursor: 'help' }}>{record.temp_avg.toFixed(1)}</span>
                  </ValueTooltip>
                </td>
                <td>
                  <ValueTooltip content={`±1σ: ${(record.humid_avg - record.humid_stddev).toFixed(1)} - ${(record.humid_avg + record.humid_stddev).toFixed(1)} %`}>
                    <span style={{ cursor: 'help' }}>{record.humid_avg.toFixed(1)}</span>
                  </ValueTooltip>
                </td>
                <td>
                  <ValueTooltip content={`±1σ: ${Math.round(record.co2_avg - record.co2_stddev)} - ${Math.round(record.co2_avg + record.co2_stddev)} ppm`}>
                    <span style={{ cursor: 'help' }}>{Math.round(record.co2_avg)}</span>
                  </ValueTooltip>
                </td>
                <td>
                  <ValueTooltip content={`±1σ: ${Math.round(record.voc_avg - record.voc_stddev)} - ${Math.round(record.voc_avg + record.voc_stddev)} ppb`}>
                    <span style={{ cursor: 'help' }}>{Math.round(record.voc_avg)}</span>
                  </ValueTooltip>
                </td>
                <td>
                  <ValueTooltip content={`±1σ: ${(record.pm25_avg - record.pm25_stddev).toFixed(1)} - ${(record.pm25_avg + record.pm25_stddev).toFixed(1)} μg/m³`}>
                    <span style={{ cursor: 'help' }}>{record.pm25_avg.toFixed(1)}</span>
                  </ValueTooltip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}