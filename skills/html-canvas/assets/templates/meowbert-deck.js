// <meowbert-deck>: presents a single-file slide deck.
//
//   <meowbert-deck width="1920" height="1080">
//     <section data-meowbert-page data-label="Title" data-notes="Speaker notes">…</section>
//   </meowbert-deck>
//
// On screen it shows one slide scaled to the viewport, with keyboard navigation,
// an overview grid (G), speaker notes (N), and the slide number kept in the URL hash.
// When printed, or rendered by html_canvas_render, every slide is laid out at native
// size, one per page, so previews and PDF export need no extra markup.
(function () {
  if (customElements.get("meowbert-deck")) {
    return;
  }

  const DOCUMENT_STYLE_ID = "meowbert-deck-document-style";
  const THUMBNAIL_WIDTH = 320;

  function readSize(element, name, fallback) {
    const value = Number.parseFloat(element.getAttribute(name) ?? "");
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function installDocumentStyle(width, height) {
    let style = document.getElementById(DOCUMENT_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = DOCUMENT_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = `
      @page { size: ${width}px ${height}px; margin: 0; }
      meowbert-deck { display: block; }
      meowbert-deck > [data-meowbert-page] {
        position: relative;
        box-sizing: border-box;
        width: var(--meowbert-deck-width);
        height: var(--meowbert-deck-height);
        overflow: hidden;
        flex: none;
      }
      @media screen {
        meowbert-deck[data-mode="stage"] > [data-meowbert-page]:not([data-meowbert-active]) { display: none !important; }
        meowbert-deck[data-mode="overview"] > [data-meowbert-page] {
          zoom: var(--meowbert-deck-thumbnail-zoom);
          cursor: pointer;
          outline: calc(1px / var(--meowbert-deck-thumbnail-zoom)) solid rgb(255 255 255 / 0.14);
        }
        meowbert-deck[data-mode="overview"] > [data-meowbert-active] {
          outline: calc(3px / var(--meowbert-deck-thumbnail-zoom)) solid #f5f5f4;
        }
      }
      @media print {
        html, body { margin: 0 !important; padding: 0 !important; }
        meowbert-deck > [data-meowbert-page] { break-after: page; }
      }
    `;
  }

  const SHADOW_TEMPLATE = `
    <style>
      :host {
        position: fixed;
        inset: 0;
        overflow: hidden;
        background: var(--meowbert-deck-backdrop, #0c0c0d);
        font: 13px/1.3 system-ui, sans-serif;
      }
      .stage {
        position: absolute;
        left: 50%;
        top: 50%;
        width: var(--meowbert-deck-width);
        height: var(--meowbert-deck-height);
        transform: translate(-50%, -50%) scale(var(--meowbert-deck-scale, 1));
      }
      :host([data-mode="overview"]) { overflow: auto; }
      :host([data-mode="overview"]) .stage {
        position: static;
        width: auto;
        height: auto;
        transform: none;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(${THUMBNAIL_WIDTH}px, 1fr));
        justify-items: center;
        gap: 28px;
        padding: 32px;
      }
      :host([data-mode="all"]) { position: static; overflow: visible; background: none; }
      :host([data-mode="all"]) .stage {
        position: static;
        width: auto;
        height: auto;
        transform: none;
        display: flex;
        flex-direction: column;
      }
      .controls {
        position: fixed;
        right: 16px;
        bottom: 16px;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px;
        border-radius: 8px;
        background: rgb(20 20 22 / 0.82);
        color: #f5f5f4;
        opacity: 0;
        transition: opacity 160ms ease;
      }
      :host(:hover) .controls, .controls:focus-within { opacity: 1; }
      :host([data-mode="all"]) .controls, :host([data-mode="all"]) .notes { display: none; }
      button {
        display: grid;
        place-items: center;
        min-width: 32px;
        height: 32px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      button:hover, button:focus-visible { background: rgb(255 255 255 / 0.12); outline: none; }
      .counter { min-width: 56px; text-align: center; font-variant-numeric: tabular-nums; }
      .notes {
        position: fixed;
        left: 16px;
        right: 16px;
        bottom: 64px;
        max-height: 30vh;
        overflow: auto;
        padding: 14px 16px;
        border-radius: 8px;
        background: rgb(20 20 22 / 0.9);
        color: #f5f5f4;
        font-size: 15px;
        line-height: 1.5;
        white-space: pre-wrap;
      }
      .notes[hidden] { display: none; }
      @media print {
        :host { position: static !important; overflow: visible !important; background: none !important; }
        .stage {
          position: static !important;
          width: auto !important;
          height: auto !important;
          transform: none !important;
          display: block !important;
          padding: 0 !important;
        }
        .controls, .notes { display: none !important; }
      }
    </style>
    <div class="stage" part="stage"><slot></slot></div>
    <div class="notes" part="notes" hidden></div>
    <div class="controls" part="controls">
      <button type="button" data-action="prev" aria-label="Previous slide">&#8592;</button>
      <span class="counter" aria-live="polite"></span>
      <button type="button" data-action="next" aria-label="Next slide">&#8594;</button>
      <button type="button" data-action="overview" aria-label="Show all slides (G)">&#9638;</button>
      <button type="button" data-action="notes" aria-label="Speaker notes (N)">&#8801;</button>
    </div>
  `;

  class MeowbertDeck extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = SHADOW_TEMPLATE;
      this.currentIndex = 0;
      this.handleKeydown = this.handleKeydown.bind(this);
      this.handleHashChange = this.handleHashChange.bind(this);
      this.updateScale = this.updateScale.bind(this);
      this.slideObserver = new MutationObserver(() => this.refresh());
      this.shadowRoot.addEventListener("click", (event) => this.handleControlClick(event));
      this.addEventListener("click", (event) => this.handleOverviewClick(event));
    }

    static get observedAttributes() {
      return ["width", "height", "mode"];
    }

    get slides() {
      return Array.from(this.children).filter((child) => child.hasAttribute("data-meowbert-page"));
    }

    get index() {
      return this.currentIndex;
    }

    connectedCallback() {
      this.applySize();
      this.dataset.mode = this.resolveInitialMode();
      this.currentIndex = this.readHashIndex() ?? 0;
      this.slideObserver.observe(this, { childList: true });
      window.addEventListener("keydown", this.handleKeydown);
      window.addEventListener("hashchange", this.handleHashChange);
      window.addEventListener("resize", this.updateScale);
      this.refresh();
    }

    disconnectedCallback() {
      this.slideObserver.disconnect();
      window.removeEventListener("keydown", this.handleKeydown);
      window.removeEventListener("hashchange", this.handleHashChange);
      window.removeEventListener("resize", this.updateScale);
    }

    attributeChangedCallback(name) {
      if (!this.isConnected) {
        return;
      }
      if (name === "mode") {
        this.dataset.mode = this.resolveInitialMode();
      } else {
        this.applySize();
      }
      this.refresh();
    }

    resolveInitialMode() {
      if (window.__MEOWBERT_RENDER__ === true || this.getAttribute("mode") === "all") {
        return "all";
      }
      return "stage";
    }

    applySize() {
      this.slideWidth = readSize(this, "width", 1920);
      this.slideHeight = readSize(this, "height", 1080);
      this.style.setProperty("--meowbert-deck-width", `${this.slideWidth}px`);
      this.style.setProperty("--meowbert-deck-height", `${this.slideHeight}px`);
      this.style.setProperty("--meowbert-deck-thumbnail-zoom", String(THUMBNAIL_WIDTH / this.slideWidth));
      installDocumentStyle(this.slideWidth, this.slideHeight);
    }

    updateScale() {
      const scale = Math.min(window.innerWidth / this.slideWidth, window.innerHeight / this.slideHeight);
      this.style.setProperty("--meowbert-deck-scale", String(scale));
    }

    readHashIndex() {
      const match = /^#(?:slide-)?(\d+)$/.exec(window.location.hash);
      return match ? Number(match[1]) - 1 : null;
    }

    refresh() {
      const slides = this.slides;
      this.currentIndex = Math.max(0, Math.min(this.currentIndex, slides.length - 1));
      slides.forEach((slide, index) => {
        slide.toggleAttribute("data-meowbert-active", index === this.currentIndex);
      });
      this.shadowRoot.querySelector(".counter").textContent = slides.length > 0
        ? `${this.currentIndex + 1} / ${slides.length}`
        : "0 / 0";
      const notes = this.shadowRoot.querySelector(".notes");
      notes.textContent = slides[this.currentIndex]?.getAttribute("data-notes") ?? "";
      this.updateScale();
    }

    goTo(index) {
      const slides = this.slides;
      if (slides.length === 0) {
        return;
      }
      this.currentIndex = Math.max(0, Math.min(index, slides.length - 1));
      const hash = `#${this.currentIndex + 1}`;
      if (window.location.hash !== hash) {
        history.replaceState(null, "", hash);
      }
      this.refresh();
      this.dispatchEvent(new CustomEvent("meowbert-deck:change", {
        bubbles: true,
        detail: {
          index: this.currentIndex,
          label: slides[this.currentIndex].getAttribute("data-label")
        }
      }));
    }

    next() {
      this.goTo(this.currentIndex + 1);
    }

    prev() {
      this.goTo(this.currentIndex - 1);
    }

    setMode(mode) {
      this.dataset.mode = mode;
      this.refresh();
    }

    toggleNotes() {
      const notes = this.shadowRoot.querySelector(".notes");
      notes.hidden = !notes.hidden;
    }

    handleHashChange() {
      const index = this.readHashIndex();
      if (index !== null && index !== this.currentIndex) {
        this.goTo(index);
      }
    }

    handleControlClick(event) {
      const action = event.target.closest?.("button")?.dataset.action;
      if (action === "prev") this.prev();
      if (action === "next") this.next();
      if (action === "notes") this.toggleNotes();
      if (action === "overview") this.setMode(this.dataset.mode === "overview" ? "stage" : "overview");
    }

    handleOverviewClick(event) {
      if (this.dataset.mode !== "overview") {
        return;
      }
      const slide = this.slides.find((candidate) => candidate.contains(event.target));
      if (slide) {
        event.preventDefault();
        this.setMode("stage");
        this.goTo(this.slides.indexOf(slide));
      }
    }

    handleKeydown(event) {
      if (this.dataset.mode === "all" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      const key = event.key;
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(key)) this.next();
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(key)) this.prev();
      else if (key === "Home") this.goTo(0);
      else if (key === "End") this.goTo(this.slides.length - 1);
      else if (key === "g" || key === "G") this.setMode(this.dataset.mode === "overview" ? "stage" : "overview");
      else if (key === "Escape" && this.dataset.mode === "overview") this.setMode("stage");
      else if (key === "n" || key === "N") this.toggleNotes();
      else return;
      event.preventDefault();
    }
  }

  customElements.define("meowbert-deck", MeowbertDeck);
}());
