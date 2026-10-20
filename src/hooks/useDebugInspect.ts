import {useEffect} from 'react';
import {DebugTelemetryEngine} from '../lib/telemetry';
import {useDebug} from '../stores/debugStore';

export function useDebugInspect(moduleName: string, stateObject: unknown) {
  const debugState = useDebug();
  const isDebugMode = Boolean(debugState?.isDebugMode);

  useEffect(() => {
    if (!isDebugMode && !DebugTelemetryEngine.isHudActive()) {
      return undefined;
    }
    DebugTelemetryEngine.getInstance().updateState(moduleName, stateObject);
    return () => {
      DebugTelemetryEngine.getInstance().removeState(moduleName);
    };
  }, [isDebugMode, moduleName, stateObject]);
}
