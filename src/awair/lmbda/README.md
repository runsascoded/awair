# Awair Data Updater Lambda

Scheduled AWS Lambda functions (one per device) that update device-specific S3 Parquet files every 2 minutes with the latest Awair sensor data.

## Architecture

**Multi-Device Setup:**
```
Device 17617:  EventBridge (2min) → Lambda (awair-updater-17617) → s3://380nwk/awair-17617.parquet
Device 137496: EventBridge (2min) → Lambda (awair-updater-137496) → s3://380nwk/awair-137496.parquet
```

**Key Features:**
- ✅ **Scheduled execution** every 2 minutes via EventBridge (configurable)
- ✅ **Multi-device support** with separate stacks per device
- ✅ **Single concurrency** per function (ReservedConcurrencyExecutions: 1)
- ✅ **Atomic S3 updates** using `utz.s3.atomic_edit`
- ✅ **Incremental fetching** (only new data since last update)
- ✅ **Rate limit friendly** (~720 API calls/day per device, well under 5,000/day limit)

## Deployment

```bash
# Deploy for device 17617
AWAIR_DATA_PATH=s3://380nwk/awair-17617.parquet \
  awair lambda deploy -s awair-updater-17617 -r 2

# Deploy for device 137496
AWAIR_DATA_PATH=s3://380nwk/awair-137496.parquet \
  awair lambda deploy -s awair-updater-137496 -r 2

# Monitor logs (specify function)
aws logs tail /aws/lambda/awair-updater-17617 --follow
```

## How It Works

**On each 2-minute trigger (per device):**

1. **Download** current device parquet from S3 (if exists)
2. **Check** latest timestamp in existing data
3. **Fetch** new data from Awair API since latest timestamp for this device
4. **Merge** new records with existing data (deduplication)
5. **Upload** updated file back to S3 atomically
6. **Log** results (records added, total count, etc.)

**First run:** Fetches last 7 days of data to bootstrap
**Subsequent runs:** Only fetch data since last update (recent-only mode)
**Independent execution:** Each device has its own Lambda function and schedule

## Rate Limiting

Per device:
- **2-minute intervals** = 720 runs/day
- **1-2 API calls per run** (depending on data volume)
- **Total per device: ~720-750 API calls/day**

Multi-device:
- **2 devices**: ~1,440-1,500 requests/day
- **Well under 5,000/day limit** (confirmed by Awair support)
- **Supports up to ~7 devices** at 2-minute intervals

## S3 File Access

Your static webapp can directly read the device-specific Parquet files:

**Device 17617:**
- S3 URL: `s3://380nwk/awair-17617.parquet`
- Public URL: `https://380nwk.s3.amazonaws.com/awair-17617.parquet` (if bucket is public)

**Device 137496:**
- S3 URL: `s3://380nwk/awair-137496.parquet`
- Public URL: `https://380nwk.s3.amazonaws.com/awair-137496.parquet` (if bucket is public)

## Benefits vs On-Demand

✅ **No concurrency races** (single scheduled execution per device)
✅ **Consistent data freshness** (always <2 minutes old)
✅ **Lower costs** (720 invocations/device vs per-request)
✅ **Faster webapp** (just read S3, no API calls)
✅ **Better reliability** (webapp works even if Awair API is down)
✅ **Multi-device ready** (independent stacks scale easily)

## Monitoring

```bash
# View recent logs (per device)
aws logs tail /aws/lambda/awair-updater-17617 --follow
aws logs tail /aws/lambda/awair-updater-137496 --follow

# List all awair functions
aws lambda list-functions | grep awair-updater

# Check function metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=awair-updater-17617 \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-01-02T00:00:00Z \
  --period 120 \
  --statistics Average
```

## Cost Estimate

Per device:
- **Lambda invocations:** 720/day × 30 days = 21,600/month
- **Execution time:** ~5s average × 21,600 = 108,000 seconds/month
- **Memory:** 512MB
- **Estimated cost per device:** ~$0.50/month (mostly free tier)
- **2 devices:** ~$1.00/month total