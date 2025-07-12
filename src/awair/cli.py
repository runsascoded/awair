#!/usr/bin/env python
import json
import os
import time
from datetime import datetime, timedelta
from functools import cache, partial
from pathlib import Path
from sys import stdout
from urllib.parse import quote_plus

import requests
from click import echo, option, Choice, group

from .dt import dt_range_opts
from .storage import ParquetStorage, FIELDS

err = partial(echo, err=True)

# Default data file path
DEFAULT_DATA_PATH = 'awair.parquet'

# Common click options
data_path_opt = option('-d', '--data-path', default=DEFAULT_DATA_PATH, help='Data file path')


V1 = 'https://developer-apis.awair.is/v1'
SELF = f'{V1}/users/self'
DEVICES = f'{SELF}/devices'

DEVICE_TYPE = 'awair-element'
DEVICE_ID = 17617


@cache
def get_token():
    # Try environment variable first
    token = os.getenv('AWAIR_TOKEN')
    if token:
        return token.strip()

    # Try local .token file
    if Path('.token').exists():
        with open('.token', 'r') as f:
            return f.read().strip()

    # Try ~/.awair/token
    awair_dir = Path.home() / '.awair'
    token_file = awair_dir / 'token'
    if token_file.exists():
        with open(token_file, 'r') as f:
            return f.read().strip()

    raise ValueError("No Awair token found. Set AWAIR_TOKEN env var or create .token file")


@group
def awair():
    pass


def get(url: str):
    token = get_token()
    res = requests.get(
        url,
        headers={'authorization': f'Bearer {token}'},
    )
    res.raise_for_status()
    return res.json()


def fetch_raw_data(
    from_str: str = None,
    limit: int = 360,
    to_str: str = None,
    sleep_interval: float = 0.0,
) -> dict:
    """Fetch raw air data and return metadata about the request."""
    query = {
        'fahrenheit': 'true',
        'limit': limit,
    }
    if from_str:
        query['from'] = from_str
    if to_str:
        query['to'] = to_str
    query_str = '&'.join(f'{k}={quote_plus(str(v))}' for k, v in query.items())

    if sleep_interval > 0:
        time.sleep(sleep_interval)

    try:
        res = get(f'{DEVICES}/{DEVICE_TYPE}/{DEVICE_ID}/air-data/raw?{query_str}')
    except requests.exceptions.HTTPError as e:
        obj = {
            'success': False,
            'requested_from': from_str,
            'requested_to': to_str,
            'requested_limit': limit,
        }
        if e.response.status_code == 429:
            return { **obj, 'error': 'rate_limit', 'message': 'Rate limit exceeded (429)', }
        else:
            return { **obj, 'error': 'http_error', 'message': str(e), }

    rows = []
    for datum in res['data']:
        row = {'timestamp': datum['timestamp']}
        sensors = datum['sensors']
        for s in sensors:
            k = s['comp']
            v = s['value']
            row[k] = v
        row = { k: row[k] for k in FIELDS }
        rows.append(row)

    # Calculate actual range and intervals
    actual_from = None
    actual_to = None
    avg_interval = None

    if rows:
        timestamps = [datetime.fromisoformat(row['timestamp'].replace('Z', '+00:00')) for row in rows]
        timestamps.sort()
        actual_from = timestamps[0]
        actual_to = timestamps[-1]

        if len(timestamps) > 1:
            total_duration = (actual_to - actual_from).total_seconds()
            avg_interval = total_duration / (len(timestamps) - 1)

    return {
        'success': True,
        'data': rows,
        'requested_from': from_str,
        'requested_to': to_str,
        'requested_limit': limit,
        'actual_from': actual_from.isoformat() if actual_from else None,
        'actual_to': actual_to.isoformat() if actual_to else None,
        'record_count': len(rows),
        'avg_interval_seconds': avg_interval,
        'avg_interval_minutes': avg_interval / 60 if avg_interval else None,
    }


@awair.command
def self():
    """Get information about the authenticated user account."""
    res = get(SELF)
    json.dump(res, stdout, indent=2)
    print()


@awair.command
def devices():
    """List all devices associated with the authenticated user account."""
    res = get(DEVICES)
    devices = res['devices']
    for device in devices:
        json.dump(device, stdout, indent=2)
        print()


