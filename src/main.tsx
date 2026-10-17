import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './index.css';
import {interceptConsoleLogs} from './lib/telemetry';

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
  // Proactively unregister any legacy Service Workers so stale precaches can never
  // intercept navigation or serve outdated asset hashes.
  void navigator.serviceWorker
    .getRegistrations()
    .then(registrations => {
      for (const registration of registrations) {
        void registration.unregister();
      }
    })
    .catch(() => {});
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
