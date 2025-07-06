#!/usr/bin/env python
import json
from functools import cache
from sys import stdout
from urllib.parse import quote_plus

import click
import requests
from click import option

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

    for row in rows:
        print(row)


if __name__ == '__main__':
    cli()

