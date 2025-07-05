#!/usr/bin/env python
import json
from functools import cache
from sys import stdout

import click
import requests


V1 = 'https://developer-apis.awair.is/v1'
DEVICES = f'{V1}/users/self/devices'
DEVICE_ID = 17617
KEYS = ['timestamp', 'temp', 'co2', 'pm10', 'pm25', 'humid', 'voc']


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
def devices():
    res = get(DEVICES)
    devices = res['devices']
    for device in devices:
        json.dump(device, stdout, indent=2)
        print()


@cli.command
def raw():
    """Fetch raw air data from an Awair Element device."""
    # curl -H "authorization: Bearer $tok" 'https://developer-apis.awair.is/v1/users/self/devices/awair-element/17617/air-data/raw?fahrenheit=true'
    res = get(f'{DEVICES}/awair-element/{DEVICE_ID}/air-data/raw?fahrenheit=true')
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

