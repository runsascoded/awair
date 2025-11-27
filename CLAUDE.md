# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The `awair` project is a Python CLI tool and automated data collection system for Awair air quality sensors. It consists of:

1. **AWS Lambda functions** (one per device) that fetch data from the Awair API every minute and append to device-specific S3 Parquet files
2. **Web dashboard** (React/TypeScript) that reads Parquet files directly from S3 and visualizes air quality metrics with multi-device support
3. **CLI tool** for manual data fetching, analysis, and multi-device Lambda deployment

## Common Commands

### Python CLI Development

```bash
# Setup environment (uses multi-version venv system)
spd                           # Initialize project with direnv + uv
uv sync                       # Install dependencies
vl                            # List available Python versions
vsw 3.13                      # Switch to Python 3.13

# Code style
ruff check
ruff format

# Testing
pytest
pytest test/test_cli.py       # Run specific test file

# CLI usage
awair --help                  # Main CLI help
awair api raw --help          # Fetch raw data
awair data-info               # Show Parquet file summary
awair hist                    # Histogram of record counts
awair gaps                    # Find timing gaps in data
```

### Lambda Deployment

**Device IDs:**
- **Gym** = 17617
- **BR** = 137496

```bash
# Deploy Lambda for a device (1-minute intervals)
# Uses AWAIR_S3_ROOT (default: s3://380nwk) for data path
AWAIR_DEVICE_ID=17617 awair lambda deploy -s awair-updater-17617 -r 1    # Gym
AWAIR_DEVICE_ID=137496 awair lambda deploy -s awair-updater-137496 -r 1  # BR

# Deploy from source (development)
AWAIR_DEVICE_ID=17617 awair lambda deploy -v source -s awair-updater-17617 -r 1

# Other Lambda commands
awair lambda package                  # Build package only
awair lambda synth                    # View CloudFormation template
awair lambda test                     # Test locally

# Monitor logs (specify function)
aws logs tail /aws/lambda/awair-updater-17617 --follow  # Gym
aws logs tail /aws/lambda/awair-updater-137496 --follow  # BR
```

### Web Dashboard Development

```bash
cd www
pnpm install                  # Install dependencies
pnpm run dev                  # Start dev server (http://localhost:5173)
pnpm run build                # Build for production
pnpm run lint                 # Lint code
pnpm run test                 # Run tests
```

## Architecture

### Data Flow

```
Awair API
    ↓
Lambda (every 1 min) → S3 (device-specific parquet files)
    ↑                    ↓
Python CLI         Web Dashboard (reads directly from S3)

Multi-Device Example:
  Gym (17617):  EventBridge (1min) → Lambda → s3://380nwk/awair-17617.parquet
  BR (137496):   EventBridge (1min) → Lambda → s3://380nwk/awair-137496.parquet
```

### Key Components

#### 1. Lambda Data Updater (`src/awair/lmbda/`)

The Lambda function runs on a schedule (EventBridge) and atomically updates the S3 Parquet file:

- **`updater.py`**: Lambda handler (`lambda_handler()` entry point)
  - Uses `utz.s3.atomic_edit` context manager for safe concurrent S3 updates
  - Fetches incremental data since latest timestamp in Parquet file
  - Deduplicates and merges with existing data using `ParquetStorage`

- **`app.py`**: CDK infrastructure definition
  - Creates Lambda function with IAM permissions dynamically based on configured S3 path
  - Sets up EventBridge schedule (default: 1 minute, configurable via `-r` flag)
  - Uses AWS Lambda Pandas layer for pandas/pyarrow dependencies
  - Reserved concurrency of 1 (prevents race conditions)
  - Stack name configurable via `--stack-name` / `-s` flag

- **`deploy.py`**: Deployment orchestration
  - `create_lambda_package()`: Builds deployment ZIP from PyPI or source
    - PyPI mode: installs specific version from PyPI (immutable, versioned)
    - Source mode: bundles local code (for development/testing)
  - `bake_device_config()`: Embeds device configuration into package
  - `deploy_with_cdk()`: Runs CDK deployment with environment variables
  - Resolves actual installed version from package metadata

#### 2. Storage Layer (`src/awair/storage.py`)

`ParquetStorage` class provides context-managed access to Parquet files (local or S3):

- **Context manager pattern**: Loads on `__enter__`, saves on `__exit__` if dirty
- **S3 support**: Works transparently with `s3://bucket/key` paths via pandas
- **Deduplication**: `insert_air_data()` merges new records, handles conflicts
- **Conflict handling**: Three modes: `warn` (default), `error`, `replace`
- **Timezone handling**: Normalizes all timestamps to naive UTC

