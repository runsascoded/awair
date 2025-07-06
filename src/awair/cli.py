#!/usr/bin/env python
import json
from functools import cache
from sys import stdout
from urllib.parse import quote_plus
from datetime import datetime, timedelta

import click
import requests
from click import option

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


def fetch_raw_data(from_dt: str | None = None, limit: int = 360, to_dt: str | None = None):
    """Fetch raw air data and return as list of dicts."""
    query = {
        'fahrenheit': 'true',
        'limit': limit,
    }
    if from_dt:
        query['from'] = from_dt
    if to_dt:
        query['to'] = to_dt
    query_str = '&'.join(f'{k}={quote_plus(str(v))}' for k, v in query.items())
    res = get(f'{DEVICES}/{DEVICE_TYPE}/{DEVICE_ID}/air-data/raw?{query_str}')
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
    return rows


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
@option('-f', '--from-dt')
@option('-l', '--limit', default=360)
@option('-t', '--to-dt')
def raw(
    from_dt: str | None,
    limit: int,
    to_dt: str | None,
):
    """Fetch raw air data from an Awair Element device."""
    rows = fetch_raw_data(from_dt, limit, to_dt)
    for row in rows:
        print(row)


@cli.command
@option('-d', '--db-path', default='awair.db', help='Database file path')
def seed(db_path: str):
    """Seed database with all available historical data."""
    db = Database(db_path)
    
    # Get the latest timestamp in the database
    latest_timestamp = db.get_latest_timestamp()
    
    # Calculate date range - go back 30 days from now or from latest timestamp
    end_date = datetime.now()
    if latest_timestamp:
        # If we have data, start from the latest timestamp
        start_date = latest_timestamp
        click.echo(f"Continuing from latest timestamp: {latest_timestamp}")
    else:
        # If no data, go back 30 days
        start_date = end_date - timedelta(days=30)
        click.echo(f"Starting fresh, going back 30 days to: {start_date}")
    
    total_inserted = 0
    current_date = start_date
    
    # Fetch data in chunks (6 hours at a time to stay under 360 limit)
    while current_date < end_date:
        chunk_end = min(current_date + timedelta(hours=6), end_date)
        
        from_dt = current_date.isoformat()
        to_dt = chunk_end.isoformat()
        
        try:
            click.echo(f"Fetching data from {from_dt} to {to_dt}")
            data = fetch_raw_data(from_dt=from_dt, to_dt=to_dt, limit=360)
            
            if data:
                inserted = db.insert_air_data(data)
                total_inserted += inserted
                click.echo(f"Inserted {inserted} new records")
            else:
                click.echo("No data returned for this time range")
                
        except Exception as e:
            click.echo(f"Error fetching data for {from_dt} to {to_dt}: {e}")
        
        current_date = chunk_end
    
    click.echo(f"Seeding complete! Total records inserted: {total_inserted}")
    click.echo(f"Database now contains {db.get_record_count()} total records")


@cli.command
@option('-d', '--db-path', default='awair.db', help='Database file path')
def db_info(db_path: str):
    """Show database information."""
    db = Database(db_path)
    count = db.get_record_count()
    latest = db.get_latest_timestamp()
    
    click.echo(f"Database: {db_path}")
    click.echo(f"Total records: {count}")
    if latest:
        click.echo(f"Latest timestamp: {latest}")
    else:
        click.echo("No data in database")


if __name__ == '__main__':
    cli()

