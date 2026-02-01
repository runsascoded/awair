import os
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


def update_s3_data():
    """Update the monthly S3 Parquet file with latest data using atomic_edit.

    Uses monthly sharding: data is stored in files like awair-17617/2025-01.parquet.
    Each Lambda invocation only touches the current month's file, reducing write
    amplification as historical months are immutable.
    """
    from pathlib import Path

    import boto3

    # Get S3 configuration for current month's file
    now = datetime.now(timezone.utc)
    s3_bucket, s3_key = get_monthly_s3_config(now)
    print(f'Target file: s3://{s3_bucket}/{s3_key}')

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
