import os
import re
from datetime import datetime, timedelta, timezone

import pandas as pd
from utz.s3 import atomic_edit

from awair.cli.api import fetch_date_range
from awair.cli.config import parse_s3_path
from awair.storage import ParquetStorage

# Default row group size for monthly files (matches shard command)
# 5000 rows = ~3.5 days at 1-minute intervals = ~80KB per RG
DEFAULT_ROW_GROUP_SIZE = 5000


def get_data_base_path():
    """Get base S3 path for device data (directory for monthly shards).

    Returns path like: s3://380nwk/awair-17617
    """
    data_path = os.getenv('AWAIR_DATA_PATH')
    if not data_path:
        raise ValueError('AWAIR_DATA_PATH environment variable not set')

    if not data_path.startswith('s3://'):
        raise ValueError(f'Lambda requires S3 data path, got: {data_path}')

    # Remove .parquet suffix if present (backward compatibility)
    if data_path.endswith('.parquet'):
        data_path = data_path[:-8]

    return data_path


def get_monthly_s3_config(dt: datetime = None):
    """Get S3 bucket and key for the monthly file containing the given datetime.

    Args:
        dt: Datetime to determine month (defaults to now)

    Returns:
        Tuple of (bucket, key) for the monthly parquet file
    """
    if dt is None:
        dt = datetime.now(timezone.utc)

    base_path = get_data_base_path()
    year_month = dt.strftime('%Y-%m')
    monthly_path = f'{base_path}/{year_month}.parquet'

    bucket, key = parse_s3_path(monthly_path)
    return bucket, key


def device_id_from_data_path(base_path: str) -> int:
    """Extract numeric device ID from an `awair-{id}` path component.

    Examples:
        's3://380nwk/awair-17617' → 17617
        's3://bucket/awair-137496.parquet' → 137496
    """
    m = re.search(r'awair-(\d+)', base_path)
    if not m:
        raise ValueError(f'cannot extract device_id from {base_path!r}')
    return int(m.group(1))


def write_pyrmts_raw_shard(df: pd.DataFrame, device_id: int, now: datetime) -> None:
    """Write the pyrmts `raw` tier shard for the current month from the just-merged df.

    Called after the S3 atomic_edit completes. Best-effort: if R2 isn't reachable
    (creds missing, network blip, …), log and continue — the S3 write already
    succeeded and is the source of truth.
    """
    from awair.pyramid.builder import aggregate_raw, format_key, repo_pyramid_config, row_group_size_for_bin
    from awair.pyramid.io import write_parquet

    config = repo_pyramid_config()
    raw_tier = config.tier('raw')
    period = now.strftime('%Y-%m')

    shard = aggregate_raw(df, device_id=device_id, tier=raw_tier, metrics=config.metrics)
    key = format_key(config.key_template, device_id=device_id, tier='raw', period=period)
    bucket = config.storage.get('bucket')
    if not bucket:
        raise ValueError("pyramid storage config missing 'bucket'")
    url = f'r2://{bucket}/{key}'
    write_parquet(shard, url, row_group_size=row_group_size_for_bin(raw_tier.bin))
    print(f'Wrote pyrmts raw shard: {url} ({len(shard)} rows)')


