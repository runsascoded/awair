export interface AwairRecord {
  timestamp: string;
  temp: number;
  co2: number;
  pm10: number;
  pm25: number;
  humid: number;
  voc: number;
}

export interface DataSummary {
  count: number;
  earliest: string | null;
  latest: string | null;
  dateRange: string;
}