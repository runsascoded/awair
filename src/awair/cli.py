#!/usr/bin/env python
import json
import time
from functools import cache
from sys import stdout, stderr
from urllib.parse import quote_plus
from datetime import datetime, timedelta

import click
import requests
from click import option, echo

from .database import Database

V1 = 'https://developer-apis.awair.is/v1'
SELF = f'{V1}/users/self'
DEVICES = f'{SELF}/devices'

KEYS = ['timestamp', 'temp', 'co2', 'pm10', 'pm25', 'humid', 'voc']

DEVICE_TYPE = 'awair-element'
DEVICE_ID = 17617


@click.group("awair")
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


def fetch_raw_data(from_dt: str | None = None, limit: int = 360, to_dt: str | None = None, sleep_interval: float = 0.0) -> dict:
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
                'requested_limit': limit
            }
        else:
            return {
                'success': False,
                'error': 'http_error',
                'message': str(e),
                'requested_from': from_dt,
                'requested_to': to_dt,
                'requested_limit': limit
            }

    rows = []
    for datum in res['data']:
        row = { 'timestamp': datum['timestamp'] }
        sensors = datum['sensors']
        for s in sensors:
            k = s['comp']
            v = s['value']
            row[k] = v
        row = {
            k: row[k]
            for k in KEYS
        }
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
        'avg_interval_minutes': avg_interval / 60 if avg_interval else None
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
@option('-f', '--from-dt', help='Start datetime (ISO format)')
@option('-t', '--to-dt', help='End datetime (ISO format)')
@option('-l', '--limit', default=360, help='Max records per request')
@option('-s', '--save', is_flag=True, help='Save to database')
@option('-d', '--db-path', default='awair.db', help='Database file path')
@option('--sleep-s', default=1.0, help='Sleep interval between requests (seconds)')
@option('--chunk-hours', default=6, help='Hours per chunk for large date ranges')
def raw(
    from_dt: str | None,
    to_dt: str | None,
    limit: int,
    save: bool,
    db_path: str,
    sleep_s: float,
    chunk_hours: int,
):
    """Fetch raw air data from an Awair Element device."""
    db = Database(db_path) if save else None

    # If no date range specified, just fetch recent data
    if not from_dt and not to_dt:
        result = fetch_raw_data(limit=limit, sleep_interval=sleep_s)
        if not result['success']:
            handle_fetch_error(result)
            return

        print_fetch_result(result)
        if save and result['data']:
            inserted = db.insert_air_data(result['data'])
            echo(f"Inserted {inserted} records into database")
        elif not save:
            for row in result['data']:
                print(row)
        return

    # Handle date range fetching
    if not from_dt or not to_dt:
        echo("Error: Both --from-dt and --to-dt are required for range fetching")
        return

    fetch_date_range(from_dt, to_dt, limit, chunk_hours, sleep_s, db, save)


def handle_fetch_error(result: dict):
    """Handle fetch errors with appropriate logging."""
    if result['error'] == 'rate_limit':
        echo(f"Rate limit exceeded. Please wait before making more requests.", err=True)
        echo(f"Requested range: {result['requested_from']} to {result['requested_to']}", err=True)
    else:
        echo(f"Error fetching data: {result['message']}", err=True)


def print_fetch_result(result: dict):
    """Print detailed information about a fetch result."""
    echo(f"Requested: {result['requested_from']} to {result['requested_to']} (limit: {result['requested_limit']})")
    echo(f"Actual range: {result['actual_from']} to {result['actual_to']}")
    echo(f"Records: {result['record_count']}")
    if result['avg_interval_minutes']:
        echo(f"Average interval: {result['avg_interval_minutes']:.1f} minutes")


def fetch_date_range(from_dt: str, to_dt: str, limit: int, chunk_hours: int, sleep_s: float, db: Database | None, save: bool):
    """Fetch data across a date range using chunked requests."""
    start_date = datetime.fromisoformat(from_dt.replace('Z', '+00:00'))
    end_date = datetime.fromisoformat(to_dt.replace('Z', '+00:00'))

    total_inserted = 0
    total_requests = 0
    current_date = start_date

    echo(f"Fetching data from {start_date} to {end_date}")

    while current_date < end_date:
        chunk_end = min(current_date + timedelta(hours=chunk_hours), end_date)

        from_dt_str = current_date.isoformat()
        to_dt_str = chunk_end.isoformat()

        result = fetch_raw_data(from_dt=from_dt_str, to_dt=to_dt_str, limit=limit, sleep_interval=sleep_s)
        total_requests += 1

        if not result['success']:
            handle_fetch_error(result)
            if result['error'] == 'rate_limit':
                echo(f"Stopping due to rate limit. Made {total_requests} requests.", err=True)
                break
            else:
                echo("Continuing with next chunk...", err=True)
                current_date = chunk_end
                continue

        print_fetch_result(result)

        if save and result['data'] and db:
            inserted = db.insert_air_data(result['data'])
            total_inserted += inserted
            echo(f"Inserted {inserted} new records")
        elif not save:
            for row in result['data']:
                print(row)

        current_date = chunk_end

    if save:
        echo(f"Complete! Total requests: {total_requests}, Total inserted: {total_inserted}")
        if db:
            echo(f"Database now contains {db.get_record_count()} total records")


@cli.command
@option('-d', '--db-path', default='awair.db', help='Database file path')
@option('--sleep-s', default=9.0, help='Sleep interval between requests (seconds)')
def seed(db_path: str, sleep_s: float):
    """Seed database with all available historical data."""
    db = Database(db_path)

    # Get the latest timestamp in the database
    latest_timestamp = db.get_latest_timestamp()

    # Calculate date range - go back 30 days from now or from latest timestamp
    end_date = datetime.now()
    if latest_timestamp:
        # If we have data, start from the latest timestamp
        start_date = latest_timestamp
        echo(f"Continuing from latest timestamp: {latest_timestamp}")
    else:
        # If no data, go back 30 days
        start_date = end_date - timedelta(days=30)
        echo(f"Starting fresh, going back 30 days to: {start_date}")

    from_dt = start_date.isoformat()
    to_dt = end_date.isoformat()

    fetch_date_range(from_dt, to_dt, 360, 6, sleep_s, db, True)


@cli.command
@option('-d', '--db-path', default='awair.db', help='Database file path')
def db_info(db_path: str):
    """Show database information."""
    db = Database(db_path)
    count = db.get_record_count()
    latest = db.get_latest_timestamp()

    echo(f"Database: {db_path}")
    echo(f"Total records: {count}")
    if latest:
        echo(f"Latest timestamp: {latest}")
    else:
        echo("No data in database")


if __name__ == '__main__':
    cli()
