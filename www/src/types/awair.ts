export interface AwairRecord {
  timestamp: Date;
  temp: number;
  co2: number;
  pm10: number;
  pm25: number;
  humid: number;
  voc: number;
  // Server-side smoothed values (from pyrmts `?smooth=…`). Each is the
  // monoid-combined mean / stddev over the smoothing window centered on
  // this bin. Present only when the source returned smoothed columns.
  temp_smooth?: number;     temp_smooth_stddev?: number;
  co2_smooth?: number;      co2_smooth_stddev?: number;
  pm10_smooth?: number;     pm10_smooth_stddev?: number;
  pm25_smooth?: number;     pm25_smooth_stddev?: number;
  humid_smooth?: number;    humid_smooth_stddev?: number;
  voc_smooth?: number;      voc_smooth_stddev?: number;
}

export interface DataSummary {
  count: number;
  earliest: string | null;
  latest: string | null;
  dateRange: string;
}