Fields: `timestamp`, `temp`, `co2`, `pm10`, `pm25`, `humid`, `voc`

#### 3. API Client (`src/awair/cli/api.py`)

- **`fetch_raw_data()`**: Fetches data from Awair API with rate limiting
  - Returns dict with success status, data, and metadata
  - Handles 429 rate limit errors gracefully
  - Calculates actual time range and average interval

- **`fetch_date_range()`**: Fetches data across large time ranges
  - Adaptive chunking based on API responses
  - Backward iteration (newest to oldest)
  - Integrates with `ParquetStorage` for incremental updates

#### 4. Configuration (`src/awair/cli/config.py`)

**S3 Root** (single config for all data storage):
- `AWAIR_S3_ROOT` environment variable
- Default: `s3://380nwk`

All data files follow a fixed structure under the S3 root:
```
{S3_ROOT}/
├── devices.parquet             # Device registry (cached from API)
├── awair-17617.parquet         # Device data files
├── awair-137496.parquet
└── ...
```

**API Token** (required):
1. `AWAIR_TOKEN` environment variable
2. `.token` file (local)
3. `~/.awair/token` file

**Device** (auto-discovers if not set):
1. `AWAIR_DEVICE_TYPE` + `AWAIR_DEVICE_ID` env vars
2. `.awair-device` file (format: `awair-element,12345`)
3. `.awair/device` (Lambda package baked-in config)
4. `~/.awair/device` file
5. Auto-discovery (saves to `~/.awair/device`)

**Device selection** (for CLI commands):
```bash
# Switch devices using -i flag (numeric ID or name pattern)
awair data info -i 17617                 # Numeric device ID
awair data info -i "gym"                 # Name pattern (case-insensitive regex)
awair data gaps -i br -n 10 -m 5         # Works with all data commands
```

Device name resolution:
- Numeric strings or integers → exact device ID match
- Non-numeric strings → regex pattern match against device names (case-insensitive)
- Must match exactly one device (ambiguous patterns raise an error)
- Device list cached in `{S3_ROOT}/devices.parquet` (1 hour TTL)
- Use `awair api devices --refresh` to force refresh cache

#### 5. Web Dashboard (`www/`)

React + TypeScript + Vite application:

- **`src/services/awairService.ts`**: Fetches Parquet files from S3
  - Uses `hyparquet` library to read Parquet directly in browser
  - S3 root: `https://380nwk.s3.amazonaws.com` (HTTP equivalent of `s3://380nwk`)
  - No backend API needed - reads S3 directly

- **Components**:
  - `AwairChart.tsx`: Main Plotly.js chart with dual Y-axis support
  - `ChartControls.tsx`: Time range and metric selection
  - `AggregationControl.tsx`: X-axis grouping/aggregation settings
  - `YAxesControl.tsx`: Y-axis metric selection dropdowns
  - `DevicesControl.tsx`: Multi-device selection
  - `RangeWidthControl.tsx`: Time range duration buttons
  - `DataTable.tsx`: Paginated data table
  - `ThemeToggle.tsx`: Dark/light mode switcher
  - `Tooltip.tsx`: Reusable tooltip component

- **Hooks**:
  - `useDevices.ts`: Fetches device list from S3
  - `useMultiDeviceData.ts`: React Query integration for multi-device data fetching
  - `useMultiDeviceAggregation.ts`: Aggregation across multiple devices
  - `useDataAggregation.ts`: Adaptive aggregation based on zoom level and container width
  - `useTimeRangeParam.ts`: URL-persisted time range state
  - `useMetrics.ts`: URL-persisted Y-axis metric selection
  - `useLatestMode.ts`: Auto-update when new data arrives
  - `useKeyboardShortcuts.ts`: Keyboard navigation (t/c/h/p/v for metrics)

### Lambda Deployment Process

1. **Package Creation** (`deploy.py:create_lambda_package()`):
   - Install dependencies to temp directory
   - Copy source files (PyPI or local) excluding `lmbda/` directory
   - Bake device config into `.awair/device` file in package
   - Create ZIP file (`lambda-updater-deployment.zip` or `lambda-updater-pypi-deployment.zip`)
   - Extract version from package metadata (PyPI) or `pyproject.toml` (source)

2. **CDK Deployment** (`deploy.py:deploy_with_cdk()`):
   - Set environment variables: `AWAIR_TOKEN`, `AWAIR_DATA_PATH`, `AWAIR_VERSION`, etc.
   - Run `cdk deploy` with `app.py` as the CDK app
   - CDK creates: Lambda function, IAM role, EventBridge rule, CloudWatch logs

