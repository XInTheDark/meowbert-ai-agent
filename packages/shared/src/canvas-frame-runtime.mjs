// The script every canvas page runs before its own code. Canvas pages are served into sandboxed
// iframes with an opaque origin, where storage and cookies throw; the runtime stands in for them,
// reports load state, errors and height to the parent app, applies the app theme as CSS variables
// and exposes `window.meowbert.run`. The API injects it into served HTML, and the sandbox check
// injects the same script, so the agent verifies a page under the conditions the user sees.
// Plain JavaScript so the sandbox image can load it without the compiled shared package.

import { CANVAS_SELECTION_RUNTIME_SOURCE } from "./canvas-selection-runtime.mjs";

export const CANVAS_FRAME_MESSAGE_SOURCE = "meowbert-canvas";
export const CANVAS_FRAME_NAME_PREFIX = "meowbert-canvas:";
export const CANVAS_FRAME_SANDBOX = "allow-scripts allow-forms allow-modals allow-downloads allow-popups allow-popups-to-escape-sandbox";

const FRAME_RUNTIME_SOURCE = String.raw`(function () {
  "use strict";
  if (window.__meowbertCanvasRuntime) return;
  window.__meowbertCanvasRuntime = { version: 1 };
  var SOURCE = "meowbert-canvas";
  var PREFIX = "meowbert-canvas:";
  var host = window.parent !== window ? window.parent : null;
  var init = readInit();

  function readInit() {
    try {
      var name = String(window.name || "");
      if (name.indexOf(PREFIX) === 0) {
        var parsed = JSON.parse(name.slice(PREFIX.length));
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch (error) {}
    return {};
  }

  function writeInit() {
    try { window.name = PREFIX + JSON.stringify(init); } catch (error) {}
  }

  function post(type, payload) {
    if (!host) return;
    var message = { source: SOURCE, type: type };
    if (payload) for (var key in payload) message[key] = payload[key];
    try { host.postMessage(message, "*"); } catch (error) {}
  }

  function createStorage(area) {
    var data = {};
    var initial = init.storage && init.storage[area];
    if (initial && typeof initial === "object") {
      for (var initialKey in initial) if (typeof initial[initialKey] === "string") data[initialKey] = initial[initialKey];
    }
    var timer = null;
    function changed() {
      init.storage = init.storage || {};
      init.storage[area] = data;
      writeInit();
      if (area !== "local" || timer) return;
      timer = setTimeout(function () {
        timer = null;
        post("storage", { area: area, items: data });
      }, 150);
    }
    var api = {
      getItem: function (key) {
        key = String(key);
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem: function (key, value) { data[String(key)] = String(value); changed(); },
      removeItem: function (key) { delete data[String(key)]; changed(); },
      clear: function () { data = {}; changed(); },
      key: function (index) {
        var keys = Object.keys(data);
        return index >= 0 && index < keys.length ? keys[index] : null;
      }
    };
    Object.defineProperty(api, "length", { configurable: true, get: function () { return Object.keys(data).length; } });
    if (typeof Proxy !== "function") return api;
    return new Proxy(api, {
      get: function (target, property) {
        if (property in target) return target[property];
        return typeof property === "string" ? target.getItem(property) : undefined;
      },
      set: function (target, property, value) {
        if (typeof property === "string" && !(property in target)) target.setItem(property, value);
        return true;
      },
      deleteProperty: function (target, property) {
        if (typeof property === "string") target.removeItem(property);
        return true;
      },
      has: function (target, property) {
        return property in target || (typeof property === "string" && Object.prototype.hasOwnProperty.call(data, property));
      },
      ownKeys: function () { return Object.keys(data); },
      getOwnPropertyDescriptor: function (target, property) {
        if (typeof property === "string" && Object.prototype.hasOwnProperty.call(data, property)) {
          return { value: data[property], writable: true, enumerable: true, configurable: true };
        }
        return undefined;
      }
    });
  }

  function storageWorks(name) {
    try {
      var storage = window[name];
      storage.setItem("__meowbert_probe__", "1");
      storage.removeItem("__meowbert_probe__");
      return true;
    } catch (error) {
      return false;
    }
  }

  [["localStorage", "local"], ["sessionStorage", "session"]].forEach(function (entry) {
    if (storageWorks(entry[0])) return;
    try { Object.defineProperty(window, entry[0], { value: createStorage(entry[1]), configurable: true }); } catch (error) {}
  });

  try {
    void document.cookie;
  } catch (cookieError) {
    var jar = {};
    try {
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get: function () {
          return Object.keys(jar).map(function (key) { return key + "=" + jar[key]; }).join("; ");
        },
        set: function (value) {
          var text = String(value);
          var pair = text.split(";")[0];
          var index = pair.indexOf("=");
          if (index <= 0) return;
          var key = pair.slice(0, index).trim();
          if (/max-age=0|expires=thu, 01 jan 1970/i.test(text)) delete jar[key];
          else jar[key] = pair.slice(index + 1).trim();
        }
      });
    } catch (error) {}
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    if (!root || !theme || typeof theme !== "object") return;
    root.setAttribute("data-meowbert-theme", theme.mode === "dark" ? "dark" : "light");
    var tokens = theme.tokens && typeof theme.tokens === "object" ? theme.tokens : {};
    for (var key in tokens) {
      if (/^[a-z0-9-]+$/.test(key) && typeof tokens[key] === "string") root.style.setProperty("--mb-" + key, tokens[key]);
    }
  }
  applyTheme(init.theme);

  var errorCount = 0;
  function reportError(error) {
    if (errorCount >= 30) return;
    errorCount += 1;
    post("error", { error: error });
  }
  function describe(value) {
    if (value instanceof Error) return value.message;
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch (error) { return String(value); }
  }

  window.addEventListener("error", function (event) {
    var target = event.target;
    if (target && target !== window && target.tagName) {
      reportError({
        kind: "resource",
        message: "Failed to load <" + target.tagName.toLowerCase() + ">",
        source: target.currentSrc || target.src || target.href || null,
        line: null
      });
      return;
    }
    reportError({
      kind: "script",
      message: event.message || "Script error",
      source: event.filename || null,
      line: typeof event.lineno === "number" ? event.lineno : null
    });
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    reportError({ kind: "promise", message: describe(event.reason), source: null, line: null });
  });
  document.addEventListener("securitypolicyviolation", function (event) {
    reportError({
      kind: "security",
      message: "Blocked by security policy: " + event.violatedDirective,
      source: event.blockedURI || null,
      line: null
    });
  });
  var originalConsoleError = console.error;
  console.error = function () {
    try {
      reportError({ kind: "console", message: Array.prototype.map.call(arguments, describe).join(" ").slice(0, 600), source: null, line: null });
    } catch (error) {}
    return originalConsoleError.apply(console, arguments);
  };
  if (typeof window.fetch === "function") {
    var originalFetch = window.fetch;
    window.fetch = function (input) {
      var url = input && typeof input === "object" && "url" in input ? input.url : String(input);
      return originalFetch.apply(this, arguments).catch(function (error) {
        reportError({ kind: "network", message: describe(error) || "Network request failed", source: url, line: null });
        throw error;
      });
    };
  }

  function hasVisibleContent(body) {
    if ((body.innerText || "").trim().length > 0) return true;
    var media = body.querySelectorAll("img,svg,canvas,video,iframe,input,button,select,textarea,object,embed,picture");
    for (var index = 0; index < media.length; index += 1) {
      var rect = media[index].getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) return true;
    }
    var elements = body.querySelectorAll("*");
    for (var elementIndex = 0; elementIndex < elements.length && elementIndex < 400; elementIndex += 1) {
      var style = getComputedStyle(elements[elementIndex]);
      var painted = (style.backgroundImage && style.backgroundImage !== "none")
        || (style.backgroundColor && style.backgroundColor !== "transparent" && style.backgroundColor !== "rgba(0, 0, 0, 0)");
      if (!painted) continue;
      var box = elements[elementIndex].getBoundingClientRect();
      if (box.width > 4 && box.height > 4) return true;
    }
    return false;
  }

  function measureHeight() {
    var root = document.documentElement;
    var height = root.getBoundingClientRect().height;
    if (root.scrollHeight > window.innerHeight + 1) height = Math.max(height, root.scrollHeight);
    return Math.ceil(height);
  }

  var lastBlank = null;
  var lastHeight = -1;
  function reportContent(type) {
    var blank = !document.body || !hasVisibleContent(document.body);
    if (type === "ready" || blank !== lastBlank) post(type, { blank: blank, title: document.title || null });
    lastBlank = blank;
  }
  function reportSize() {
    var height = measureHeight();
    if (Math.abs(height - lastHeight) < 1) return;
    lastHeight = height;
    post("resize", { height: height });
  }

  var loaded = false;
  function onLoaded() {
    if (loaded) return;
    loaded = true;
    reportContent("ready");
    reportSize();
    [600, 2000, 5000].forEach(function (delay) {
      setTimeout(function () { reportContent("content"); reportSize(); }, delay);
    });
    if (typeof ResizeObserver === "function") {
      var observer = new ResizeObserver(reportSize);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    }
  }
  if (document.readyState === "complete") setTimeout(onLoaded, 0);
  else window.addEventListener("load", onLoaded);
  /* A slow image or font can hold back the load event; report what is there by then. */
  setTimeout(onLoaded, 10000);

  window.addEventListener("message", function (event) {
    if (event.source !== host) return;
    var data = event.data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === "theme") {
      init.theme = data.theme;
      writeInit();
      applyTheme(data.theme);
    }
  });

  var meowbert = {
    run: function (input) {
      var payload = input && typeof input === "object" ? input : { prompt: input };
      var prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      if (!prompt) return false;
      post("run", {
        prompt: prompt.slice(0, 8000),
        title: typeof payload.title === "string" ? payload.title.slice(0, 200) : null
      });
      return true;
    },
    theme: function () {
      return init.theme && init.theme.mode === "dark" ? "dark" : "light";
    }
  };
  try { Object.defineProperty(window, "meowbert", { value: Object.freeze(meowbert) }); } catch (error) {}

  post("hello", {});
}());`;

export const CANVAS_FRAME_RUNTIME_SOURCE = `${FRAME_RUNTIME_SOURCE}\n${CANVAS_SELECTION_RUNTIME_SOURCE}`;

// Kept on one line so the page's own script errors report the line numbers of its source file.
const RUNTIME_TAG = `<script data-meowbert-canvas-runtime>${CANVAS_FRAME_RUNTIME_SOURCE.replace(/\n\s*/g, " ")}</script>`;

/**
 * Inserts the canvas runtime as the first script of an HTML document.
 * @param {string} html
 * @returns {string}
 */
export function injectCanvasFrameRuntime(html) {
  for (const pattern of [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /^\s*<!doctype[^>]*>/i]) {
    const match = pattern.exec(html);
    if (match) {
      const end = match.index + match[0].length;
      return `${html.slice(0, end)}${RUNTIME_TAG}${html.slice(end)}`;
    }
  }
  return `${RUNTIME_TAG}${html}`;
}
