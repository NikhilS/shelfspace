import {useDebug} from '../stores/debugStore';

export function useDebugMode() {
  const {isDebugMode, toggleDebugMode} = useDebug();
  return {isDebugMode, toggleDebugMode};
}
