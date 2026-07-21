import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Required for the browser to consider this app installable as a PWA.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
