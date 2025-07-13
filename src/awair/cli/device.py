"""Device-related CLI commands."""

import json
from sys import stdout

from .base import awair
from .config import get, SELF, DEVICES


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