def fetch_date_range(
    from_str: str,
    to_str: str,
    limit: int,
    sleep_s: float,
    storage: ParquetStorage | None,
):
    """Fetch data across a date range using adaptive chunking based on actual data returned."""
    # Parse dates - keep them naive for simplicity, API handles timezone conversion
    start_date = datetime.fromisoformat(from_str)
    end_date = datetime.fromisoformat(to_str)

    total_inserted = 0
    total_requests = 0
    current_end = end_date

    err(f'Fetching data from {start_date} to {end_date}')

    while current_end > start_date:
        from_str = start_date.isoformat()
        to_str = current_end.isoformat()

        result = fetch_raw_data(from_str=from_str, to_str=to_str, limit=limit, sleep_interval=sleep_s)
        total_requests += 1

        if not result['success']:
            handle_fetch_error(result)
            if result['error'] == 'rate_limit':
                err(f'Stopping due to rate limit. Made {total_requests} requests.')
                break
            else:
                err('Continuing with next chunk...')
                # Move back a bit and try again
                current_end = current_end - timedelta(hours=1)
                continue

        print_fetch_result(result)

        if storage and result['data']:
            # Save to Parquet file
            inserted = storage.insert_air_data(result['data'])
            total_inserted += inserted
            err(f'Inserted {inserted} new records')
        elif not storage and result['data']:
            # Output to stdout as JSONL
            for row in result['data']:
                print(json.dumps(row))

        # If no data returned, we're done
        if not result['data']:
            err('No more data available')
            break

        # Use the oldest timestamp from returned data as the new end point
        # Convert to naive datetime for consistency
        oldest_timestamp = datetime.fromisoformat(result['actual_from'].replace('Z', '').replace('+00:00', ''))

        # If we didn't make progress (oldest timestamp is not older than our current end),
        # step back manually to avoid infinite loop
        if oldest_timestamp >= current_end:
            current_end = current_end - timedelta(minutes=1)
        else:
            # Subtract 1 second to avoid potential boundary overlap/gap issues
            current_end = oldest_timestamp - timedelta(seconds=1)

        err(f'Next chunk will end at: {current_end}')

    if storage:
        err(f'Complete! Total requests: {total_requests}, Total inserted: {total_inserted}')
        err(f'Data file now contains {storage.get_record_count()} total records')
    else:
        err(f'Complete! Total requests: {total_requests}')


@awair.command
@option('-a', '--conflict-action', default='warn', type=Choice(['warn', 'error', 'replace']), help='Action on data conflicts: warn (log warning), error (raise exception), replace (overwrite)')
@data_path_opt
@dt_range_opts(from_default_days=34, to_default_minutes=10)
@option('-l', '--limit', default=360, help='Max records per request')
@option('-s', '--sleep-s', default=1.0, help='Sleep interval between requests (seconds)')
@option('-r', '--recent-only', is_flag=True, help='Fetch only new data since latest timestamp in storage')
def raw(
    from_dt: str,
    to_dt: str,
    limit: int,
    data_path: str,
    sleep_s: float,
    conflict_action: str,
    recent_only: bool,
):
    """Fetch raw air data from an Awair Element device. Defaults to last ~month if no date range specified."""
    output_to_stdout = data_path in ['-', '']

    if output_to_stdout:
        fetch_date_range(from_dt, to_dt, limit, sleep_s, None)
    else:
        with ParquetStorage(data_path, conflict_action=conflict_action) as storage:
            if recent_only:
                latest_timestamp = storage.get_latest_timestamp()
                if latest_timestamp:
                    from_dt = latest_timestamp.isoformat()
                    err(f'Recent-only mode: fetching data since {from_dt}')
                else:
                    err(f'No existing data found; reading from {from_dt}')
            fetch_date_range(from_dt, to_dt, limit, sleep_s, storage)


def handle_fetch_error(result: dict):
    """Handle fetch errors with appropriate logging."""
    if result['error'] == 'rate_limit':
        err('Rate limit exceeded. Please wait before making more requests.')
        err(f'Requested range: {result["requested_from"]} to {result["requested_to"]}')
    else:
        err(f'Error fetching data: {result["message"]}')


def print_fetch_result(result: dict):
    """Print detailed information about a fetch result."""
    err(f'Requested: {result["requested_from"]} to {result["requested_to"]} (limit: {result["requested_limit"]})')
    err(f'Actual range: {result["actual_from"]} to {result["actual_to"]}')
    err(f'Records: {result["record_count"]}')
    if result['avg_interval_minutes']:
        err(f'Average interval: {result["avg_interval_minutes"]:.1f} minutes')


