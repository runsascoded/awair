# AWS Lambda Integration

The Awair CLI includes integrated AWS Lambda deployment for scheduled data updates with multi-device support.

## Quick Start

```bash
# Deploy for a specific device
export AWAIR_TOKEN=your_token_here
AWAIR_DATA_PATH=s3://bucket/awair-17617.parquet \
  awair lambda deploy -s awair-updater-17617 -r 2

# Deploy multiple devices (separate stacks)
AWAIR_DEVICE_ID=17617 AWAIR_DATA_PATH=s3://bucket/awair-17617.parquet \
  awair lambda deploy -s awair-updater-17617 -r 2

AWAIR_DEVICE_ID=137496 AWAIR_DATA_PATH=s3://bucket/awair-137496.parquet \
  awair lambda deploy -s awair-updater-137496 -r 2

# Build package only
awair lambda deploy --dry-run

# Test locally
awair lambda test

# View logs (specify function)
aws logs tail /aws/lambda/awair-updater-17617 --follow
```

## What It Does

Creates a scheduled Lambda function per device that:
- ✅ Runs every 2 minutes via EventBridge (configurable)
- ✅ Updates device-specific S3 Parquet file with latest sensor data
- ✅ Uses `utz.s3.atomic_edit` for safe concurrent updates
- ✅ Integrates with existing CLI functions (`fetch_raw_data`, `ParquetStorage`)
- ✅ Limited to 1 concurrent execution per function (no race conditions)
- ✅ Independent scheduling and storage per device

## Architecture

**Multi-Device Setup:**
```
Device 17617:
  EventBridge (2min) → Lambda (awair-updater-17617) → Awair API → s3://bucket/awair-17617.parquet

Device 137496:
  EventBridge (2min) → Lambda (awair-updater-137496) → Awair API → s3://bucket/awair-137496.parquet
```

Each Lambda reuses CLI functions (`fetch_raw_data`, `ParquetStorage`) for consistency.

## Files

- `src/awair/lambda/app.py` - CDK application (infrastructure as code)
- `src/awair/lambda/deploy.py` - CDK deployment script
- `src/awair/lambda/updater.py` - Lambda handler function
- `src/awair/lambda/requirements.txt` - Lambda runtime dependencies
- `src/awair/lambda/requirements-deploy.txt` - CDK deployment dependencies
- `src/awair/lambda/test_updater.py` - Local testing

## CDK Benefits

✅ **Type safety**: Python classes with IDE completion and validation
✅ **Code reuse**: Uses existing `fetch_raw_data()` and `ParquetStorage`
✅ **Consistent behavior**: Same data processing as `awair raw -r`
✅ **Easy deployment**: Single command from CLI
✅ **Unified maintenance**: Infrastructure and Lambda code in same project
✅ **Better abstractions**: `Duration.minutes(5)` vs `"rate(5 minutes)"`

## Rate Limiting

Per device:
- **2-minute intervals** = 720 runs/day
- **Multiple devices**: 720 × N devices per day
- **Example (2 devices)**: 1,440 requests/day total
- **Well within limits**: Awair confirmed 5,000 requests/day available
- **Cost**: ~$0.50/month per device (mostly free tier)

## Monitoring

```bash
# View logs for specific device
aws logs tail /aws/lambda/awair-updater-17617 --follow
aws logs tail /aws/lambda/awair-updater-137496 --follow

# Check function status
aws lambda get-function --function-name awair-updater-17617

# List all awair Lambda functions
aws lambda list-functions | grep awair-updater
```