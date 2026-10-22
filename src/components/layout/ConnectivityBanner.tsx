import React from 'react';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';

export function ConnectivityBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 select-none shrink-0"
      role="status"
      aria-live="polite"
      title="Offline — reading from local archive"
      data-testid="connectivity-banner"
    >
      <span
        className="h-2 w-2 rounded-full bg-error shrink-0"
        aria-hidden="true"
      />
      <span className="text-xs font-sans font-medium text-on-surface-variant leading-none">
        Offline
      </span>
    </div>
  );
}
