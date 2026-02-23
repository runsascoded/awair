# Awair Dashboard Web Application

A real-time air quality monitoring dashboard for Awair sensors, built with React, TypeScript, and Plotly.js.

<a href="https://awair.runsascoded.com" target="_blank">
  <img src="https://380nwk.s3.amazonaws.com/awair/og-image.jpg" alt="Awair Dashboard" />
</a>

## Features

- **Multi-Device Support**: Device selector dropdown to switch between multiple sensors (defaults to gym device 17617)
- **Device Differentiation**: Dashed line toggle to distinguish secondary device from primary (solid lines)
- **Real-time Charts**: Interactive time-series visualization of air quality metrics
- **Dual Y-Axis Support**: Compare two metrics simultaneously
- **Adaptive Aggregation**: Automatic data aggregation based on zoom level
- **Latest Mode**: Auto-update charts when new data arrives
- **Table View**: Paginated data table with navigation controls
- **Dark/Light Mode**: Theme toggle with system preference support
- **Keyboard Shortcuts**: Quick navigation and metric selection
- **Responsive Design**: Mobile-friendly interface

## Development

### Prerequisites

- Node.js 20+
- pnpm

### Setup

```bash
cd www
pnpm install
pnpm run dev
```

Visit http://localhost:5173 to view the development server.

### Build

```bash
pnpm run build
```

### Deploy

The app is automatically deployed to GitHub Pages on push to `main` branch when changes are made to the `www/` directory.

## Architecture

### Components

- `AwairChart.tsx`: Main chart component with Plotly.js integration
- `ChartControls.tsx`: Device selector, time range, and metric selection controls
- `DataTable.tsx`: Paginated data table with navigation
- `ThemeToggle.tsx`: Theme switcher and GitHub link

### Custom Hooks

- `useDevices`: Manages device list for multi-device support
- `useAwairData`: Fetches and caches Parquet data from S3 per device
- `useLatestMode`: Manages auto-update functionality
- `useDataAggregation`: Adaptive data aggregation logic
- Keyboard shortcuts powered by [use-kbd] (configured in `config/hotkeyConfig.ts`)

### Data Flow

1. Device list fetched from `s3://380nwk/devices.parquet` (managed by CLI)
2. Parquet data fetched directly from public S3 URLs for selected device (using hyparquet)
3. Data aggregated based on current zoom level
4. Rendered in chart and table components
5. Auto-updates when in Latest mode

### Data Source Abstraction

The app uses a `DataSource` interface (`src/services/dataSource.ts`) to enable benchmarking different fetch strategies:

- **s3-hyparquet** (current): Direct S3 read with hyparquet, client-side filtering
- **s3-duckdb-wasm** (planned): DuckDB-WASM for SQL queries against S3
- **lambda** (planned): AWS Lambda endpoint for server-side filtering
- **cfw** (planned): CloudFlare Worker endpoint for edge filtering

Each implementation reports timing metrics (network, parse, bytes transferred) for comparison.

## Keyboard Shortcuts

Press `?` to open the shortcuts modal, or `⌘K` / `Ctrl+K` for the command palette.

Keyboard shortcuts are powered by [use-kbd].

### Metrics
- `t`: Temperature
- `c`: CO₂
- `h`: Humidity
- `p`: PM2.5
- `v`: VOC

### Time Range
- `1`: 1 day view
- `3`: 3 days view
- `7`: 7 days view
- `a`: All data view
- `l`: Latest mode toggle

[use-kbd]: https://github.com/runsascoded/use-kbd

## Configuration

The app reads Parquet files directly from S3 (no backend API needed). Device list is fetched from `s3://380nwk/devices.parquet`. Chart settings (selected metrics, time range) are stored in session storage for persistence across page reloads.

## License

MIT License - see LICENSE file for details.
