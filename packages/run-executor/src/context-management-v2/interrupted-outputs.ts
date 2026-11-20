import type { ResponseInputItem } from "openai/resources/responses/responses";

// A response is stored as a whole before tools start, so unstarted siblings need
// answers too. Complete that tail before adding the next user's message.
export function interruptedToolOutputs(items: ResponseInputItem[], seeds: ResponseInputItem[]): ResponseInputItem[] {
  const answered = new Set(items.flatMap((item) => {
    const record = item as { type?: string; call_id?: string };
    return record.type?.endsWith("_call_output") && record.call_id ? [`${record.type}:${record.call_id}`] : [];
  }));
  return items.flatMap((item): ResponseInputItem[] => {
    const record = item as { type?: string; call_id?: string };
    if (!record.call_id || !["function_call", "custom_tool_call", "apply_patch_call"].includes(record.type ?? "")) return [];
    const type = `${record.type}_output`;
    const key = `${type}:${record.call_id}`;
    if (answered.has(key)) return [];
    answered.add(key);
    const actual = seeds.find((seed) => seed.type === type && (seed as { call_id?: string }).call_id === record.call_id);
    if (actual) return [actual];
    return [{ type, call_id: record.call_id,
      ...(record.type === "apply_patch_call" ? { status: "failed" } : {}),
      output: JSON.stringify({ error: "The previous run ended before this call returned. Its effects are unknown; check before repeating it." })
    } as ResponseInputItem];
  });
}
