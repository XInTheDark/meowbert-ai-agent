import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MapPosition } from "./conversationMapLayout";

export function useMapViewport(positions: MapPosition[], zoom: number, expand: () => void) {
  const feed = useRef<HTMLDivElement>(null);
  const previous = useRef(positions);
  const pendingReveal = useRef<string | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const measure = () => {
    if (feed.current) setViewport({ top: feed.current.scrollTop, height: feed.current.clientHeight });
  };
  function scrollTo(item: MapPosition) {
    feed.current?.scrollTo({ top: Math.max(0, item.y * zoom - 80), left: Math.max(0, item.x * zoom - 30), behavior: "smooth" });
  }
  useLayoutEffect(() => {
    const element = feed.current;
    const pending = positions.find((item) => item.turn.id === pendingReveal.current);
    if (pending) { pendingReveal.current = null; scrollTo(pending); }
    else if (element && previous.current !== positions) {
      const anchor = previous.current.find((item) => item.y * zoom >= element.scrollTop);
      const next = anchor && positions.find((item) => item.turn.id === anchor.turn.id);
      if (next && anchor) {
        element.scrollTop += (next.y - anchor.y) * zoom;
        element.scrollLeft += (next.x - anchor.x) * zoom;
        measure();
      }
    }
    previous.current = positions;
  }, [positions]);
  useEffect(() => {
    if (!feed.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(feed.current); return () => observer.disconnect();
  }, []);
  function reveal(id: string) {
    const item = positions.find((position) => position.turn.id === id);
    if (item) scrollTo(item);
    else { pendingReveal.current = id; expand(); }
  }
  return { feed, viewport, measure, reveal };
}
