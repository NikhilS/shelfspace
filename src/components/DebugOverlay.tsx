import React, {useState} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {Bug, ChevronDown} from 'lucide-react';
import {useDebugMode} from '../hooks/useDebugMode';

interface DebugOverlayProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  title?: string;
}

export const DebugOverlay: React.FC<DebugOverlayProps> = ({
  data,
  title = 'Debug Data',
}) => {
  const {isDebugMode} = useDebugMode();
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isDebugMode) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end pointer-events-none">
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{opacity: 0, y: 10, scale: 0.95}}
            animate={{opacity: 1, y: 0, scale: 1}}
            exit={{opacity: 0, y: 10, scale: 0.95}}
            transition={{duration: 0.2}}
            className="bg-black/80 backdrop-blur-md border border-white/20 text-green-400 p-4 rounded-t-xl rounded-bl-xl shadow-2xl w-[90vw] sm:w-[400px] md:w-[600px] max-h-[60vh] overflow-y-auto custom-scrollbar pointer-events-auto mb-2 text-xs font-mono"
            style={{wordBreak: 'break-all'}}
          >
            <div className="flex justify-between items-center mb-2 border-b border-white/20 pb-2">
              <span className="text-white font-bold tracking-wide">
                {title}
              </span>
              <button
                onClick={() => setIsExpanded(false)}
                className="text-white/60 hover:text-white transition-colors"
                title="Collapse"
              >
                <ChevronDown size={16} />
              </button>
            </div>
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(data, null, 2)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="pointer-events-auto flex items-center justify-center w-12 h-12 bg-black/80 backdrop-blur-md border border-white/20 text-green-400 rounded-full shadow-lg hover:bg-black transition-colors"
        title="Toggle Debug Info"
      >
        {isExpanded ? <ChevronDown size={20} /> : <Bug size={20} />}
      </button>
    </div>
  );
};
