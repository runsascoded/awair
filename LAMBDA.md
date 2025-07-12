# AWS Lambda Integration

The Awair CLI now includes integrated AWS Lambda deployment for scheduled data updates.

## Quick Start

```bash
# Deploy the scheduled updater (every 5 minutes)
awair lambda deploy --token YOUR_AWAIR_TOKEN

# Or with environment variable
export AWAIR_TOKEN=your_token_here
awair lambda deploy

# Build package only (no deployment)
awair lambda deploy --dry-run

# Test locally
awair lambda test

# View logs
awair lambda logs --follow
```

## What It Does

Creates a scheduled Lambda function that:
- ✅ Runs every 5 minutes via EventBridge
- ✅ Updates `s3://380nwk/awair.parquet` with latest sensor data
- ✅ Uses `utz.s3.atomic_edit` for safe concurrent updates
- ✅ Integrates with existing CLI functions (`fetch_raw_data`, `ParquetStorage`)
- ✅ Limited to 1 concurrent execution (no race conditions)

## Architecture

```
EventBridge (5min) → Lambda → Awair API → S3 (atomic update)
                      ↓
                 CLI functions (reused)
```

## Files

- `src/awair/lambda/updater.py` - Lambda handler
- `src/awair/lambda/cloudformation.yaml` - Infrastructure template  
- `src/awair/lambda/deploy.py` - Deployment script
- `src/awair/lambda/requirements.txt` - Lambda dependencies
- `src/awair/lambda/test_updater.py` - Local testing

## Integration Benefits

✅ **Code reuse**: Uses existing `fetch_raw_data()` and `ParquetStorage`
✅ **Consistent behavior**: Same data processing as `awair raw -r`
✅ **Easy deployment**: Single command from CLI
✅ **Unified maintenance**: Lambda code lives with main project

## Rate Limiting

- **5-minute intervals** = 288 runs/day  
- **Well under 500/day** Awair API limit
- **~$0.50/month** cost (mostly free tier)

## Monitoring

```bash
# View logs
aws logs tail /aws/lambda/awair-data-updater-updater --follow

# Check function status
aws lambda get-function --function-name awair-data-updater-updater
```