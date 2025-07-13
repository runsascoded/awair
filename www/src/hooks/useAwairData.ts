import { useState, useEffect } from 'react';
import { parquetRead } from 'hyparquet';
import type { AwairRecord, DataSummary } from '../types/awair';

const S3_PARQUET_URL = 'https://s3.amazonaws.com/380nwk/awair.parquet';

export function useAwairData() {
  const [data, setData] = useState<AwairRecord[]>([]);
  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        // Fetch the Parquet file
        const response = await fetch(S3_PARQUET_URL);
        if (!response.ok) {
          throw new Error(`Failed to fetch data: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();

        // Parse with hyparquet - collect all rows
        const rows: any[] = [];
        await parquetRead({
          file: arrayBuffer,
          onComplete: (data) => {
            if (Array.isArray(data)) {
              rows.push(...data);
            }
          }
        });

        if (rows.length === 0) {
          throw new Error('No data found in Parquet file');
        }

        // Convert array format to typed records
        // Each row is [timestamp, temp, co2, pm10, pm25, humid, voc]
        // Note: BigInt values need to be converted to numbers
        const records: AwairRecord[] = rows.map((row: any[]) => ({
          timestamp: row[0],
          temp: Number(row[1]),
          co2: Number(row[2]),
          pm10: Number(row[3]),
          pm25: Number(row[4]),
          humid: Number(row[5]),
          voc: Number(row[6]),
        }));

        // Sort by timestamp (newest first)
        records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        // Calculate summary (records are now sorted newest first)
        const count = records.length;
        const latest = count > 0 ? records[0].timestamp : null;
        const earliest = count > 0 ? records[count - 1].timestamp : null;

        let dateRange = 'No data';
        if (earliest && latest) {
          const start = new Date(earliest).toLocaleDateString();
          const end = new Date(latest).toLocaleDateString();
          dateRange = start === end ? start : `${start} - ${end}`;
        }

        setData(records);
        setSummary({ count, earliest, latest, dateRange });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  return { data, summary, loading, error };
}