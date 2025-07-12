"""Configuration and utility functions for Awair CLI."""

import json
import requests
from os import getenv, makedirs
from os.path import exists, expanduser, join
from functools import cache, partial
from urllib.parse import quote_plus

from click import echo


err = partial(echo, err=True)

# API endpoints
V1 = 'https://developer-apis.awair.is/v1'
SELF = f'{V1}/users/self'
DEVICES = f'{SELF}/devices'


def parse_s3_path(s3_path: str) -> tuple[str, str]:
    """Parse S3 path into bucket and key components."""
    if not s3_path.startswith('s3://'):
        raise ValueError(f"Invalid S3 path: {s3_path}. Must start with 's3://'")

    path = s3_path[5:]  # Remove 's3://'
    parts = path.split('/', 1)
    bucket = parts[0]
    key = parts[1] if len(parts) > 1 else ''

    if not bucket:
        raise ValueError(f"Invalid S3 path: {s3_path}. Missing bucket name")
    if not key:
        raise ValueError(f"Invalid S3 path: {s3_path}. Missing key/object name")

    return bucket, key


def get_default_data_path():
    """Get default data file path from env var, local file, or fallback."""
    # Try environment variable first
    data_path = getenv('AWAIR_DATA_PATH')
    if data_path:
        return data_path.strip()

    # Try local .awair-data-path file
    if exists('.awair-data-path'):
        with open('.awair-data-path', 'r') as f:
            return f.read().strip()

    # Try ~/.awair/data-path
    awair_dir = expanduser('~/.awair')
    data_path_file = join(awair_dir, 'data-path')
    if exists(data_path_file):
        with open(data_path_file, 'r') as f:
            return f.read().strip()

    # Default fallback
    return 's3://380nwk/awair.parquet'


def get_devices():
    """Get devices list from API."""
    res = get(DEVICES)
    return res['devices']


def get_device_config() -> tuple[str, int]:
    """Get device type and ID from env vars, config files, or auto-discovery."""
    # Try environment variables first
    device_type = getenv('AWAIR_DEVICE_TYPE')
    device_id = getenv('AWAIR_DEVICE_ID')

    if device_type and device_id:
        return device_type.strip(), int(device_id.strip())

    # Try config files (local, lambda package, then user config)
    config_paths = [
        '.awair-device',
        '.awair/device',  # Lambda package baked-in config (relative to working dir)
        '/var/task/.awair/device',  # Lambda package baked-in config (absolute path for Lambda)
        join(expanduser('~/.awair'), 'device')
    ]

    for config_path in config_paths:
        if exists(config_path):
            with open(config_path, 'r') as f:
                content = f.read().strip()
                if ',' in content:
                    device_type, device_id = content.split(',', 1)
                    return device_type.strip(), int(device_id.strip())

    # Auto-discover from devices API
    try:
        devices_data = get_devices()
        if not devices_data:
            raise ValueError("No devices found in your Awair account")

        if len(devices_data) > 1:
            err(f"Multiple devices found ({len(devices_data)}). Please configure specific device.")
            for i, device in enumerate(devices_data):
                err(f"  {i+1}. {device['deviceType']} ID: {device['deviceId']}")
            raise ValueError("Multiple devices found - manual configuration required")

        # Single device found - use it and save for future
        device = devices_data[0]
        device_type = device['deviceType']
        device_id = device['deviceId']

        # Save to user config for future use
        awair_dir = expanduser('~/.awair')
        makedirs(awair_dir, exist_ok=True)
        config_file = join(awair_dir, 'device')
        with open(config_file, 'w') as f:
            f.write(f"{device_type},{device_id}")

        echo(f"Auto-configured device: {device_type} ID: {device_id}")
        echo(f"Saved to: {config_file}")

        return device_type, device_id

    except Exception as e:
        raise ValueError(f"Failed to get device configuration: {e}")


@cache
def get_device_info():
    """Cached device configuration."""
    return get_device_config()


@cache
def get_token():
    # Try environment variable first
    token = getenv('AWAIR_TOKEN')
    if token:
        return token.strip()

    # Try local .token file
    if exists('.token'):
        with open('.token', 'r') as f:
            return f.read().strip()

    # Try ~/.awair/token
    awair_dir = expanduser('~/.awair')
    token_file = join(awair_dir, 'token')
    if exists(token_file):
        with open(token_file, 'r') as f:
            return f.read().strip()

    raise ValueError("No Awair token found. Set AWAIR_TOKEN env var or create .token file")


def get(url: str):
    token = get_token()
    res = requests.get(
        url,
        headers={'authorization': f'Bearer {token}'},
    )
    res.raise_for_status()
    return res.json()