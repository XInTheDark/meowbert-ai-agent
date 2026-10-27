function installCanvasSelection() {
  var SOURCE = "meowbert-canvas";
  var host = window.parent !== window ? window.parent : null;
  var enabled = false;
  var hovered = null;
  var outline = null;

  function post(element) {
    if (host) host.postMessage({ source: SOURCE, type: "selection", element: element }, "*");
  }

  function escape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function selectorFor(element) {
    var parts = [];
    for (var node = element; node && node.nodeType === 1 && parts.length < 8; node = node.parentElement) {
      var part = node.localName;
      if (node.id && document.querySelectorAll("#" + escape(node.id)).length === 1) {
        parts.unshift(part + "#" + escape(node.id));
        break;
      }
      var siblings = node.parentElement ? Array.from(node.parentElement.children).filter(function (sibling) {
        return sibling.localName === node.localName;
      }) : [];
      if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      parts.unshift(part);
    }
    return parts.join(" > ");
  }

  function describe(element) {
    var attributes = {};
    ["id", "class", "role", "aria-label", "alt", "title", "data-meowbert-id"].forEach(function (key) {
      if (element.hasAttribute(key)) attributes[key] = element.getAttribute(key).slice(0, 300);
    });
    var screen = element.closest("[data-screen-label], [data-label], [data-meowbert-page]");
    return {
      tagName: element.localName,
      selector: selectorFor(element),
      text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 1500),
      attributes: attributes,
      screenLabel: screen ? (screen.getAttribute("data-screen-label") || screen.getAttribute("data-label") || screen.id || null) : null
    };
  }

  function draw() {
    if (!outline) return;
    if (!enabled || !hovered || !hovered.isConnected) {
      outline.style.display = "none";
      return;
    }
    var rect = hovered.getBoundingClientRect();
    outline.style.cssText = "all:initial!important;position:fixed!important;pointer-events:none!important;box-sizing:border-box!important;z-index:2147483647!important;border:2px solid #2563eb!important;background:rgba(37,99,235,.08)!important;"
      + "left:" + rect.left + "px!important;top:" + rect.top + "px!important;width:" + rect.width + "px!important;height:" + rect.height + "px!important;";
  }

  function setEnabled(value) {
    enabled = value;
    if (enabled && !outline) {
      outline = document.createElement("div");
      outline.setAttribute("data-meowbert-selection-overlay", "");
      outline.setAttribute("aria-hidden", "true");
      document.documentElement.appendChild(outline);
    }
    if (!enabled) hovered = null;
    draw();
  }

  function targetFor(event) {
    var target = event.target;
    if (!target || target.nodeType !== 1) return null;
    return target.closest("svg") || target;
  }

  function intercept(event) {
    if (!enabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "click") {
      hovered = targetFor(event);
      if (hovered) { draw(); post(describe(hovered)); }
    }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== host || !event.data || event.data.source !== SOURCE || event.data.type !== "selection-mode") return;
    setEnabled(event.data.enabled === true);
  });
  window.addEventListener("pointermove", function (event) {
    if (!enabled) return;
    hovered = targetFor(event);
    draw();
  }, true);
  ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu"].forEach(function (type) {
    window.addEventListener(type, intercept, true);
  });
  window.addEventListener("keydown", function (event) {
    if (!enabled) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      setEnabled(false);
      post(null);
    }
  }, true);
  window.addEventListener("scroll", draw, true);
  window.addEventListener("resize", draw);
}

export const CANVAS_SELECTION_RUNTIME_SOURCE = `(${installCanvasSelection.toString()}());`;
