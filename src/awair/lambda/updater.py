from datetime import datetime, timedelta

import pandas as pd
from utz.s3 import atomic_edit

from awair.cli import fetch_raw_data
from awair.storage import ParquetStorage

# S3 configuration
S3_BUCKET = "380nwk"
S3_KEY = "awair.parquet"

def update_s3_data():
    """Update the S3 Parquet file with latest data using atomic_edit."""
    with atomic_edit(S3_BUCKET, S3_KEY, create_ok=True, download=True) as tmp_path:
        # If file doesn't exist, create empty DataFrame
        if not tmp_path.exists():
            print("Creating initial parquet file")
            empty_df = pd.DataFrame(columns=['timestamp', 'temp', 'humid', 'co2', 'voc', 'pm25'])
            empty_df.to_parquet(tmp_path, index=False)

        # Use ParquetStorage to manage updates
        with ParquetStorage(str(tmp_path)) as storage:
            # Get the latest timestamp to determine what data to fetch
            latest_timestamp = storage.get_latest_timestamp()

            if latest_timestamp:
                # Fetch data since the latest timestamp (recent-only mode)
                from_str = latest_timestamp.isoformat()
                print(f"Fetching data since: {from_str}")
            else:
                # No existing data, fetch last 7 days to start
                from_dt = datetime.now() - timedelta(days=7)
                from_str = from_dt.isoformat()
                print(f"No existing data, fetching from: {from_str}")

            # Fetch new data (10 minutes into future to ensure we get latest)
            to_str = (datetime.now() + timedelta(minutes=10)).isoformat()

            result = fetch_raw_data(
                from_str=from_str,
                to_str=to_str,
                limit=360,
                sleep_interval=0.0  # No sleep needed for single request
            )

            if result['success'] and result['data']:
                inserted = storage.insert_air_data(result['data'])
                print(f"Inserted {inserted} new records")

                # Log current data stats
                summary = storage.get_data_summary()
                print(f"Total records: {summary['count']}")
                if summary['latest']:
                    print(f"Latest timestamp: {summary['latest']}")

                return inserted
            elif result['success']:
                print("No new data available")
                return 0
            else:
                print(f"Failed to fetch data: {result.get('error', 'Unknown error')}")
                return 0

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
