import { useId } from "react";

export interface BrandPalette {
  stemStart: string;
  stemEnd: string;
  loopStart: string;
  loopEnd: string;
  sparkStart: string;
  sparkEnd: string;
  shadowColor: string;
}

export const STATIC_BRAND_PALETTE: BrandPalette = {
  stemStart: "#6366F1",
  stemEnd: "#A855F7",
  loopStart: "#3B82F6",
  loopEnd: "#2DD4BF",
  sparkStart: "#F472B6",
  sparkEnd: "#FBBF24",
  shadowColor: "rgba(0, 0, 0, 0.15)"
};

export const THEME_BRAND_PALETTE: BrandPalette = {
  stemStart: "var(--brand-strong)",
  stemEnd: "var(--brand)",
  loopStart: "var(--brand)",
  loopEnd: "var(--success)",
  sparkStart: "var(--danger)",
  sparkEnd: "var(--warning)",
  shadowColor: "rgba(0, 0, 0, 0.18)"
};

function brandSvgMarkup(palette: BrandPalette, prefix: string, title?: string): string {
  const titleMarkup = title ? `<title>${title}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none" aria-hidden="${title ? "false" : "true"}" role="${title ? "img" : "presentation"}">${titleMarkup}<defs><linearGradient id="${prefix}-stemGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="${palette.stemStart}" /><stop offset="100%" stop-color="${palette.stemEnd}" /></linearGradient><linearGradient id="${prefix}-loopGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${palette.loopStart}" /><stop offset="100%" stop-color="${palette.loopEnd}" /></linearGradient><linearGradient id="${prefix}-sparkGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${palette.sparkStart}" /><stop offset="100%" stop-color="${palette.sparkEnd}" /></linearGradient><filter id="${prefix}-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="4" dy="8" stdDeviation="8" flood-color="${palette.shadowColor}" flood-opacity="1" /></filter></defs><circle cx="256" cy="300" r="104" stroke="url(#${prefix}-loopGrad)" stroke-width="64" /><rect x="120" y="76" width="64" height="360" rx="32" fill="url(#${prefix}-stemGrad)" filter="url(#${prefix}-shadow)" /><path d="M 256 236 Q 256 300 320 300 Q 256 300 256 364 Q 256 300 192 300 Q 256 300 256 236 Z" fill="url(#${prefix}-sparkGrad)" /></svg>`;
}

export function buildBrandSvgMarkup(palette: BrandPalette, title?: string): string {
  return brandSvgMarkup(palette, "brand", title);
}

function readThemeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export function resolveThemeBrandPalette(): BrandPalette {
  return {
    stemStart: readThemeColor("--brand-strong", STATIC_BRAND_PALETTE.stemStart),
    stemEnd: readThemeColor("--brand", STATIC_BRAND_PALETTE.stemEnd),
    loopStart: readThemeColor("--brand", STATIC_BRAND_PALETTE.loopStart),
    loopEnd: readThemeColor("--success", STATIC_BRAND_PALETTE.loopEnd),
    sparkStart: readThemeColor("--danger", STATIC_BRAND_PALETTE.sparkStart),
    sparkEnd: readThemeColor("--warning", STATIC_BRAND_PALETTE.sparkEnd),
    shadowColor: STATIC_BRAND_PALETTE.shadowColor
  };
}

export function syncThemeBranding(): void {
  if (typeof document === "undefined") {
    return;
  }

  const palette = resolveThemeBrandPalette();
  const svgFavicon = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
  if (svgFavicon) {
    svgFavicon.href = `data:image/svg+xml,${encodeURIComponent(buildBrandSvgMarkup(palette, "Meowbert"))}`;
  }

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.content = readThemeColor("--bg", "#060912");
  }
}

export function BrandMark(props: { className?: string; title?: string; themeAware?: boolean }) {
  const iconId = useId().replace(/:/g, "");
  const palette = props.themeAware ? THEME_BRAND_PALETTE : STATIC_BRAND_PALETTE;

  return (
    <span className={props.className} aria-hidden={props.title ? undefined : true}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        role={props.title ? "img" : "presentation"}
        aria-label={props.title}
      >
        <defs>
          <linearGradient id={`${iconId}-stemGrad`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={palette.stemStart} />
            <stop offset="100%" stopColor={palette.stemEnd} />
          </linearGradient>
          <linearGradient id={`${iconId}-loopGrad`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={palette.loopStart} />
            <stop offset="100%" stopColor={palette.loopEnd} />
          </linearGradient>
          <linearGradient id={`${iconId}-sparkGrad`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={palette.sparkStart} />
            <stop offset="100%" stopColor={palette.sparkEnd} />
          </linearGradient>
          <filter id={`${iconId}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="4" dy="8" stdDeviation="8" floodColor={palette.shadowColor} floodOpacity="1" />
          </filter>
        </defs>
        <circle cx="256" cy="300" r="104" fill="none" stroke={`url(#${iconId}-loopGrad)`} strokeWidth="64" />
        <rect x="120" y="76" width="64" height="360" rx="32" fill={`url(#${iconId}-stemGrad)`} filter={`url(#${iconId}-shadow)`} />
        <path d="M 256 236 Q 256 300 320 300 Q 256 300 256 364 Q 256 300 192 300 Q 256 300 256 236 Z" fill={`url(#${iconId}-sparkGrad)`} />
      </svg>
    </span>
  );
}
