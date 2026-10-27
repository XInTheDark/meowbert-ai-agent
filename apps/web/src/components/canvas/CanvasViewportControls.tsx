import { Monitor, Smartphone, Tablet } from "lucide-react";

export type PanelViewport = "desktop" | "tablet" | "phone";
const VIEWPORTS = [
  { id: "desktop" as const, label: "Full width", icon: Monitor },
  { id: "tablet" as const, label: "Tablet width", icon: Tablet },
  { id: "phone" as const, label: "Phone width", icon: Smartphone }
];

export function CanvasViewportControls(props: {
  document: boolean; fit: boolean; onFit: (fit: boolean) => void;
  viewport: PanelViewport; onViewport: (viewport: PanelViewport) => void;
}) {
  return <div className="canvas-panel-viewports" role="group" aria-label={props.document ? "Document view" : "Preview width"}>
    {props.document ? [true, false].map((fit) => <button key={String(fit)} type="button"
      className={`btn${props.fit === fit ? " active" : ""}`} onClick={() => props.onFit(fit)} aria-pressed={props.fit === fit}>
      {fit ? "Fit" : "100%"}
    </button>) : VIEWPORTS.map(({ id, label, icon: Icon }) => <button key={id} type="button"
      className={`icon-btn${props.viewport === id ? " active" : ""}`} onClick={() => props.onViewport(id)}
      title={label} aria-label={label} aria-pressed={props.viewport === id}><Icon size={14} aria-hidden="true" /></button>)}
  </div>;
}
