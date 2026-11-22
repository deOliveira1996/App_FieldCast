import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { GlobalErrorBoundary } from './components/common';
import { logErrorToDb, resetDatabaseForTests } from './db/database';
import './styles/index.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <GlobalErrorBoundary
        onErrorLog={(record) =>
          logErrorToDb({
            timestampUtcIso: record.timestampUtcIso,
            module: record.module,
            action: record.action,
            message: record.message,
            stack: record.stack,
          })
        }
        onClearCache={resetDatabaseForTests}
      >
        <App />
      </GlobalErrorBoundary>
    </React.StrictMode>,
  );
}
