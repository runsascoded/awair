"""Awair CLI package."""

# Import base group first
from .base import awair

# Import all command modules to register commands
from . import raw, device, data, lmbda

# Export the main CLI group
__all__ = ['awair']
