import React from 'react';
import {Gauge} from 'lucide-react';
import {TelemetryPlugin, TelemetryPluginContext} from '../telemetry';
import {PersistenceTelemetryPanel} from '../../components/PersistenceTelemetryPanel';

export class PersistenceTelemetryPlugin implements TelemetryPlugin {
  public id = 'persistence';
  public name = 'Persistence Telemetry';
  public order = 20;
  public icon = Gauge;

  public badge(ctx: TelemetryPluginContext): string | number | undefined {
    if (ctx.metrics.activeFirestoreListeners > 0) {
      return ctx.metrics.activeFirestoreListeners;
    }
    if (ctx.metrics.totalFirestoreWrites > 0) {
      return `W:${ctx.metrics.totalFirestoreWrites}`;
    }
    return undefined;
  }

  public renderTab(ctx: TelemetryPluginContext): React.ReactNode {
    return <PersistenceTelemetryPanel initialContext={ctx} />;
  }

  public getMetrics() {
    return {
      type: 'persistence',
    };
  }
}
