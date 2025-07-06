#!/usr/bin/env python
import json
import time
from datetime import datetime, timedelta
from functools import cache, partial
from sys import stdout
from urllib.parse import quote_plus

import click
import pandas as pd
import requests
from click import echo, option

from .storage import ParquetStorage, get_all_fields

err = partial(echo, err=True)

V1 = 'https://developer-apis.awair.is/v1'
SELF = f'{V1}/users/self'
DEVICES = f'{SELF}/devices'

DEVICE_TYPE = 'awair-element'
DEVICE_ID = 17617


@click.group('awair')
def cli():
    pass


@cache
def get_token():
    with open('.token', 'r') as f:
        return f.read().strip()


def get(url: str):
    token = get_token()
    res = requests.get(
        url,
        headers={'authorization': f'Bearer {token}'},
    )
    res.raise_for_status()
    return res.json()


def fetch_raw_data(
    from_dt: str = None,
    limit: int = 360,
    to_dt: str = None,
    sleep_interval: float = 0.0,
) -> dict:
    """Fetch raw air data and return metadata about the request."""
    query = {
        'fahrenheit': 'true',
        'limit': limit,
    }
    if from_dt:
        query['from'] = from_dt
    if to_dt:
        query['to'] = to_dt
    query_str = '&'.join(f'{k}={quote_plus(str(v))}' for k, v in query.items())

    if sleep_interval > 0:
        time.sleep(sleep_interval)

    try:
        res = get(f'{DEVICES}/{DEVICE_TYPE}/{DEVICE_ID}/air-data/raw?{query_str}')
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 429:
            return {
                'success': False,
                'error': 'rate_limit',
                'message': 'Rate limit exceeded (429)',
                'requested_from': from_dt,
                'requested_to': to_dt,
                'requested_limit': limit,
            }
        else:
            return {
                'success': False,
                'error': 'http_error',
                'message': str(e),
                'requested_from': from_dt,
                'requested_to': to_dt,
                'requested_limit': limit,
            }

    rows = []
    for datum in res['data']:
        row = {'timestamp': datum['timestamp']}
        sensors = datum['sensors']
        for s in sensors:
            k = s['comp']
            v = s['value']
            row[k] = v
        row = {k: row[k] for k in get_all_fields()}
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
        'requested_from': from_dt,
        'requested_to': to_dt,
        'requested_limit': limit,
        'actual_from': actual_from.isoformat() if actual_from else None,
        'actual_to': actual_to.isoformat() if actual_to else None,
        'record_count': len(rows),
        'avg_interval_seconds': avg_interval,
        'avg_interval_minutes': avg_interval / 60 if avg_interval else None,
    }


@cli.command
def self():
    res = get(SELF)
    json.dump(res, stdout, indent=2)
    print()


@cli.command
def devices():
    res = get(DEVICES)
    devices = res['devices']
    for device in devices:
        json.dump(device, stdout, indent=2)
        print()


@cli.command
@option('-a', '--conflict-action', default='warn', type=click.Choice(['warn', 'error', 'replace']), help='Action on data conflicts: warn (log warning), error (raise exception), replace (overwrite)')
@option('-d', '--data-path', default='awair.parquet', help='Data file path')
@option('-f', '--from-dt', help='Start datetime (ISO format)')
@option('-l', '--limit', default=360, help='Max records per request')
@option('-s', '--sleep-s', default=1.0, help='Sleep interval between requests (seconds)')
@option('-t', '--to-dt', help='End datetime (ISO format)')
@option('-r', '--recent-only', is_flag=True, help='Fetch only new data since latest timestamp in storage')
def raw(
    from_dt: str | None,
    to_dt: str | None,
    limit: int,
    data_path: str,
    sleep_s: float,
    conflict_action: str,
    recent_only: bool,
):
    """Fetch raw air data from an Awair Element device. Defaults to last ~month if no date range specified."""
    # Check if we should output to stdout as JSONL
    output_to_stdout = data_path in ['-', '']

    if output_to_stdout:
        # Output to stdout as JSONL - use simple date range logic
        if not from_dt and not to_dt:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=2)
            err(f'No date range specified, fetching last 2 days: {start_date.date()} to {end_date.date()}')
            from_dt = start_date.isoformat()
            to_dt = end_date.isoformat()

        # Handle partial date range
        if not from_dt or not to_dt:
            err('Error: Both --from-dt and --to-dt are required')
            return

        fetch_date_range(from_dt, to_dt, limit, sleep_s, None)
    else:
        # Save to Parquet file
        with ParquetStorage(data_path) as storage:
            storage.set_conflict_action(conflict_action)

            # If no date range specified, determine from existing data
            if not from_dt and not to_dt:
                end_date = datetime.now()

                if recent_only:
                    # Recent-only mode: fetch only since latest timestamp
                    latest_timestamp = storage.get_latest_timestamp()
                    if latest_timestamp:
                        start_date = latest_timestamp
                        err(f'Recent-only mode: fetching data since latest timestamp: {start_date}')
                    else:
                        err('Recent-only mode requested but no existing data found. Use default mode to seed initial data.')
                        return
                else:
                    # Default mode: fetch last month + 2 days and merge
                    latest_timestamp = storage.get_latest_timestamp()
                    start_date = end_date - timedelta(days=32)
                    if latest_timestamp:
                        err(f'Default mode: fetching last month + 2 days ({start_date.date()} to {end_date.date()}) and merging with existing data')
                    else:
                        err(f'No existing data, fetching last month + 2 days: {start_date.date()} to {end_date.date()}')

                from_dt = start_date.isoformat()
                to_dt = end_date.isoformat()

            # Handle partial date range
            if not from_dt or not to_dt:
                err('Error: Both --from-dt and --to-dt are required')
                return

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


def fetch_date_range(
    from_dt: str,
    to_dt: str,
    limit: int,
    sleep_s: float,
    storage: ParquetStorage | None,
):
    """Fetch data across a date range using adaptive chunking based on actual data returned."""
    # Parse dates - keep them naive for simplicity, API handles timezone conversion
    start_date = datetime.fromisoformat(from_dt)
    end_date = datetime.fromisoformat(to_dt)

    total_inserted = 0
    total_requests = 0
    current_end = end_date

    err(f'Fetching data from {start_date} to {end_date}')

    while current_end > start_date:
        from_dt_str = start_date.isoformat()
        to_dt_str = current_end.isoformat()

        result = fetch_raw_data(from_dt=from_dt_str, to_dt=to_dt_str, limit=limit, sleep_interval=sleep_s)
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
            current_end = oldest_timestamp

        err(f'Next chunk will end at: {current_end}')

    if storage:
        err(f'Complete! Total requests: {total_requests}, Total inserted: {total_inserted}')
        err(f'Data file now contains {storage.get_record_count()} total records')
    else:
        err(f'Complete! Total requests: {total_requests}')


@cli.command
@option('-d', '--data-path', default='awair.parquet', help='Data file path')
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


if __name__ == '__main__':
    cli()
