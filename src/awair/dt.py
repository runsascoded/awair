"""DateTime parsing and handling utilities for the Awair CLI."""

from datetime import datetime, timedelta
from functools import partial
from typing import Callable

from click import BadParameter, Context, Parameter, echo, option


def parse_flexible_datetime(dt_str: str | None) -> str | None:
    """Parse flexible datetime formats into ISO format.

    Supports formats like:
    - 20250630, 250630 (with/without century)
    - 250630T16, 20250630T16:20 (with time components)
    - Full ISO format (returned as-is)

    Args:
        dt_str: Input datetime string in flexible format

    Returns:
        ISO formatted datetime string or None if input is None

    Raises:
        BadParameter: If the input format is invalid
    """
    if not dt_str:
        return None

    # Remove any whitespace
    dt_str = dt_str.strip()

    # If already in ISO format, return as-is
    if 'T' in dt_str and len(dt_str) >= 19:
        return dt_str

    # Handle various compact formats
    # Add century if missing (assume 20xx)
    if len(dt_str) >= 6 and not dt_str.startswith('20'):
        dt_str = '20' + dt_str

    # Parse different components
    date_part = dt_str[:8]  # YYYYMMDD
    time_part = dt_str[8:] if len(dt_str) > 8 else ''

    # Validate and format date part
    if len(date_part) != 8 or not date_part.isdigit():
        raise BadParameter(f'Invalid date format: {dt_str}. Expected formats like 20250630, 250630T16, etc.')

    # Format as YYYY-MM-DD
    formatted_date = f'{date_part[:4]}-{date_part[4:6]}-{date_part[6:8]}'

    # Handle time part
    if not time_part:
        return f'{formatted_date}T00:00:00'

    # Remove T prefix if present
    if time_part.startswith('T'):
        time_part = time_part[1:]

    # Parse time components
    if len(time_part) == 2:  # HH
        formatted_time = f'{time_part}:00:00'
    elif len(time_part) == 4:  # HHMM
        formatted_time = f'{time_part[:2]}:{time_part[2:4]}:00'
    elif len(time_part) == 5 and ':' in time_part:  # HH:MM
        formatted_time = f'{time_part}:00'
    elif len(time_part) == 8 and time_part.count(':') == 2:  # HH:MM:SS
        formatted_time = time_part
    else:
        raise BadParameter(f'Invalid time format in: {dt_str}')

    return f'{formatted_date}T{formatted_time}'


def click_cb(fn: Callable[[str | None], str | None]) -> Callable[[Context, Parameter, str | None], str | None]:
    """Convert a simple callback function to a click callback."""
    def cb(ctx: Context, param: Parameter, value: str | None) -> str | None:
        return fn(value)
    return cb


def dt_range_opts(from_default_days=None, to_default_minutes=None):
    """
    Decorator that adds both -f/--from-dt and -t/--to-dt options with optional auto-fill defaults.

    Args:
        from_default_days: Days to subtract from now if --from-dt not provided (None = no default)
        to_default_minutes: Minutes to add to now if --to-dt not provided (None = no default)

    Returns:
        Decorator function that adds the datetime range options to a click command
    """
    err = partial(echo, err=True)
    def from_callback(value: str | None) -> str | None:
        if value is None:
            if from_default_days is None:
                return None
            default_dt = (datetime.now() - timedelta(days=from_default_days)).isoformat()
            err(f'Auto-filled --from-dt to {from_default_days} days ago: {default_dt}')
            return default_dt
        try:
            return parse_flexible_datetime(value)
        except BadParameter as e:
            raise BadParameter(f'Invalid --from-dt format: {e}')

    def to_callback(value: str | None) -> str | None:
        if value is None:
            if to_default_minutes is None:
                return None
            default_dt = (datetime.now() + timedelta(minutes=to_default_minutes)).isoformat()
            err(f'Auto-filled --to-dt to current time + {to_default_minutes}min: {default_dt}')
            return default_dt
        try:
            return parse_flexible_datetime(value)
        except BadParameter as e:
            raise BadParameter(f'Invalid --to-dt format: {e}')

    def decorator(func):
        # Apply options in reverse order (click applies decorators bottom-up)
        func = option('-t', '--to-dt', callback=click_cb(to_callback), help='End datetime (flexible format)')(func)
        func = option('-f', '--from-dt', callback=click_cb(from_callback), help='Start datetime (flexible format)')(func)
        return func

    return decorator


# Common case: data fetching with 34-day lookback and 10-minute future buffer
dt_range_opts_with_defaults = partial(dt_range_opts, from_default_days=34, to_default_minutes=10)