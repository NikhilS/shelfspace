import React, {useState} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {Bug, ChevronDown, List, Database, Trash2} from 'lucide-react';
import {useDebug} from '../stores/debugStore';
import {Button} from '@/components/ui/button';

export const DebugOverlay: React.FC = () => {
  const {isDebugMode, logs, clearLogs, debugData, debugTitle} = useDebug();
  const [isExpanded, setIsExpanded] = useState(false);
  const [view, setView] = useState<'logs' | 'data'>('logs');

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
              <div className="flex gap-4">
                <Button
                  variant="ghost"
                  onClick={() => setView('logs')}
                  className={`flex items-center gap-1 font-bold tracking-wide transition-colors h-8 px-2 py-0 ${
                    view === 'logs'
                      ? 'text-white underline underline-offset-4'
                      : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  <List size={14} />
                  Logs
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setView('data')}
                  className={`flex items-center gap-1 font-bold tracking-wide transition-colors h-8 px-2 py-0 ${
                    view === 'data'
                      ? 'text-white underline underline-offset-4'
                      : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  <Database size={14} />
                  Data
                </Button>
              </div>
              <div className="flex items-center gap-2">
                {view === 'logs' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={clearLogs}
                    className="text-white/40 hover:text-red-400 transition-colors mr-2 h-8 w-8 rounded-full"
                    title="Clear Logs"
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsExpanded(false)}
                  className="text-white/60 hover:text-white transition-colors h-8 w-8 rounded-full"
                  title="Collapse"
                >
                  <ChevronDown size={16} />
                </Button>
              </div>
            </div>

            {view === 'logs' ? (
              <div className="space-y-1">
                {logs.length === 0 ? (
                  <div className="text-white/20 italic py-4">
                    No logs available
                  </div>
                ) : (
                  logs.map(log => (
                    <div key={log.id} className="flex gap-2">
                      <span className="text-white/30 shrink-0">
                        {log.timestamp.toLocaleTimeString([], {
                          hour12: false,
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      <span
                        className={
                          log.level === 'error'
                            ? 'text-red-400'
                            : log.level === 'warn'
                              ? 'text-yellow-400'
                              : 'text-green-400'
                        }
                      >
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div>
                <div className="text-white/60 mb-2 font-bold uppercase text-[10px] tracking-widest">
                  {debugTitle}
                </div>
                <pre className="whitespace-pre-wrap">
                  {debugData
                    ? JSON.stringify(debugData, null, 2)
                    : 'No data captured'}
                </pre>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setIsExpanded(!isExpanded)}
        className="pointer-events-auto flex items-center justify-center w-12 h-12 bg-black/80 backdrop-blur-md border border-white/20 text-green-400 rounded-full shadow-lg hover:bg-black transition-colors"
        title="Toggle Debug Info"
      >
        {isExpanded ? <ChevronDown size={20} /> : <Bug size={20} />}
      </Button>
    </div>
  );
};
