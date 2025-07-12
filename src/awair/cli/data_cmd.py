"""Data analysis and management commands."""

from click import command, option, echo
import pandas as pd

from .config import err
from .main import data_path_opt
from ..dt import dt_range_opts
from ..storage import ParquetStorage


@command
@data_path_opt
def data_info(data_path: str):
    """Show data file information."""
    storage = ParquetStorage(data_path)
    summary = storage.get_data_summary()

    echo(f'Data file: {data_path}')
    echo(f'Total records: {summary["count"]}')
    if summary['earliest']:
        echo(f'Date range: {summary["earliest"]} to {summary["latest"]}')
        echo(f'File size: {summary["file_size_mb"]:.2f} MB')
    else:
        echo('No data in file')


@command
@data_path_opt
@dt_range_opts()
@option('-n', '--count', default=10, help='Number of largest gaps to show')
@option('-m', '--min-gap', type=int, help='Minimum gap size in seconds to report')
def gaps(data_path: str, from_dt: str | None, to_dt: str | None, count: int, min_gap: int | None):
    """Find and report the largest timing gaps in the data."""

    # Read data
    storage = ParquetStorage(data_path)
    df = storage.read_data()

    if df.empty:
        err('No data in file')
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
    date_range = f"{df['timestamp'].min().date()} to {df['timestamp'].max().date()}"

    echo(f'Gap analysis for {data_path}')
    echo(f'Date range: {date_range}')
    echo(f'Total records: {len(df)}')

    if min_gap is not None:
        filtered_gaps = len(gaps_df)
        total_gap_time = gaps_df['gap_seconds'].sum()
        echo(f'Gaps >= {min_gap}s: {filtered_gaps}')
        echo(f'Total gap time: {total_gap_time/60:.1f} minutes')

    echo()

    # Show largest gaps
    num_to_show = min(count, len(gaps_df))
    echo(f'Top {num_to_show} largest gaps:')
    for i, row in gaps_df.head(count).iterrows():
        gap_min = row['gap_seconds'] / 60
        prev_ts = row['prev_timestamp'].strftime('%Y-%m-%d %H:%M:%S')
        curr_ts = row['timestamp'].strftime('%Y-%m-%d %H:%M:%S')
        echo(f'{gap_min:5.1f}m gap: {prev_ts} -> {curr_ts}')


@command
@data_path_opt
@dt_range_opts()
def hist(
    data_path: str,
    from_dt: str | None,
    to_dt: str | None,
):
    """Generate histogram of record counts per day."""

    storage = ParquetStorage(data_path)
    df = storage.read_data()

    if df.empty:
        err('No data in file')
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