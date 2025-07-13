"""Raw data fetching commands."""

import json
import time
from datetime import datetime, timedelta
from urllib.parse import quote_plus

import requests
from click import command, option, Choice

from .config import get_device_info, get, DEVICES, err
from .main import data_path_opt
from ..dt import dt_range_opts
from ..storage import ParquetStorage, FIELDS


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
        device_type, device_id = get_device_info()
        res = get(f'{DEVICES}/{device_type}/{device_id}/air-data/raw?{query_str}')
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


@command
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