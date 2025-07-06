from datetime import datetime
from pathlib import Path
from typing import List, Optional

import pandas as pd


def get_sensor_fields():
    """Get list of sensor field names, excluding timestamp."""
    return ['temp', 'co2', 'pm10', 'pm25', 'humid', 'voc']


def get_all_fields():
    """Get list of all field names including timestamp."""
    return ['timestamp'] + get_sensor_fields()


class ParquetStorage:
    def __init__(self, file_path: str = 'awair.parquet'):
        self.file_path = Path(file_path)

    def insert_air_data(self, data: List[dict]) -> int:
        """Insert air data, returning count of inserted records."""
        if not data:
            return 0

        # Convert new data to DataFrame
        new_df = pd.DataFrame(data)
        new_df['timestamp'] = pd.to_datetime(new_df['timestamp'])

        # Load existing data if file exists
        if self.file_path.exists():
            existing_df = pd.read_parquet(self.file_path)
            
            # Combine and remove duplicates
            combined_df = pd.concat([existing_df, new_df], ignore_index=True)
            
            # Check for conflicts (same timestamp, different data)
            duplicated_timestamps = combined_df[combined_df.duplicated(subset=['timestamp'], keep=False)]
            if not duplicated_timestamps.empty:
                # Group by timestamp and check if all values match
                for timestamp, group in duplicated_timestamps.groupby('timestamp'):
                    unique_rows = group.drop_duplicates()
                    if len(unique_rows) > 1:
                        # Found conflicting data for same timestamp
                        conflicts = []
                        for field in get_sensor_fields():
                            values = unique_rows[field].unique()
                            if len(values) > 1:
                                conflicts.append(f'{field}: {values}')
                        
                        if conflicts:
                            raise ValueError(
                                f'Data conflict at timestamp {timestamp}: {", ".join(conflicts)}'
                            )
            
            # Remove duplicates (keeping first occurrence)
            final_df = combined_df.drop_duplicates(subset=['timestamp'], keep='first')
            inserted_count = len(new_df) - len(combined_df) + len(final_df)
        else:
            final_df = new_df
            inserted_count = len(new_df)

        # Sort by timestamp and save
        final_df = final_df.sort_values('timestamp').reset_index(drop=True)
        final_df.to_parquet(self.file_path, index=False, engine='pyarrow')
        
        return max(0, inserted_count)

    def get_latest_timestamp(self) -> Optional[datetime]:
        """Get the latest timestamp in the data."""
        if not self.file_path.exists():
            return None
        
        df = pd.read_parquet(self.file_path)
        if df.empty:
            return None
        
        return df['timestamp'].max().to_pydatetime()

    def get_record_count(self) -> int:
        """Get total number of records."""
        if not self.file_path.exists():
            return 0
        
        df = pd.read_parquet(self.file_path)
        return len(df)

    def get_data_summary(self) -> dict:
        """Get summary statistics about the data."""
        if not self.file_path.exists():
            return {'count': 0, 'earliest': None, 'latest': None}
        
        df = pd.read_parquet(self.file_path)
        if df.empty:
            return {'count': 0, 'earliest': None, 'latest': None}
        
        return {
            'count': len(df),
            'earliest': df['timestamp'].min().to_pydatetime(),
            'latest': df['timestamp'].max().to_pydatetime(),
            'file_size_mb': self.file_path.stat().st_size / (1024 * 1024)
        }