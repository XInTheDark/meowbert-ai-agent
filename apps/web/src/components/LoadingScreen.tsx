import { BrandMark } from "../lib/brand";
import { InlineProgressBar } from "./InlineProgressBar";

export function LoadingScreen(props: { label: string }) {
  return (
    <main className="loading-screen" aria-busy="true" aria-live="polite">
      <div className="loading-mark-wrap">
        <span className="loading-mark-sheen" aria-hidden="true" />
        <BrandMark className="loading-mark" title="Meowbert" themeAware />
      </div>
      <p>{props.label}</p>
      <div style={{ width: "8rem" }}>
        <InlineProgressBar />
      </div>
    </main>
  );
}
