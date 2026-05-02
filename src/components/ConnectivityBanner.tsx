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
          initial={{y: -100, opacity: 0}}
          animate={{y: 0, opacity: 1}}
          exit={{y: -100, opacity: 0}}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-auto pointer-events-none"
        >
          <div className="bg-error text-on-error px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium border border-error-container/20">
            <WifiOff className="w-4 h-4" />
            <span>Working Offline</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
