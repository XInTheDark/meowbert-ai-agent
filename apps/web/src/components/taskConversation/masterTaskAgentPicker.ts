// The Project Master composer's second picker: the agent the Master's tasks run on. A null
// selection means the workspace default.
export interface MasterTaskAgentPicker {
  selectedAgentId: string | null;
  onChange: (agentId: string | null) => void;
}
