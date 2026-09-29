import { formatDuration, type Worktime } from "../worktime/model";
import { progressBar } from "./bar";
import { background, mix, svg, text, toDataUrl } from "./svg";
import { phaseColor, THEME } from "./theme";

/** Key images are drawn at 144×144 and scaled by Stream Deck. */
const S = 144;

export type WorktimeKey = {
  worktime: Worktime;
  targetMin: number;
  maxMin: number;
  /** Caption drawn under the time; omitted when the user shows their own title. */
  showCaption?: boolean;
};

/** Two vertical bars, the pause indicator. */
function pauseGlyph(x: number, y: number, size: number, fill = "#FFFFFF"): string {
  const w = size * 0.32;
  return (
    `<rect x="${x}" y="${y}" width="${w.toFixed(1)}" height="${size}" rx="${(w / 3).toFixed(1)}" fill="${fill}"/>` +
    `<rect x="${(x + size - w).toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${size}" rx="${(w / 3).toFixed(1)}" fill="${fill}"/>`
  );
}

/** Caption under the time: how far to the target, the overtime, or the state. */
export function caption(w: Worktime): string {
  switch (w.phase) {
    case "idle":
      return "not started";
    case "ready":
      return "press to clock in";
    case "paused":
      return "paused";
    case "running":
      if (w.reachedMax) {
        return "max reached";
      }
      return w.overMin > 0 ? `+${formatDuration(w.overMin)} overtime` : `${formatDuration(w.remainingMin)} to go`;
  }
}

export function worktimeKey(k: WorktimeKey): string {
  const w = k.worktime;
  const color = phaseColor(w.phase, w.overMin > 0, w.reachedMax);
  const active = w.phase === "running" || w.phase === "paused";

  let bg: string;
  if (w.phase === "idle") {
    bg = `<rect width="${S}" height="${S}" fill="${THEME.empty}"/>`;
  } else if (w.phase === "ready" || w.phase === "paused") {
    bg = background("bg", THEME.surface, THEME.base, S, S);
  } else {
    bg = background("bg", mix(color, THEME.base, 0.72), THEME.base, S, S);
  }
  const accent = active ? `<rect x="0" y="0" width="${S}" height="5" fill="${color}"/>` : "";

  const dim = w.phase === "idle";
  const time = text(formatDuration(w.netMin), {
    x: S / 2,
    y: 82,
    size: 44,
    weight: 800,
    fill: dim ? THEME.subtle : "#FFFFFF",
    opacity: dim ? 0.6 : 1,
  });

  const label =
    k.showCaption === false
      ? ""
      : text(caption(w), { x: S / 2, y: 104, size: 13, weight: 600, fill: dim ? THEME.subtle : "#FFFFFF", opacity: dim ? 0.6 : 0.75 });

  const pause = w.phase === "paused" ? pauseGlyph(S - 32, 16, 18, color) : "";

  const bar = dim
    ? ""
    : progressBar({ netMin: w.netMin, targetMin: k.targetMin, maxMin: k.maxMin }, 12, 121, S - 24, 9, THEME.ok, THEME.warn);

  return toDataUrl(svg(S, S, bg + accent + time + label + pause + bar));
}

/** Neutral key with two lines of text, e.g. "Offline / connecting…". */
export function messageKey(title: string, subtitle: string): string {
  return toDataUrl(
    svg(
      S,
      S,
      background("bg", THEME.surface, THEME.base, S, S) +
        `<rect x="3" y="3" width="${S - 6}" height="${S - 6}" rx="14" fill="none" stroke="${THEME.muted}" stroke-width="2"/>` +
        text(title, { x: S / 2, y: 68, size: 22, weight: 800 }) +
        text(subtitle, { x: S / 2, y: 92, size: 15, weight: 600, fill: THEME.subtle }),
    ),
  );
}
