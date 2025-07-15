# Awair Dashboard Web Application

A real-time air quality monitoring dashboard for Awair sensors, built with React, TypeScript, and Plotly.js.

<a href="https://awair.runsascoded.com" target="_blank">
  <img src="https://raw.githubusercontent.com/runsascoded/awair/v0.0.4/www/public/awair.png" alt="Awair Dashboard" />
</a>

## Features

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
- `ChartControls.tsx`: Time range and metric selection controls
- `DataTable.tsx`: Paginated data table with navigation
- `ThemeToggle.tsx`: Theme switcher and GitHub link

### Custom Hooks

- `useLatestMode`: Manages auto-update functionality
- `useDataAggregation`: Adaptive data aggregation logic
- `useKeyboardShortcuts`: Keyboard navigation

### Data Flow

1. Data is fetched from Lambda API endpoint
2. Aggregated based on current zoom level
3. Rendered in chart and table components
4. Auto-updates when in Latest mode

## Keyboard Shortcuts

- `t`: Temperature
- `c`: CO₂
- `h`: Humidity
- `p`: PM2.5
- `v`: VOC
- `1`: 1 day view
- `3`: 3 days view
- `7`: 7 days view
- `l`: Latest mode toggle
- `a`: All data view

## Configuration

The app loads data from the Lambda function API endpoint. Configuration is stored in session storage for persistence across page reloads.

## License

MIT License - see LICENSE file for details.
