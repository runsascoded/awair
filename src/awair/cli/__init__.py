"""Awair CLI package."""

# Import base group first
# Import all command modules to register commands
from . import api, data, lmbda  # noqa: F401
from .base import awair

# Export the main CLI group
__all__ = ['awair']
