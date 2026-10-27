// Light DOM keeps document content selectable, searchable, and printable.
const PAPER_SIZES = { a4: [210, 297], letter: [215.9, 279.4], legal: [215.9, 355.6] };

class MeowbertDocument extends HTMLElement {
  connectedCallback() {
    if (this.dataset.initialized) return;
    this.dataset.initialized = "true";
    const paper = PAPER_SIZES[this.getAttribute("paper")] || PAPER_SIZES.a4;
    this.style.setProperty("--paper-width", `${paper[0]}mm`);
    this.style.setProperty("--paper-height", `${paper[1]}mm`);
    document.documentElement.dataset.meowbertKind = "document";
    const style = document.createElement("style");
    style.textContent = this.styles(paper);
    this.prepend(style);
    this.fit = document.documentElement.dataset.meowbertDocumentFit !== "false";
    this.resize = () => this.updateScale();
    this.view = (event) => {
      if (event.source !== window.parent || event.data?.source !== "meowbert-canvas" || event.data.type !== "document-view") return;
      this.fit = event.data.fit !== false;
      this.updateScale();
    };
    window.addEventListener("resize", this.resize);
    window.addEventListener("message", this.view);
    this.updateScale();
  }

  disconnectedCallback() {
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("message", this.view);
    delete this.dataset.initialized;
    this.querySelector("style")?.remove();
  }

  updateScale() {
    this.style.zoom = this.fit ? String(Math.min(1, Math.max(0.1, (window.innerWidth - 32) / (this.offsetWidth || 794)))) : "1";
  }

  styles(paper) {
    return `
      meowbert-document { display:block; width:var(--paper-width); margin:24px auto; color:#222; background:white; --document-margin:20mm; }
      meowbert-document[mode=flow] { box-sizing:border-box; padding:var(--document-margin); min-height:var(--paper-height); }
      meowbert-document[mode=pages] { background:transparent; }
      meowbert-document > [data-meowbert-page] { box-sizing:border-box; width:var(--paper-width); height:var(--paper-height); padding:var(--document-margin); margin-bottom:24px; background:white; position:relative; }
      meowbert-document h1, meowbert-document h2, meowbert-document h3 { break-after:avoid; }
      meowbert-document figure, meowbert-document tr, meowbert-document .keep-together { break-inside:avoid; }
      meowbert-document p { orphans:3; widows:3; }
      meowbert-document img { max-width:100%; }
      @page { size:${paper[0]}mm ${paper[1]}mm; margin:20mm; @bottom-center { content:counter(page); font-size:9pt; color:#666; } }
      @media print {
        html, body { margin:0 !important; background:white !important; }
        meowbert-document { zoom:1 !important; width:auto; margin:0; }
        meowbert-document[mode=flow] { padding:0; min-height:0; }
        meowbert-document > [data-meowbert-page] { width:auto; min-height:0; height:${paper[1] - 40}mm; padding:0; margin:0; break-after:page; overflow:visible; }
        meowbert-document > [data-meowbert-page]:last-child { break-after:auto; }
        [data-meowbert-screen-only] { display:none !important; }
      }`;
  }
}

customElements.define("meowbert-document", MeowbertDocument);
