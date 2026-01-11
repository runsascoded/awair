"""Data analysis and management commands."""

from __future__ import annotations

import pandas as pd
from click import echo, option

from ..dt import dt_range_opts
from ..storage import ParquetStorage
from .base import awair
from .common_opts import device_id_opt
from .config import (
    data_path_opt,
    err,
    get_data_base_path,
    list_monthly_files,
    load_monthly_data,
    resolve_device_by_name_or_id,
)


@awair.group
def data():
    """Analyze archived data."""
    pass


def load_device_data(device_id: str | None, data_path: str) -> tuple[pd.DataFrame, str, bool]:
    """Load device data, trying monthly files first then falling back to single file.

    Args:
        device_id: Device ID (string or numeric)
        data_path: Data path (may be single file or base directory)

    Returns:
        Tuple of (DataFrame, source_description, is_monthly)
    """
    import re

    # If device_id not provided, try to extract from data_path
    # Pattern: awair-{deviceId}.parquet or awair-{deviceId}/
    if device_id is None:
        match = re.search(r'awair-(\d+)(?:\.parquet|/|$)', data_path)
        if match:
            device_id = match.group(1)

    # Try monthly files first
    if device_id is not None:
        if isinstance(device_id, str):
            try:
                _, device_id_int = resolve_device_by_name_or_id(device_id)
            except ValueError:
                device_id_int = int(device_id)
        else:
            device_id_int = device_id

        base_path = get_data_base_path(device_id_int)
        monthly_files = list_monthly_files(base_path)

        if monthly_files:
            df = load_monthly_data(base_path)
            source = f'{base_path}/ ({len(monthly_files)} monthly files)'
            return df, source, True

    # Fall back to single file
    storage = ParquetStorage(data_path)
    df = storage.read_data()
    return df, data_path, False


@data.command
@device_id_opt
@data_path_opt
def info(device_id: str | None, data_path: str):
    """Show data file information.

    Automatically detects and reads from monthly sharded files if available,
    falling back to single-file format.
    """
    df, source, is_monthly = load_device_data(device_id, data_path)

    echo(f'Data source: {source}')

    if df.empty:
        echo('No data found')
        return

    echo(f'Total records: {len(df):,}')

    df['timestamp'] = pd.to_datetime(df['timestamp'])
    earliest = df['timestamp'].min()
    latest = df['timestamp'].max()
    echo(f'Date range: {earliest} to {latest}')

    if is_monthly:
        # Show per-month breakdown
        base_path = source.split(' (')[0]
        monthly_files = list_monthly_files(base_path)
        echo('\nMonthly files:')
        for f in monthly_files:
            month_name = f.split('/')[-1].replace('.parquet', '')
            month_df = pd.read_parquet(f)
            echo(f'  {month_name}: {len(month_df):,} records')


@data.command
@device_id_opt
@data_path_opt
@dt_range_opts()
@option('-n', '--count', default=10, help='Number of largest gaps to show')
@option('-m', '--min-gap', type=int, help='Minimum gap size in seconds to report')
def gaps(
    device_id: str | None,
    data_path: str,
    from_dt: str | None,
    to_dt: str | None,
    count: int,
    min_gap: int | None,
):
    """Find and report the largest timing gaps in the data.

    Automatically detects and reads from monthly sharded files if available.
    """
    df, source, _ = load_device_data(device_id, data_path)

    if df.empty:
        err('No data found')
        return

    # Filter by date range if specified (parsing already handled by option callbacks)
    if from_dt or to_dt:
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        if from_dt:
            from_timestamp = pd.to_datetime(from_dt)
            df = df[df['timestamp'] >= from_timestamp]
        if to_dt:
            to_timestamp = pd.to_datetime(to_dt)
            df = df[df['timestamp'] <= to_timestamp]

        if df.empty:
            err('No data in specified date range')
            return
    else:
        df['timestamp'] = pd.to_datetime(df['timestamp'])

    # Sort by timestamp
    df = df.sort_values('timestamp').reset_index(drop=True)

    # Calculate gaps
    df['prev_timestamp'] = df['timestamp'].shift(1)
    df['gap_seconds'] = (df['timestamp'] - df['prev_timestamp']).dt.total_seconds()

    # Filter for significant gaps (skip first row which has NaN gap)
    gaps_df = df[df['gap_seconds'].notna()].copy()

    if min_gap is not None:
        gaps_df = gaps_df[gaps_df['gap_seconds'] >= min_gap]

    gaps_df = gaps_df.sort_values('gap_seconds', ascending=False)

    if gaps_df.empty:
        if min_gap is not None:
            echo(f'No gaps >= {min_gap} seconds found')
        else:
            echo('No gaps found')
        return

    # Show summary
    date_range = f'{df["timestamp"].min().date()} to {df["timestamp"].max().date()}'

    echo(f'Gap analysis for {source}')
    echo(f'Date range: {date_range}')
    echo(f'Total records: {len(df)}')

    if min_gap is not None:
        filtered_gaps = len(gaps_df)
        total_gap_time = gaps_df['gap_seconds'].sum()
        echo(f'Gaps >= {min_gap}s: {filtered_gaps}')
        echo(f'Total gap time: {total_gap_time / 60:.1f} minutes')

    echo()

    # Show largest gaps
    num_to_show = min(count, len(gaps_df))
    echo(f'Top {num_to_show} largest gaps:')
    for i, row in gaps_df.head(count).iterrows():
        gap_min = row['gap_seconds'] / 60
        prev_ts = row['prev_timestamp'].strftime('%Y-%m-%d %H:%M:%S')
        curr_ts = row['timestamp'].strftime('%Y-%m-%d %H:%M:%S')
        echo(f'{gap_min:5.1f}m gap: {prev_ts} -> {curr_ts}')


