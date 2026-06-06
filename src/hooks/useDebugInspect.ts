import {useEffect} from 'react';
import {DebugTelemetryEngine} from '../lib/telemetry';

export function useDebugInspect(moduleName: string, stateObject: unknown) {
  useEffect(() => {
    DebugTelemetryEngine.getInstance().updateState(moduleName, stateObject);
    return () => {
      DebugTelemetryEngine.getInstance().removeState(moduleName);
    };
  }, [moduleName, stateObject]);
}
