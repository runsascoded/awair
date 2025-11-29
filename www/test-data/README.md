# Test Data

This directory contains static Parquet snapshots for E2E testing.

## Files

- `awair-17617.parquet` (3.8 MB) - Gym device data, 177 days (2025-06-05 to 2025-11-29), 254,859 1-minute windows
- `awair-137496.parquet` (291 KB) - BR device data
- `devices.parquet` (8.8 KB) - Device registry with metadata for both devices

## Strategy

Tests use local snapshots to ensure deterministic, reproducible test results with exact values.

### CI/CD Setup

On each host that runs E2E tests, download the snapshot files:

```bash
# From S3 (recommended - always get latest production data)
aws s3 cp s3://380nwk/awair-17617.parquet test-data/
aws s3 cp s3://380nwk/awair-137496.parquet test-data/
aws s3 cp s3://380nwk/devices.parquet test-data/

# Or commit to repo (files are small enough, ~4 MB total)
git add test-data/*.parquet
```

### Updating Test Data

When data ranges change (e.g., new data accumulated), update:
1. Download fresh snapshots from S3
2. Run tests to get actual values
3. Update test assertions in `test/e2e/table-pagination.spec.ts` with exact counts
