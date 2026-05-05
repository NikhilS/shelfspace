import {useDebug} from '../contexts/DebugContext';

export function useDebugMode() {
  const {isDebugMode, toggleDebugMode} = useDebug();
  return {isDebugMode, toggleDebugMode};
}
