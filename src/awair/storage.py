from datetime import datetime
import os

import pandas as pd

VAL_FIELDS = ['temp', 'co2', 'pm10', 'pm25', 'humid', 'voc']
FIELDS = ['timestamp'] + VAL_FIELDS


class ParquetStorage:
    def __init__(
        self,
        file_path: str = 'awair.parquet',
        conflict_action: str = 'warn',
    ):
        self.file_path = file_path
        self._batch_df = None
        self._dirty = False
        self.conflict_action = conflict_action

    def __enter__(self):
        """Enter context manager - load existing data into memory."""
        try:
            self._batch_df = pd.read_parquet(self.file_path)
            # Ensure existing timestamps are timezone-naive
            self._batch_df['timestamp'] = pd.to_datetime(self._batch_df['timestamp']).dt.tz_localize(None)
        except (FileNotFoundError, OSError):
            # File doesn't exist (local or S3)
            self._batch_df = pd.DataFrame(columns=FIELDS)
        self._dirty = False
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Exit context manager - save data if dirty."""
        try:
            if self._dirty and self._batch_df is not None:
                # Normalize timestamps to naive (remove timezone info) before sorting
                self._batch_df['timestamp'] = pd.to_datetime(self._batch_df['timestamp']).dt.tz_localize(None)
                # Sort by timestamp and save
                final_df = self._batch_df.sort_values('timestamp').reset_index(drop=True)
                final_df.to_parquet(self.file_path, index=False, engine='pyarrow')
        finally:
            self._batch_df = None
            self._dirty = False

    def insert_air_data(self, data: list[dict]) -> int:
        """Insert air data into the in-memory batch, returning count of inserted records."""
        if not data or self._batch_df is None:
            return 0

        # Convert new data to DataFrame
        new_df = pd.DataFrame(data)
        # Ensure new timestamps are timezone-naive
        new_df['timestamp'] = pd.to_datetime(new_df['timestamp']).dt.tz_localize(None)

        original_count = len(self._batch_df)

        # Combine with existing batch data
        combined_df = pd.concat([self._batch_df, new_df], ignore_index=True)

        # Check for conflicts (same timestamp, different data)
        duplicated_timestamps = combined_df[combined_df.duplicated(subset=['timestamp'], keep=False)]
        if not duplicated_timestamps.empty:
            # Group by timestamp and check if all values match
            conflict_found = False
            for timestamp, group in duplicated_timestamps.groupby('timestamp'):
                unique_rows = group.drop_duplicates()
                if len(unique_rows) > 1:
                    # Found conflicting data for same timestamp
                    conflicts = []
                    for field in VAL_FIELDS:
                        values = unique_rows[field].unique()
                        if len(values) > 1:
                            conflicts.append(f'{field}: {values}')

                    if conflicts:
                        conflict_msg = f'Data conflict at timestamp {timestamp}: {", ".join(conflicts)}'
                        conflict_found = True

                        if self.conflict_action == 'error':
                            raise ValueError(conflict_msg)
                        elif self.conflict_action == 'warn':
                            print(f'WARNING: {conflict_msg}', file=__import__('sys').stderr)
                        # For 'replace' action, we'll keep the new data (last occurrence)

            if conflict_found and self.conflict_action == 'replace':
                # Keep last occurrence (new data)
                self._batch_df = combined_df.drop_duplicates(subset=['timestamp'], keep='last')
            else:
                # Keep first occurrence (existing data)
                self._batch_df = combined_df.drop_duplicates(subset=['timestamp'], keep='first')
        else:
            # No conflicts, just remove exact duplicates
            self._batch_df = combined_df.drop_duplicates(subset=['timestamp'], keep='first')

        inserted_count = len(self._batch_df) - original_count
        if inserted_count > 0:
            self._dirty = True

        return max(0, inserted_count)

    def get_latest_timestamp(self) -> datetime | None:
        """Get the latest timestamp in the data."""
        # If we're in a context manager session, use batch data
        if self._batch_df is not None:
            if self._batch_df.empty:
                return None
            return self._batch_df['timestamp'].max().to_pydatetime()

        # Otherwise read from file/S3
        try:
            df = pd.read_parquet(self.file_path)
            if df.empty:
                return None
            return df['timestamp'].max().to_pydatetime()
        except (FileNotFoundError, OSError):
            return None

    def get_record_count(self) -> int:
        """Get total number of records."""
        # If we're in a context manager session, use batch data
        if self._batch_df is not None:
            return len(self._batch_df)

        # Otherwise read from file/S3
        try:
            df = pd.read_parquet(self.file_path)
            return len(df)
        except (FileNotFoundError, OSError):
            return 0

    def get_data_summary(self) -> dict:
        """Get summary statistics about the data."""
        # If we're in a context manager session, use batch data
        if self._batch_df is not None:
            if self._batch_df.empty:
                return {'count': 0, 'earliest': None, 'latest': None, 'file_size_mb': 0}

            # Get file size (only for local files)
            file_size_mb = 0
            if not self.file_path.startswith('s3://') and os.path.exists(self.file_path):
                file_size_mb = os.path.getsize(self.file_path) / (1024 * 1024)

            return {
                'count': len(self._batch_df),
                'earliest': self._batch_df['timestamp'].min().to_pydatetime(),
                'latest': self._batch_df['timestamp'].max().to_pydatetime(),
                'file_size_mb': file_size_mb,
            }

        # Otherwise read from file/S3
        try:
            df = pd.read_parquet(self.file_path)

            # Get file size (only for local files)
            file_size_mb = 0
            if not self.file_path.startswith('s3://') and os.path.exists(self.file_path):
                file_size_mb = os.path.getsize(self.file_path) / (1024 * 1024)

            if df.empty:
                return {'count': 0, 'earliest': None, 'latest': None, 'file_size_mb': file_size_mb}

            return {
                'count': len(df),
                'earliest': df['timestamp'].min().to_pydatetime(),
                'latest': df['timestamp'].max().to_pydatetime(),
                'file_size_mb': file_size_mb,
            }
        except (FileNotFoundError, OSError):
            return {'count': 0, 'earliest': None, 'latest': None, 'file_size_mb': 0}

    def read_data(self) -> pd.DataFrame:
        """Read all data as a DataFrame."""
        # If we're in a context manager session, use batch data
        if self._batch_df is not None:
            return self._batch_df.copy()

        # Otherwise read from file/S3
        try:
            return pd.read_parquet(self.file_path)
        except (FileNotFoundError, OSError):
            return pd.DataFrame(columns=FIELDS)
