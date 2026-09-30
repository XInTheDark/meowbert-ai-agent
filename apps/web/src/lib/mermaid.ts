export type MermaidTheme = "default" | "dark";

// Renders with the bundled mermaid package, so diagrams never load code from a CDN.
export async function renderMermaidSvg(source: string, theme: MermaidTheme): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme });
  const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await mermaid.render(id, source);
  return result.svg;
}
