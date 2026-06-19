import React from 'react';
import {Sun, Moon, Monitor} from 'lucide-react';
import {useAppStore, ThemeMode} from '../stores/appStore';

export function ThemeToggle() {
  const {theme, setTheme} = useAppStore();

  const cycleTheme = () => {
    const modes: ThemeMode[] = ['light', 'dark', 'system'];
    const currentIndex = modes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % modes.length;
    setTheme(modes[nextIndex]);
  };

  const getIcon = () => {
    switch (theme) {
      case 'light':
        return <Sun className="w-5 h-5 text-on-surface-variant" />;
      case 'dark':
        return <Moon className="w-5 h-5 text-on-surface-variant" />;
      case 'system':
        return <Monitor className="w-5 h-5 text-on-surface-variant" />;
      default:
        return <Sun className="w-5 h-5 text-on-surface-variant" />;
    }
  };

  return (
    <button
      onClick={cycleTheme}
      className="p-2 rounded-full hover:bg-surface-container transition-colors flex items-center justify-center text-on-surface-variant group relative"
      title={`Current theme: ${theme}. Click to cycle.`}
    >
      {getIcon()}
    </button>
  );
}