@data.command
@device_id_opt
@data_path_opt
@dt_range_opts()
def hist(
    device_id: str | None,
    data_path: str,
    from_dt: str | None,
    to_dt: str | None,
):
    """Generate histogram of record counts per day.

    Automatically detects and reads from monthly sharded files if available.
    """
    df, _, _ = load_device_data(device_id, data_path)

    if df.empty:
        err('No data found')
        return

    # Ensure timestamp is datetime
    df['timestamp'] = pd.to_datetime(df['timestamp'])

    # Filter by date range if specified (parsing already handled by option callbacks)
    if from_dt or to_dt:
        if from_dt:
            from_timestamp = pd.to_datetime(from_dt)
            df = df[df['timestamp'] >= from_timestamp]
        if to_dt:
            to_timestamp = pd.to_datetime(to_dt)
            df = df[df['timestamp'] <= to_timestamp]

        if df.empty:
            err('No data in specified date range')
            return

    # Extract date and count records per day
    df['date'] = df['timestamp'].dt.date
    daily_counts = df.groupby('date').size().reset_index(name='count')

    # Sort by date and display
    daily_counts = daily_counts.sort_values('date')

    for _, row in daily_counts.iterrows():
        echo(f'{row["count"]:7d} {row["date"]}')


# Default row group size for monthly shards
# 5000 rows = ~3.5 days at 1-minute intervals = ~80KB per RG
# Monthly files have ~40-44k rows = ~8-9 RGs, good granularity for caching
DEFAULT_MONTHLY_ROW_GROUP_SIZE = 5000


@data.command
@device_id_opt
@data_path_opt
@option('-n', '--dry-run', is_flag=True, help='Show what would be done without writing files')
@option('-r', '--row-group-size', type=int, default=DEFAULT_MONTHLY_ROW_GROUP_SIZE,
        help=f'Row group size for output files (default: {DEFAULT_MONTHLY_ROW_GROUP_SIZE})')
def shard(device_id: str | None, data_path: str, dry_run: bool, row_group_size: int):
    """Split single parquet file into monthly shards.

    Reads the existing awair-{deviceId}.parquet file and splits it into
    monthly files: awair-{deviceId}/{YYYY-MM}.parquet

    This reduces Lambda write amplification by allowing updates to only
    touch the current month's file.

    Default row group size is 5000 rows (~3.5 days, ~80KB) for good cache
    granularity. Use --row-group-size to customize.
    """
    # Read existing data
    echo(f'Reading: {data_path}')
    storage = ParquetStorage(data_path)
    df = storage.read_data()

    if df.empty:
        err('No data in file')
        return

    echo(f'Using row_group_size: {row_group_size}')

    # Ensure timestamp is datetime and extract year-month
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df['year_month'] = df['timestamp'].dt.strftime('%Y-%m')

    # Group by year-month
    groups = df.groupby('year_month')
    echo(f'Found {len(groups)} months of data:')

    # Determine output base path (directory)
    # e.g., s3://380nwk/awair-17617.parquet -> s3://380nwk/awair-17617/
    if data_path.endswith('.parquet'):
        output_base = data_path[:-8]  # Remove .parquet suffix
    else:
        output_base = data_path

    # Process each month
    for year_month, group_df in sorted(groups):
        count = len(group_df)
        output_path = f'{output_base}/{year_month}.parquet'

        date_range = f'{group_df["timestamp"].min().date()} to {group_df["timestamp"].max().date()}'
        echo(f'  {year_month}: {count:,} records ({date_range})')

        if dry_run:
            echo(f'    Would write: {output_path}')
        else:
            # Prepare DataFrame for writing (remove year_month helper column)
            write_df = group_df.drop(columns=['year_month']).sort_values('timestamp').reset_index(drop=True)

            # Write to monthly file
            write_df.to_parquet(output_path, index=False, engine='pyarrow', row_group_size=row_group_size)
            echo(f'    Wrote: {output_path}')

    total_records = len(df)
    if dry_run:
        echo(f'\nDry run complete. Would shard {total_records:,} records into {len(groups)} monthly files.')
        echo('Run without --dry-run to execute.')
    else:
        echo(f'\nSharded {total_records:,} records into {len(groups)} monthly files.')
        echo(f'Original file preserved: {data_path}')
        echo('After verifying shards, you can delete the original file.')
