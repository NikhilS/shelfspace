import React from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {WifiOff} from 'lucide-react';
import {useOnlineStatus} from '../hooks/useOnlineStatus';

export function ConnectivityBanner() {
  const isOnline = useOnlineStatus();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{y: -60, opacity: 0}}
          animate={{y: 0, opacity: 1}}
          exit={{y: -60, opacity: 0}}
          transition={{duration: 0.25, ease: 'easeOut'}}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-auto pointer-events-none"
          role="status"
          aria-live="polite"
          data-testid="connectivity-banner"
        >
          <div className="bg-primary text-on-primary px-4 py-2 rounded-lg shadow-lg flex items-center gap-2.5 text-xs font-semibold tracking-wide border border-outline-variant/30 backdrop-blur-xs">
            <WifiOff className="w-3.5 h-3.5 text-secondary-container shrink-0" />
            <span>Working Offline • Reading from local archive</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