@awair.command
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


@awair.command
@data_path_opt
@dt_range_opts()
@option('-n', '--count', default=10, help='Number of largest gaps to show')
@option('-m', '--min-gap', type=int, help='Minimum gap size in seconds to report')
def gaps(data_path: str, from_dt: str | None, to_dt: str | None, count: int, min_gap: int | None):
    """Find and report the largest timing gaps in the data."""
    import pandas as pd

    # Read data
    if not Path(data_path).exists():
        err(f'Data file not found: {data_path}')
        return

    df = pd.read_parquet(data_path)
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


@awair.command
@data_path_opt
@dt_range_opts()
def hist(
    data_path: str,
    from_dt: str | None,
    to_dt: str | None,
):
    """Generate histogram of record counts per day."""
    import pandas as pd

    if not Path(data_path).exists():
        err(f'Data file not found: {data_path}')
        return

    df = pd.read_parquet(data_path)
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


@group()
def lambda_cli():
    """AWS Lambda operations for scheduled data updates."""
    pass

# Add the lambda group to the main awair group
awair.add_command(lambda_cli, name='lambda')


@lambda_cli.command('deploy')
@option('--dry-run', is_flag=True, help='Build package only, do not deploy')
def deploy(dry_run: bool):
    """Deploy the scheduled Lambda updater to AWS using CDK."""
    import subprocess
    import sys
    from pathlib import Path

    # Validate token via unified flow and pass to subprocess
    try:
        token = get_token()
    except ValueError as e:
        err(f'Token error: {e}')
        sys.exit(1)

    lambda_dir = Path(__file__).parent / 'lambda'
    deploy_script = lambda_dir / 'deploy.py'

    if not deploy_script.exists():
        err('Deployment script not found')
        return

    try:
        # Set token in environment for subprocess
        import os
        env = os.environ.copy()
        env['AWAIR_TOKEN'] = token

        if dry_run:
            cmd = [sys.executable, str(deploy_script), 'package']
        else:
            cmd = [sys.executable, str(deploy_script), 'deploy']

        subprocess.run(cmd, check=True, env=env, cwd=lambda_dir)

    except subprocess.CalledProcessError as e:
        err(f'Deployment failed: {e}')
        sys.exit(1)


@lambda_cli.command('test')
def test():
    """Test the Lambda updater locally (without S3)."""
    import subprocess
    import sys
    from pathlib import Path

    lambda_dir = Path(__file__).parent / 'lambda'
    test_script = lambda_dir / 'test_updater.py'

    if not test_script.exists():
        err('Lambda test script not found')
        return

    try:
        subprocess.run([sys.executable, str(test_script)], check=True, cwd=lambda_dir)
    except subprocess.CalledProcessError as e:
        err(f'Test failed: {e}')
        sys.exit(1)


@lambda_cli.command('synth')
def synth():
    """Synthesize CloudFormation template from CDK (without deploying)."""
    import subprocess
    import sys
    from pathlib import Path

    # Validate token via unified flow and pass to subprocess
    try:
        token = get_token()
    except ValueError as e:
        err(f'Token error: {e}')
        sys.exit(1)

    lambda_dir = Path(__file__).parent / 'lambda'
    deploy_script = lambda_dir / 'deploy.py'

    if not deploy_script.exists():
        err('Deployment script not found')
        return

    try:
        # Set token in environment for subprocess
        import os
        env = os.environ.copy()
        env['AWAIR_TOKEN'] = token

        cmd = [sys.executable, str(deploy_script), 'synth']
        subprocess.run(cmd, check=True, env=env, cwd=lambda_dir)

    except subprocess.CalledProcessError as e:
        err(f'Synthesis failed: {e}')
        sys.exit(1)


@lambda_cli.command('logs')
@option('--follow', '-f', is_flag=True, help='Follow logs in real-time')
@option('--stack-name', default='awair-data-updater', help='CloudFormation stack name')
def logs(follow: bool, stack_name: str):
    """View Lambda function logs."""
    import subprocess
    import sys

    function_name = f'{stack_name}-updater'
    log_group = f'/aws/lambda/{function_name}'

    cmd = ['aws', 'logs', 'tail', log_group]
    if follow:
        cmd.append('--follow')

    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        err(f'Failed to fetch logs: {e}')
        sys.exit(1)


if __name__ == '__main__':
    awair()
