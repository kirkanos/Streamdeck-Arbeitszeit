import { formatDuration, type Worktime } from "../worktime/model";
import { progressBar } from "./bar";
import { caption } from "./keys";
import { background, mix, svg, text, toDataUrl } from "./svg";
import { phaseColor, THEME } from "./theme";

/** Touch strip segment of one dial (Stream Deck + / + XL). */
const W = 200;
const H = 100;

export type DialCanvas = {
  worktime: Worktime;
  targetMin: number;
  maxMin: number;
};

export function dialCanvas(d: DialCanvas): string {
  const w = d.worktime;
  const color = phaseColor(w.phase, w.overMin > 0, w.reachedMax);
  const active = w.phase === "running" || w.phase === "paused";
  const dim = w.phase === "idle";

  const bg =
    w.phase === "running"
      ? background("bg", mix(color, THEME.base, 0.8), THEME.base, W, H)
      : background("bg", dim ? THEME.empty : THEME.surface, THEME.base, W, H);

  const dot = `<circle cx="16" cy="19" r="5" fill="${active ? color : THEME.idle}"/>`;
  const title = text("Worktime", { x: 28, y: 25, size: 17, anchor: "start", opacity: dim ? 0.6 : 1 });
  const time = text(formatDuration(w.netMin), {
    x: 12,
    y: 68,
    size: 34,
    weight: 800,
    anchor: "start",
    fill: dim ? THEME.subtle : "#FFFFFF",
  });
  const label = text(caption(w), { x: W - 12, y: 66, size: 13, weight: 600, opacity: 0.75, anchor: "end" });

  const pause =
    w.phase === "paused"
      ? `<rect x="${W - 34}" y="12" width="6" height="16" rx="2" fill="${color}"/><rect x="${W - 22}" y="12" width="6" height="16" rx="2" fill="${color}"/>`
      : "";

  const bar = dim ? "" : progressBar({ netMin: w.netMin, targetMin: d.targetMin, maxMin: d.maxMin }, 12, 82, W - 24, 8, THEME.ok, THEME.warn);

  return toDataUrl(svg(W, H, bg + dot + title + time + label + pause + bar));
}

export function dialMessage(title: string, subtitle: string): string {
  return toDataUrl(
    svg(
      W,
      H,
      background("bg", THEME.surface, THEME.base, W, H) +
        text(title, { x: 12, y: 44, size: 20, weight: 800, anchor: "start" }) +
        text(subtitle, { x: 12, y: 70, size: 14, weight: 600, fill: THEME.subtle, anchor: "start" }),
    ),
  );
}
