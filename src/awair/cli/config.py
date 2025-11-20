"""Configuration and utility functions for Awair CLI."""

import json
import re
import time
from functools import cache, partial
from os import getenv, makedirs
from os.path import exists, expanduser, join

import requests
from click import echo, option

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
        raise ValueError(f'Invalid S3 path: {s3_path}. Missing bucket name')
    if not key:
        raise ValueError(f'Invalid S3 path: {s3_path}. Missing key/object name')

    return bucket, key


def get_default_data_path(device_id: int | None = None):
    """Get default data file path from env var, local file, or fallback with template support.

    Supports path templates with {device_id} placeholder. For example:
    - AWAIR_DATA_PATH_TEMPLATE='s3://my-bucket/awair-{device_id}.parquet'
    - With device_id=17617, resolves to: s3://my-bucket/awair-17617.parquet

    Args:
        device_id: Optional device ID to use for template interpolation.
                  If not provided, uses get_device_info() to determine device.

    Configuration precedence:
    1. AWAIR_DATA_PATH env var (explicit path, no template expansion)
    2. .awair-data-path file (explicit path, no template expansion)
    3. ~/.awair/data-path file (explicit path, no template expansion)
    4. AWAIR_DATA_PATH_TEMPLATE env var with {device_id} interpolation
    5. Default template: s3://380nwk/awair-{device_id}.parquet
    """
    # Try explicit environment variable first (no template expansion)
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

    # Use template with device_id interpolation
    template = getenv('AWAIR_DATA_PATH_TEMPLATE', 's3://380nwk/awair-{device_id}.parquet')

    # If template contains {device_id}, interpolate it
    if '{device_id}' in template:
        if device_id is None:
            _, device_id = get_device_info()
        return template.format(device_id=device_id)

    # Template without placeholder, return as-is
    return template


def get_devices(force_refresh: bool = False):
    """Get devices list from API with file-based caching.

    Args:
        force_refresh: If True, bypass cache and fetch fresh data from API

    Returns:
        List of device dictionaries from Awair API

    Cache behavior:
        - Cached in ~/.awair/devices-cache.json
        - TTL: 1 hour (3600 seconds)
        - Use `awair api devices --refresh` to force refresh
    """
    awair_dir = expanduser('~/.awair')
    cache_file = join(awair_dir, 'devices-cache.json')
    cache_ttl = 3600  # 1 hour

    # Check cache if not forcing refresh
    if not force_refresh and exists(cache_file):
        try:
            with open(cache_file, 'r') as f:
                cache_data = json.load(f)
                cached_at = cache_data.get('cached_at', 0)
                devices = cache_data.get('devices', [])

                # Check if cache is still valid
                if time.time() - cached_at < cache_ttl:
                    return devices
        except (json.JSONDecodeError, KeyError):
            pass  # Invalid cache, fetch fresh data

    # Fetch fresh data from API
    res = get(DEVICES)
    devices = res['devices']

    # Save to cache
    makedirs(awair_dir, exist_ok=True)
    cache_data = {
        'cached_at': time.time(),
        'devices': devices,
    }
    with open(cache_file, 'w') as f:
        json.dump(cache_data, f, indent=2)

    return devices


def resolve_device_by_name_or_id(name_or_id: str | int) -> tuple[str, int]:
    """Resolve device by name pattern (regex) or numeric ID.

    Args:
        name_or_id: Device ID (int or numeric string) or name pattern (regex string)

    Returns:
        Tuple of (device_type, device_id)

    Raises:
        ValueError: If no devices match, multiple devices match, or other errors
    """
    # If it's an integer or numeric string, treat as device ID
    if isinstance(name_or_id, int):
        devices = get_devices()
        for device in devices:
            if device['deviceId'] == name_or_id:
                return device['deviceType'], device['deviceId']
        raise ValueError(f'No device found with ID: {name_or_id}')

    # Try parsing as integer
    try:
        device_id = int(name_or_id)
        return resolve_device_by_name_or_id(device_id)
    except ValueError:
        pass

    # Treat as name pattern (regex)
    devices = get_devices()
    pattern = re.compile(name_or_id, re.IGNORECASE)

    matches = []
    for device in devices:
        if pattern.search(device['name']):
            matches.append(device)

    if len(matches) == 0:
        err(f'No devices match pattern: {name_or_id!r}')
        err('Available devices:')
        for device in devices:
            err(f'  - {device["name"]!r} (ID: {device["deviceId"]})')
        raise ValueError(f'No devices match pattern: {name_or_id!r}')

    if len(matches) > 1:
        err(f'Multiple devices match pattern: {name_or_id!r}')
        for device in matches:
            err(f'  - {device["name"]!r} (ID: {device["deviceId"]})')
        raise ValueError(f'Ambiguous pattern - {len(matches)} devices match: {name_or_id!r}')

    device = matches[0]
    return device['deviceType'], device['deviceId']


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
        join(expanduser('~/.awair'), 'device'),
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
            raise ValueError('No devices found in your Awair account')

        if len(devices_data) > 1:
            err(f'Multiple devices found ({len(devices_data)}). Please configure specific device.')
            for i, device in enumerate(devices_data):
                err(f'  {i + 1}. {device["deviceType"]} ID: {device["deviceId"]}')
            raise ValueError('Multiple devices found - manual configuration required')

        # Single device found - use it and save for future
        device = devices_data[0]
        device_type = device['deviceType']
        device_id = device['deviceId']

        # Save to user config for future use
        awair_dir = expanduser('~/.awair')
        makedirs(awair_dir, exist_ok=True)
        config_file = join(awair_dir, 'device')
        with open(config_file, 'w') as f:
            f.write(f'{device_type},{device_id}')

        echo(f'Auto-configured device: {device_type} ID: {device_id}')
        echo(f'Saved to: {config_file}')

        return device_type, device_id

    except Exception as e:
        raise ValueError(f'Failed to get device configuration: {e}')


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

    raise ValueError('No Awair token found. Set AWAIR_TOKEN env var or create .token file')


def get(url: str):
    token = get_token()
    res = requests.get(
        url,
        headers={'authorization': f'Bearer {token}'},
    )
    res.raise_for_status()
    return res.json()


# Common click option
# Note: default=None with callback to support lazy evaluation based on device_id
def _resolve_data_path(ctx, param, value):
    """Callback to resolve data path with device_id support."""
    if value is not None:
        return value
    # Get device_id from context if available (passed via device_id_opt)
    device_id_param = ctx.params.get('device_id')
    if device_id_param is not None:
        # Resolve name/pattern to numeric ID
        if isinstance(device_id_param, str):
            _, device_id = resolve_device_by_name_or_id(device_id_param)
        else:
            device_id = device_id_param
    else:
        device_id = None
    return get_default_data_path(device_id)

data_path_opt = option(
    '-d', '--data-path',
    default=None,
    callback=_resolve_data_path,
    help='Data file path (defaults to template-based path using device ID)'
)
