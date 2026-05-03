import {useState, useEffect} from 'react';

export function useDebugMode() {
  const [isDebugMode, setIsDebugMode] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('debugMode');
    if (stored === 'true') {
      setIsDebugMode(true);
    }
  }, []);

  const toggleDebugMode = () => {
    setIsDebugMode(prev => {
      const next = !prev;
      localStorage.setItem('debugMode', String(next));
      return next;
    });
  };

  return {isDebugMode, toggleDebugMode};
}
