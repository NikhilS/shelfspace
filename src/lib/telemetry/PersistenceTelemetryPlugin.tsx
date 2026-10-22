import React from 'react';
import {Gauge} from 'lucide-react';
import {TelemetryPlugin, TelemetryPluginContext} from './index';
import {PersistenceTelemetryPanel} from '../../components/debug/PersistenceTelemetryPanel';

export class PersistenceTelemetryPlugin implements TelemetryPlugin {
  id = 'persistence';
  name = 'Persistence Telemetry';
  order = 20;
  icon = Gauge;

  badge(ctx: TelemetryPluginContext): string | number | undefined {
    if (ctx.metrics.activeFirestoreListeners > 0) {
      return ctx.metrics.activeFirestoreListeners;
    }
    if (ctx.metrics.totalFirestoreWrites > 0) {
      return `W:${ctx.metrics.totalFirestoreWrites}`;
    }
    return undefined;
  }

  renderTab(ctx: TelemetryPluginContext): React.ReactNode {
    return <PersistenceTelemetryPanel initialContext={ctx} />;
  }

  getMetrics() {
    return {
      type: 'persistence',
    };
  }
}
