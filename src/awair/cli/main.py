#!/usr/bin/env python
"""Main CLI entry point for Awair."""

from click import group, option

from .config import get_default_data_path


# Common click options
data_path_opt = option('-d', '--data-path', default=get_default_data_path(), help='Data file path')


@group
def awair():
    pass


# Import and register subcommands
def register_commands():
    """Register all CLI subcommands."""
    from . import raw, device, data, lmbda

    awair.add_command(raw.raw)
    awair.add_command(device.self)
    awair.add_command(device.devices)
    awair.add_command(data.data_info)
    awair.add_command(data.gaps)
    awair.add_command(data.hist)
    awair.add_command(lmbda.cli, name='lambda')


# Register commands when module is imported
register_commands()


if __name__ == '__main__':
    awair()
