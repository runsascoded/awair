import { QueryClientProvider } from '@tanstack/react-query';
import { useAwairData } from './hooks/useAwairData';
import { DataSummary } from './components/DataSummary';
import { AwairChart } from './components/AwairChart';
import { ThemeProvider } from './contexts/ThemeContext';
import { ThemeToggle } from './components/ThemeToggle';
import { queryClient } from './lib/queryClient';
import './App.css';

function AppContent() {
  const { data, summary, loading, error, lastUpdated, refresh } = useAwairData();

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <h1>Loading Awair Data...</h1>
          <p>Fetching air quality data from S3...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <div className="error">
          <h1>Error Loading Data</h1>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <main>
        {data.length > 0 && <AwairChart data={data} />}
        {summary && <DataSummary summary={summary} />}
      </main>
      <ThemeToggle />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;