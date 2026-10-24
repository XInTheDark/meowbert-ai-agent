import type { MachineProvider } from "./machine-host.js";
import type { ModelGateway } from "./model-gateway.js";
import type { RunControl } from "./run-control.js";
import type { ExecutorSettings } from "./executor-settings.js";
import type { RunFeatures } from "./run-features.js";

// What an executor needs from wherever it runs: the control plane, the model, and a machine.
export interface RunEnvironment {
  control: RunControl;
  models: ModelGateway;
  machines: MachineProvider;
  settings: ExecutorSettings;
  features: RunFeatures;
}
