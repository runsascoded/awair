# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The `awair` project is a Python CLI tool and automated data collection system for Awair air quality sensors. It consists of:

1. **AWS Lambda function** that fetches data from the Awair API every 3-5 minutes and appends to `s3://380nwk/awair.parquet`
2. **Web dashboard** (React/TypeScript) that reads the Parquet file directly from S3 and visualizes air quality metrics
3. **CLI tool** for manual data fetching, analysis, and Lambda deployment

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

```bash
# Deploy Lambda from PyPI (production)
awair lambda deploy                    # Deploy latest PyPI version
awair lambda deploy -v 0.0.5          # Deploy specific version
awair lambda deploy -r 5              # Set 5-minute refresh interval

# Deploy Lambda from source (development)
awair lambda deploy -v source         # Deploy local changes

# Other Lambda commands
awair lambda package                  # Build package only
awair lambda synth                    # View CloudFormation template
awair lambda test                     # Test locally
awair lambda logs --follow            # Monitor logs
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
Lambda (every 3-5 min) → S3 (s3://380nwk/awair.parquet)
    ↑                         ↓
Python CLI              Web Dashboard (reads directly from S3)
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
  - Sets up EventBridge schedule (default: 3 minutes)
  - Uses AWS Lambda Pandas layer for pandas/pyarrow dependencies
  - Reserved concurrency of 1 (prevents race conditions)

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

Unified configuration flow with cascading precedence:

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

**Data Path**:
1. `AWAIR_DATA_PATH` environment variable
2. `.awair-data-path` file
3. `~/.awair/data-path` file
4. Default: `s3://380nwk/awair.parquet`

#### 5. Web Dashboard (`www/`)

React + TypeScript + Vite application:

- **`src/services/awairService.ts`**: Fetches Parquet file from S3
  - Uses `hyparquet` library to read Parquet directly in browser
  - Public S3 URL: `https://380nwk.s3.amazonaws.com/awair.parquet`
  - No backend API needed - reads S3 directly

- **Components**:
  - `AwairChart.tsx`: Main Plotly.js chart with dual Y-axis support
  - `ChartControls.tsx`: Time range and metric selection
  - `DataTable.tsx`: Paginated data table
  - `ThemeToggle.tsx`: Dark/light mode switcher

- **Hooks**:
  - `useAwairData.ts`: React Query integration for data fetching
  - `useDataAggregation.ts`: Adaptive aggregation based on zoom level
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

- **Awair API limit**: 500 requests/day
- **Lambda schedule**: Every 3-5 minutes (configurable via `-r` flag)
- **Daily requests**: 288/day (5 min) or 480/day (3 min) - well under limit
- **Reserved concurrency**: 1 (no concurrent executions, prevents race conditions)

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

The web dashboard is automatically deployed to GitHub Pages when changes are pushed to the `www/` directory on the `main` branch. It reads the Parquet file directly from S3 (no API server needed).
