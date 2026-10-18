const LAYER_ID = "mobile-sheet-layer";

// Menus close on document-level "outside" pointer events by checking whether the target is inside their
// own DOM node. A sheet is portalled out of that node, so stop those events at the layer: React still sees
// them (it listens on the portal container itself), but the document-level dismiss handlers do not.
const GUARDED_EVENTS = ["pointerdown", "mousedown", "touchstart", "click"] as const;

function stopAtLayer(event: Event): void {
  event.stopPropagation();
}

/** Returns the shared body-level container that every mobile sheet portals into. */
export function getMobileSheetLayer(): HTMLElement {
  const existing = document.getElementById(LAYER_ID);
  if (existing) {
    return existing;
  }

  const layer = document.createElement("div");
  layer.id = LAYER_ID;
  for (const type of GUARDED_EVENTS) {
    layer.addEventListener(type, stopAtLayer);
  }
  document.body.appendChild(layer);
  return layer;
}
