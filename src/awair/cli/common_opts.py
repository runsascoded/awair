"""Common click option decorators for reuse across CLI commands."""

from click import option

# Version option for Lambda operations (used in deploy and package commands)
version_opt = option(
    '-v', '--version',
    help='Version to deploy/package: PyPI version (e.g., "0.0.1") or "source"/"src" for local source'
)

# Device ID option for multi-device operations
device_id_opt = option(
    '-i', '--device-id',
    type=str,
    help='Device ID (numeric) or name pattern (regex) to use (overrides environment/config)'
)