def update_s3_data():
    """Update the monthly S3 Parquet file with latest data using atomic_edit.

    Uses monthly sharding: data is stored in files like awair-17617/2025-01.parquet.
    Each Lambda invocation only touches the current month's file, reducing write
    amplification as historical months are immutable.

    After the S3 write commits, also writes the pyrmts `raw` tier shard to R2
    so the cfw/serve worker sees fresh data within a Lambda interval.
    """
    from pathlib import Path

    import boto3

    # Get S3 configuration for current month's file
    now = datetime.now(timezone.utc)
    s3_bucket, s3_key = get_monthly_s3_config(now)
    device_id = device_id_from_data_path(get_data_base_path())
    print(f'Target file: s3://{s3_bucket}/{s3_key} (device {device_id})')

    # Change to /tmp directory for Lambda write permissions
    original_cwd = os.getcwd()
    os.chdir('/tmp')
    try:
        # Check if S3 file exists first
        s3 = boto3.client('s3')
        try:
            s3.head_object(Bucket=s3_bucket, Key=s3_key)
            file_exists = True
        except s3.exceptions.ClientError as e:
            if e.response['Error']['Code'] == '404':
                file_exists = False
                print(f'Creating new monthly file for {now.strftime("%Y-%m")}')
            else:
                raise

        with atomic_edit(s3_bucket, s3_key, create_ok=True, download=file_exists) as tmp_path:
            tmp_path = Path(tmp_path)

            # If file doesn't exist, create empty DataFrame with correct column order
            if not tmp_path.exists():
                print('Creating initial parquet file')
                from awair.storage import FIELDS
                empty_df = pd.DataFrame(columns=FIELDS)
                empty_df.to_parquet(tmp_path, index=False, row_group_size=DEFAULT_ROW_GROUP_SIZE)

            # Use ParquetStorage to manage updates
            with ParquetStorage(str(tmp_path)) as storage:
                # Set row group size for new writes
                storage._row_group_size = DEFAULT_ROW_GROUP_SIZE

                # Get the latest timestamp to determine what data to fetch
                latest_timestamp = storage.get_latest_timestamp()

                if latest_timestamp:
                    # Fetch data since the latest timestamp
                    # Use UTC-aware datetime for consistency
                    if latest_timestamp.tzinfo is None:
                        from_dt = latest_timestamp.replace(tzinfo=timezone.utc)
                    else:
                        from_dt = latest_timestamp
                    print(f'Fetching data since: {from_dt.isoformat()}')
                else:
                    # No existing data in this month's file
                    # Start from beginning of month (data will be filtered to this month)
                    from_dt = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                    print(f'New month file, fetching from: {from_dt.isoformat()}')

                # Fetch new data (10 minutes into future to ensure we get latest)
                to_dt = now + timedelta(minutes=10)

                # Check for test mode (limit API requests)
                max_requests = None
                if os.getenv('AWAIR_TEST_MODE'):
                    max_requests = int(os.getenv('AWAIR_TEST_MAX_REQUESTS', '1'))
                    print(f'Test mode: limiting to {max_requests} API request(s)')

                # Use fetch_date_range for automatic pagination/backfill
                inserted = fetch_date_range(
                    from_str=from_dt.isoformat(),
                    to_str=to_dt.isoformat(),
                    limit=360,
                    sleep_s=0.0,  # No sleep needed in Lambda
                    storage=storage,
                    log=print,  # Use print for CloudWatch logs
                    max_requests=max_requests,
                )

                # Snapshot the merged df *before* `storage` flushes on __exit__,
                # so we can derive the pyrmts raw shard from the same bytes that
                # land in S3.
                merged_df = storage.read_data()

        # atomic_edit __exit__ has uploaded tmp_path → S3 by this point.
        # Now do the pyrmts piggyback: best-effort R2 write of the raw tier.
        # Silently skipped if R2 isn't configured (e.g. before R2 creds land
        # in the Lambda env).
        if os.environ.get('R2_ENDPOINT_URL'):
            try:
                write_pyrmts_raw_shard(merged_df, device_id, now)
            except Exception as e:
                print(f'WARN: pyrmts R2 write failed: {e}')
                import traceback
                traceback.print_exc()
        else:
            print('R2_ENDPOINT_URL unset; skipping pyrmts piggyback')

        return inserted
    finally:
        # Restore original working directory
        os.chdir(original_cwd)


def lambda_handler(event, context):
    """AWS Lambda handler function for scheduled data updates."""
    try:
        print(f"Starting data update at {datetime.now().isoformat()}")

        # Update S3 data with latest from Awair API
        new_records = update_s3_data()

        return {
            'statusCode': 200,
            'body': {
                'status': 'success',
                'records_added': new_records,
                'timestamp': datetime.now().isoformat()
            }
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()

        return {
            'statusCode': 500,
            'body': {
                'status': 'error',
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }
        }
