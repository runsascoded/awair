import { useAwairData } from './hooks/useAwairData';
import { DataSummary } from './components/DataSummary';
import { AwairChart } from './components/AwairChart';
import './App.css';

function App() {
  const { data, summary, loading, error } = useAwairData();

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

    </div>
  );
}

export default App;