import type { DataSummary as DataSummaryType } from '../types/awair';

interface Props {
  summary: DataSummaryType;
}

export function DataSummary({ summary }: Props) {
  return (
    <div className="data-summary">
      <h2>Awair Data Summary</h2>
      <div className="summary-grid">
        <div className="summary-item">
          <span className="label">Total Records:</span>
          <span className="value">{summary.count.toLocaleString()}</span>
        </div>
        <div className="summary-item">
          <span className="label">Date Range:</span>
          <span className="value">{summary.dateRange}</span>
        </div>
        {summary.latest && (
          <div className="summary-item">
            <span className="label">Latest Reading:</span>
            <span className="value">{new Date(summary.latest).toLocaleString()}</span>
          </div>
        )}
      </div>
    </div>
  );
}