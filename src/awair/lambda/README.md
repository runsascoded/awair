# Awair Data Updater Lambda

Scheduled AWS Lambda function that updates `s3://380nwk/awair.parquet` every 5 minutes with the latest Awair sensor data.

## Architecture

```
EventBridge (every 5min) → Lambda → Awair API → S3 (atomic update)
```

**Key Features:**
- ✅ **Scheduled execution** every 5 minutes via EventBridge
- ✅ **Single concurrency** (ReservedConcurrencyExecutions: 1)
- ✅ **Atomic S3 updates** using `utz.s3.atomic_edit`
- ✅ **Incremental fetching** (only new data since last update)
- ✅ **Rate limit friendly** (~288 API calls/day, well under 500/day limit)

## Deployment

```bash
# 1. Build and deploy
python deploy-updater.py YOUR_AWAIR_TOKEN deploy

# 2. Monitor logs
aws logs tail /aws/lambda/awair-data-updater-updater --follow
```

## How It Works

**On each 5-minute trigger:**

1. **Download** current `awair.parquet` from S3 (if exists)
2. **Check** latest timestamp in existing data
3. **Fetch** new data from Awair API since latest timestamp
4. **Merge** new records with existing data (deduplication)
5. **Upload** updated file back to S3 atomically
6. **Log** results (records added, total count, etc.)

**First run:** Fetches last 7 days of data to bootstrap
**Subsequent runs:** Only fetch data since last update (recent-only mode)

## Rate Limiting

- **5-minute intervals** = 288 runs/day
- **Well under 500/day limit** from Awair API
- **1-2 API calls per run** (depending on data volume)
- **Total: ~300-400 API calls/day**

## S3 File Access

Your static webapp can directly read the Parquet file:

**S3 URL:** `s3://380nwk/awair.parquet`
**Public URL:** `https://380nwk.s3.amazonaws.com/awair.parquet` (if bucket is public)

## Benefits vs On-Demand

✅ **No concurrency races** (single scheduled execution)
✅ **Consistent data freshness** (always <5 minutes old)
✅ **Lower costs** (288 invocations vs per-request)
✅ **Faster webapp** (just read S3, no API calls)
✅ **Better reliability** (webapp works even if Awair API is down)

## Monitoring

```bash
# View recent logs
aws logs tail /aws/lambda/awair-data-updater-updater --follow

# Check function metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=awair-data-updater-updater \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-01-02T00:00:00Z \
  --period 300 \
  --statistics Average
```

## Cost Estimate

- **Lambda invocations:** 288/day × 30 days = 8,640/month
- **Execution time:** ~5s average × 8,640 = 43,200 seconds/month
- **Memory:** 512MB
- **Estimated cost:** ~$0.50/month (well within free tier)