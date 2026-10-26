import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import './index.css';
import {interceptConsoleLogs} from './lib/telemetry';
import {preloadAllRouteChunks} from './lib/routePreload';

// Activate console log interception so all console.log/info/warn/error entries
// are captured in the in-app Telemetry HUD (Ctrl + ~) as well as Chrome DevTools.
interceptConsoleLogs();

const bootStart =
  typeof window !== 'undefined' &&
  typeof (window as unknown as {__BOOKISH_BOOT_START__?: number})
    .__BOOKISH_BOOT_START__ === 'number'
    ? (window as unknown as {__BOOKISH_BOOT_START__: number})
        .__BOOKISH_BOOT_START__
    : Date.now();

console.info(
  `[boot] main.tsx initialized (+${Date.now() - bootStart}ms) | mode=${import.meta.env.MODE} | url=${typeof window !== 'undefined' ? window.location.pathname : '/'}`,
);

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    void navigator.serviceWorker
      .getRegistrations()
      .then(registrations =>
        Promise.all(registrations.map(reg => reg.unregister())),
      )
      .catch(() => {});
    if ('caches' in window) {
      void caches
        .keys()
        .then(keys => Promise.all(keys.map(key => caches.delete(key))))
        .catch(() => {});
    }
  } else {
    window.addEventListener('load', () => {
      void navigator.serviceWorker
        .register('/sw.js', {scope: '/'})
        .then(() => {
          const schedule =
            'requestIdleCallback' in window
              ? window.requestIdleCallback
              : (cb: () => void) => setTimeout(cb, 1500);
          schedule(() => {
            preloadAllRouteChunks();
          });
        })
        .catch(err => {
          console.warn('[boot] Service Worker registration skipped:', err);
        });
    });
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('[boot] Fatal: #root element not found in document!');
} else {
  if (typeof window !== 'undefined') {
    (window as unknown as {__BOOKISH_BOOTED__?: boolean}).__BOOKISH_BOOTED__ =
      true;
  }
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  console.info(`[boot] React root mounted (+${Date.now() - bootStart}ms)`);
}
