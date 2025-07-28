import React from 'react';
import ReactDOM from 'react-dom/client';
// @ts-expect-error - App.tsx will be added by the test
import App from './App.tsx';
import './index.css';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test code
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
