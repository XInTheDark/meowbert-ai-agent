export function formatSwarmAgentLabel(agent: { role?: "leader" | "worker"; slot_index: number }): string {
  return agent.role === "leader" ? "Node leader" : `Worker ${agent.slot_index + 1}`;
}
