import type { Phase } from "../worktime/model";

/** Colors shared by all key and dial images. */
export const THEME = {
  base: "#0B1220",
  surface: "#1E293B",
  muted: "#334155",
  subtle: "#94A3B8",
  empty: "#070B14",
  accent: "#6366F1",
  ok: "#22C55E",
  error: "#EF4444",
  warn: "#F59E0B",
  info: "#3B82F6",
  idle: "#64748B",
};

/** Accent color of a worktime phase; overtime and the maximum override it. */
export function phaseColor(phase: Phase, overtime: boolean, reachedMax: boolean): string {
  if (phase === "running" || phase === "paused") {
    if (reachedMax) {
      return THEME.error;
    }
    return overtime ? THEME.warn : THEME.ok;
  }
  return THEME.idle;
}
