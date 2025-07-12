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
    from . import raw_cmd, device_cmd, data_cmd, lambda_cmd

    awair.add_command(raw_cmd.raw)
    awair.add_command(device_cmd.self)
    awair.add_command(device_cmd.devices)
    awair.add_command(data_cmd.data_info)
    awair.add_command(data_cmd.gaps)
    awair.add_command(data_cmd.hist)
    awair.add_command(lambda_cmd.lambda_cli, name='lambda')


# Register commands when module is imported
register_commands()


if __name__ == '__main__':
    awair()