#!/usr/bin/env python
"""Legacy CLI entry point - imports from new package structure."""

# Import everything from the new package for backward compatibility
from .cli import *

# Import specific functions that might be used by other modules
from .cli.config import (
    get_token, get_device_info, get_default_data_path,
    parse_s3_path, get, err
)
from .cli.raw_cmd import fetch_raw_data


if __name__ == '__main__':
    awair()
