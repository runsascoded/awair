#!/usr/bin/env python
"""Deprecated main CLI entry point - use base.py instead."""

# Re-export the new CLI for backward compatibility
from .base import awair

if __name__ == '__main__':
    awair()