3. **IAM Permissions** (`app.py:AwairLambdaStack`):
   - Dynamically generates S3 permissions based on configured data path
   - ARN format: `arn:aws:s3:::{bucket}/{key}` for GetObject/PutObject/DeleteObject
   - List permission on bucket: `arn:aws:s3:::{bucket}`

### Rate Limiting and Scheduling

- **Awair API limit**: Unknown; requested 5-6k/day from Awair support (2025-11-21), awaiting confirmation
  - Rate limit error: `{"code":8, "message":"Too many requests during the past 24 hours"}`
  - Test: `curl -H 'Authorization: Bearer $AWAIR_TOKEN' 'https://developer-apis.awair.is/v1/users/self/devices/awair-element/17617/air-data/raw?limit=1'`
- **Lambda schedule**: Every 1 minute (configurable via `-r` flag)
- **Daily requests per device**: 1,440/day (1 min intervals)
- **Multi-device**: 1,440 × N devices per day (e.g., 2,880/day for 2 devices)
- **Reserved concurrency**: 1 per function (no concurrent executions, prevents race conditions)
- **Backfill on rate limit recovery**: Lambda fetches with `limit=360`, API returns up to 60 min/request; gaps catch up at ~1 hour per Lambda invocation

### Atomic S3 Updates

The Lambda uses `utz.s3.atomic_edit` for safe concurrent updates:

```python
with atomic_edit(bucket, key, create_ok=True, download=True) as tmp_path:
    # Work with tmp_path locally
    with ParquetStorage(str(tmp_path)) as storage:
        storage.insert_air_data(data)
    # Automatically uploads on exit
```

This ensures no data loss even if multiple Lambda invocations occur (though reserved concurrency prevents this).

## Development Workflow

### Making Changes to Lambda

1. Test locally: `awair lambda test`
2. Deploy from source: `awair lambda deploy -v source`
3. Monitor logs: `awair lambda logs --follow`
4. Once stable, bump version in `pyproject.toml` and publish to PyPI
5. Deploy production: `awair lambda deploy -v X.Y.Z`

### Publishing to PyPI

```bash
# Update version in pyproject.toml
# Build and publish (commands not shown, use standard Python packaging tools)
# Deploy to production Lambda
awair lambda deploy -v X.Y.Z
```

### Date/Time Format

The CLI uses a compact datetime parser (`src/awair/dt.py`):
- `250710` → July 10, 2025
- `250710T16` → July 10, 2025 at 4 PM UTC
- `20250710T1630` → July 10, 2025 at 4:30 PM UTC

Functions accept both naive datetimes (interpreted as UTC) and timezone-aware datetimes.

## Important Notes

### Lambda Package Exclusions

The `lmbda/` directory is excluded from Lambda deployment packages to avoid:
- Recursive directory issues
- Unnecessary CDK dependencies in Lambda runtime
- Import errors when Lambda code tries to import deployment-only modules

The CLI handles this gracefully via conditional imports in `src/awair/cli/lmbda.py`.

### S3 Path Handling

Both CLI and Lambda respect the same configuration hierarchy for S3 paths. IAM permissions are generated dynamically based on the configured path, so the system works with any S3 bucket/key combination.

### Web Dashboard Deployment

The web dashboard is automatically deployed to GitHub Pages when changes are pushed to the `www/` directory on the `main` branch. It reads device-specific Parquet files directly from public S3 URLs (no API server needed). The device list is read from `s3://380nwk/devices.parquet` (populated by `awair api devices --refresh`). A device selector dropdown appears when multiple devices are configured.

### Data Fetching Architecture

The frontend uses a `DataSource` interface (`www/src/services/dataSource.ts`) to abstract data fetching, enabling comparison of different strategies:

| Source | Description | Status |
|--------|-------------|--------|
| `s3-hyparquet` | Direct S3 read with hyparquet library | Implemented |
| `s3-duckdb-wasm` | Direct S3 read with DuckDB-WASM | Planned |
| `lambda` | AWS Lambda endpoint with pandas/DuckDB | Planned |
| `cfw` | CloudFlare Worker endpoint | Planned |

**Current limitation:** Parquet files have 1 row group (~239k rows), so partial fetches aren't possible. Plan: configure writer to use `row_group_size=10000` to enable hyparquet's HTTP Range Request optimization.

**Performance targets:**
- CloudFlare Workers: ~5ms cold start
- AWS Lambda + SnapStart: ~276ms cold start (Python 3.12+)
- Direct S3: depends on row group structure
