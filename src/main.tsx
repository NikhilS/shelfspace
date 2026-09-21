import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './index.css';
import {interceptConsoleLogs} from './lib/telemetry';
import {registerSW} from 'virtual:pwa-register';

interceptConsoleLogs();

// Register PWA service worker with automatic update checks
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onOfflineReady() {
      console.log('[PWA] Cache ready for offline archiving');
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
