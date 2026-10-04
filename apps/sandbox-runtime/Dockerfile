# syntax=docker/dockerfile:1.7
FROM node:22-trixie-slim
WORKDIR /app
ARG MEOWBERT_BROWSER_USE_ENABLED
ARG MEOWBERT_HTML_CANVAS_ENABLED
ARG MEOWBERT_OFFICE_ENABLED
ARG TARGETARCH
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  curl \
  fuse3 \
  gh \
  git \
  jq \
  latexmk \
  less \
  make \
  g++ \
  nfs-common \
  pkg-config \
  poppler-utils \
  pandoc \
  procps \
  python3 \
  python3-dev \
  python3-numpy \
  python3-pip \
  python3-scipy \
  ripgrep \
  swig \
  texlive-latex-base \
  texlive-latex-recommended \
  texlive-xetex \
  tesseract-ocr \
  tesseract-ocr-eng \
  ghostscript \
  ocrmypdf \
  unzip \
  util-linux \
  wget \
  xfsprogs \
  xz-utils \
  zip \
  libopenblas-dev \
  libzmq3-dev \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libatspi2.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libglib2.0-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libx11-6 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxkbcommon0 \
  libxrandr2 \
  xvfb \
  fonts-noto-color-emoji \
  fonts-unifont \
  libfontconfig1 \
  libfreetype6 \
  xfonts-scalable \
  fonts-liberation \
  fonts-ipafont-gothic \
  fonts-wqy-zenhei \
  fonts-tlwg-loma-otf \
  fonts-freefont-ttf \
  && rm -rf /var/lib/apt/lists/* \
  && (grep -qxF 'user_allow_other' /etc/fuse.conf || echo 'user_allow_other' >> /etc/fuse.conf)
RUN set -eu; \
  case "$TARGETARCH" in \
    amd64) typst_arch=x86_64; typst_sha=a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c ;; \
    arm64) typst_arch=aarch64; typst_sha=5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee ;; \
    *) echo "Unsupported Typst architecture: $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://github.com/typst/typst/releases/download/v0.15.1/typst-${typst_arch}-unknown-linux-musl.tar.xz" -o /tmp/typst.tar.xz; \
  echo "$typst_sha  /tmp/typst.tar.xz" | sha256sum --check -; \
  mkdir /tmp/typst; \
  tar -xJf /tmp/typst.tar.xz -C /tmp/typst --strip-components=1; \
  install -m 755 /tmp/typst/typst /usr/local/bin/typst; \
  mkdir -p /usr/local/share/licenses/typst; \
  install -m 644 /tmp/typst/LICENSE /tmp/typst/NOTICE /usr/local/share/licenses/typst/; \
  typst --version; \
  rm -rf /tmp/typst /tmp/typst.tar.xz
RUN python3 -m pip install --no-cache-dir --break-system-packages --ignore-installed \
  'defusedxml==0.7.1' \
  'fastmcp==3.4.2' \
  'google-api-python-client==2.168.0' \
  'pyhumps==3.8.0' \
  'httplib2==0.22.0' \
  'ipykernel==7.3.0' \
  'jupyter-client==8.10.0' \
  'markitdown[all]' \
  'markdown-it-py==3.0.0' \
  'matplotlib==3.11.1' \
  'numpy<2.5' \
  'opencv-python-headless==5.0.0.93' \
  'Pillow==12.3.0' \
  'pdf2image==1.17.0' \
  'pydantic==2.13.4' \
  'openpyxl==3.1.5' \
  pdfplumber \
  pymupdf \
  pypdf \
  pypdfium2 \
  reportlab \
  python-docx \
  python-pptx \
  yt-dlp
COPY package.json package-lock.json ./
COPY apps/sandbox-runtime/package.json apps/sandbox-runtime/package.json
COPY apps/worker/scripts apps/worker/scripts
RUN MPLCONFIGDIR=/tmp/matplotlib MPLBACKEND=Agg python3 -c 'import cv2, PIL, IPython, ipykernel, jupyter_client, matplotlib, matplotlib.pyplot as plt; fig, ax = plt.subplots(); ax.plot([0, 1], [0, 1]); fig.savefig("/tmp/python-runtime-smoke.png"); plt.close(fig)' \
  && test -s /tmp/python-runtime-smoke.png
RUN --mount=type=bind,source=config,target=/tmp/build-config,readonly \
  MEOWBERT_BROWSER_USE_ENABLED="${MEOWBERT_BROWSER_USE_ENABLED}" \
  MEOWBERT_HTML_CANVAS_ENABLED="${MEOWBERT_HTML_CANVAS_ENABLED}" \
  node apps/worker/scripts/resolve-browser-use-build.mjs && \
  MEOWBERT_OFFICE_ENABLED="${MEOWBERT_OFFICE_ENABLED}" \
  node apps/worker/scripts/resolve-office-build.mjs
RUN if node -e 'const fs = require("node:fs"); const info = JSON.parse(fs.readFileSync("/tmp/office-build.json", "utf-8")); process.exit(info.officeEnabled ? 0 : 1);'; then \
    apt-get update && \
    apt-get install -y --no-install-recommends libreoffice && \
    rm -rf /var/lib/apt/lists/*; \
  else \
    echo "[office-build] skipping LibreOffice install"; \
  fi
RUN python3 -c 'from pdf2image import convert_from_path, pdfinfo_from_path'
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  npm ci --workspace apps/sandbox-runtime --include-workspace-root=false
COPY apps/sandbox-runtime/scripts/persistent_shell/*.py /opt/meowbert/persistent-shell/
RUN PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s /opt/meowbert/persistent-shell -p 'test_*.py'
COPY packages/shared/src/path-containment.mjs packages/shared/src/path-containment.mjs
COPY skills skills
RUN PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app/skills/google-workspace \
  python3 -m unittest discover -s /app/skills/google-workspace/tests -p 'test_*.py'
COPY apps/sandbox-runtime/scripts/verify_typst.py /usr/local/bin/verify-typst
RUN python3 /usr/local/bin/verify-typst /app/skills/typst
RUN if [ -f /app/skills/deep-ai-search/package-lock.json ]; then \
    cd /app/skills/deep-ai-search && npm ci --omit=dev --omit=optional; \
  fi
RUN \
  if node -e 'const fs = require("node:fs"); const info = JSON.parse(fs.readFileSync("/tmp/browser-use-build.json", "utf-8")); process.exit(info.playwrightBrowsersEnabled ? 0 : 1);'; then \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright ./node_modules/.bin/playwright install chromium; \
  else \
    echo "[browser-use-build] skipping Playwright browser install"; \
  fi && \
  mkdir -p /app/build-meta && \
  cp /tmp/browser-use-build.json /app/build-meta/browser-use.json && \
  cp /tmp/office-build.json /app/build-meta/office.json
RUN cat > /app/build-meta/runtime-tools.json <<'EOF'
{
  "shell": ["bash"],
  "languages": {
    "node": ["node", "npm"],
    "python": ["python3", "pip"]
  },
  "cli": [
    "curl",
    "g++",
    "gh",
    "git",
    "jq",
    "latexmk",
    "less",
    "make",
    "pkg-config",
    "pandoc",
    "ocrmypdf",
    "rg",
    "swig",
    "tesseract",
    "typst",
    "unzip",
    "wget",
    "zip"
  ],
  "filesystem": ["fuse3", "nfs-common", "util-linux", "xfsprogs"],
  "python_packages": [
    "defusedxml==0.7.1",
    "fastmcp==3.4.2",
    "google-api-python-client==2.168.0",
    "pyhumps==3.8.0",
    "httplib2==0.22.0",
    "ipykernel==7.3.0",
    "jupyter-client==8.10.0",
    "markitdown[all]",
    "markdown-it-py==3.0.0",
    "matplotlib==3.11.1",
    "numpy<2.5",
    "opencv-python-headless==5.0.0.93",
    "Pillow==12.3.0",
    "pdf2image==1.17.0",
    "openpyxl==3.1.5",
    "pdfplumber",
    "pymupdf",
    "pypdf",
    "pypdfium2",
    "pydantic==2.13.4",
    "python-docx",
    "python-pptx",
    "reportlab",
    "scipy",
    "yt-dlp"
  ],
  "node_packages": [
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@modelcontextprotocol/sdk",
    "@mozilla/readability",
    "@playwright/mcp",
    "ai",
    "docx",
    "docxtemplater",
    "jsdom",
    "lru-cache",
    "p-limit",
    "pdf-lib",
    "pdfjs-dist",
    "pizzip",
    "playwright",
    "pptxgenjs",
    "turndown",
    "zod"
  ],
  "optional_bundles": {
    "chromium": "See /app/build-meta/browser-use.json",
    "libreoffice": "See /app/build-meta/office.json"
  }
}
EOF
RUN cat > /app/build-meta/runtime-tools.md <<'EOF'
# Runtime Tools

Installed tools and libraries are summarized here for quick shell planning. Use `runtime-tools.json` in the same directory when structured data is easier.

## Languages

- Node.js with npm
- Python 3.13 with pip

## CLI Tools

- bash
- curl, wget
- git, gh
- jq, less, rg
- pandoc, latexmk, pdflatex, xelatex
- typst 0.15.1 (embedded fonts; `/app/skills/typst` authoring guide and starter)
- ocrmypdf, tesseract
- make, g++, pkg-config, swig
- unzip, zip

## Filesystem Support

- fuse3
- nfs-common
- util-linux
- xfsprogs

## Python Packages

- defusedxml 0.7.1
- fastmcp 3.4.2
- google-api-python-client 2.168.0, httplib2 0.22.0
- IPython with ipykernel 7.3.0 and jupyter-client 8.10.0 for persistent Python execution
- markdown-it-py 3.0.0
- markitdown[all]
- matplotlib 3.11.1 for plotting (use the Agg backend without a display)
- numpy<2.5, scipy
- Pillow 12.3.0 for image crop/rotate/resize/enhance, pdf2image 1.17.0
- opencv-python-headless 5.0.0.93 (`cv2`) for deskew, perspective correction, and contour/edge detection
- pydantic 2.13.4, pyhumps 3.8.0
- openpyxl 3.1.5
- pdfplumber, pymupdf, pypdf, pypdfium2, reportlab
- python-docx, python-pptx
- yt-dlp

## Node Packages

- @ai-sdk/anthropic, @ai-sdk/openai, ai
- @modelcontextprotocol/sdk
- @mozilla/readability, jsdom, turndown
- lru-cache, p-limit
- @playwright/mcp, playwright
- docx, docxtemplater, pizzip, pptxgenjs
- pdf-lib, pdfjs-dist
- zod

## Optional Build-Time Bundles

- Chromium: see `/app/build-meta/browser-use.json`
- LibreOffice: see `/app/build-meta/office.json`
EOF
RUN rm -rf /app/apps /app/package.json /app/package-lock.json /app/node_modules/@meowbert/sandbox-runtime
CMD ["/bin/bash"]
