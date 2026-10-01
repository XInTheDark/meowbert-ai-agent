# Meowbert website

The public landing page for Meowbert. It is a plain static site with no build step, no JavaScript, and no external requests (fonts are bundled). It is **not** part of a self-hosted Meowbert install, and nothing else in this repository depends on it.

## Preview

```bash
python3 -m http.server 8080 --directory promo-website
```

Then open `http://localhost:8080`.

## Deploy

Upload the contents of this folder to any static host (GitHub Pages, Cloudflare Pages, Netlify, an S3 bucket, nginx). There is nothing to build.

For Cloudflare Workers, `wrangler.jsonc` serves this folder as static assets. Set the Workers Builds root directory to `promo-website` with no build command, so the build doesn't install the whole monorepo. To deploy by hand, run `npx wrangler deploy` from this folder.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | The whole page |
| `assets/site.css` | Styles (dark theme, close to the app's palette) |
| `assets/fonts/` | Google Sans and Google Sans Code, Latin subsets, SIL OFL 1.1 |
| `assets/img/logo.svg` | Brand mark |
| `assets/media/` | Screenshots and example outputs (WebP), plus `social-card.png` |

## Media

Screenshots were taken from a fresh Docker Compose install with a demo account, at 1440×900 and 2× scale. The files in the Examples section are real task outputs from that install, with the deck and document rendered to images using LibreOffice. When the UI changes noticeably, retake them the same way rather than editing images by hand.

## Links

Docs links point to `https://docs.meowbert.com`. The documentation site itself lives in `apps/docs`.

Social crawlers usually want an absolute `og:image` URL. Once the site's domain is settled, change `assets/media/social-card.png` in `index.html` to the full URL.
