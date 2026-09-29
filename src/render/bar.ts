import { THEME } from "./theme";

export type BarInput = {
  netMin: number;
  targetMin: number;
  maxMin: number;
};

/** Length of one overtime segment in minutes. */
export const SEGMENT_MIN = 30;

/**
 * Progress bar like on the panel: the net time fills the bar in the normal
 * color up to the target, overtime is appended as segments in the overtime
 * color. The bar spans the maximum working time.
 */
export function progressBar(b: BarInput, x: number, y: number, width: number, height: number, normalColor: string, overColor: string): string {
  const scale = Math.max(b.maxMin, b.targetMin, 1);
  const px = (min: number) => (width * min) / scale;
  const radius = Math.min(height / 2, 3);

  let out = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${THEME.muted}"/>`;

  const normal = Math.min(b.netMin, b.targetMin);
  if (normal > 0) {
    out += `<rect x="${x}" y="${y}" width="${px(normal).toFixed(1)}" height="${height}" rx="${radius}" fill="${normalColor}"/>`;
  }

  const over = Math.min(Math.max(0, b.netMin - b.targetMin), Math.max(0, b.maxMin - b.targetMin));
  const gap = 2;
  let start = b.targetMin;
  while (start < b.targetMin + over) {
    const end = Math.min(start + SEGMENT_MIN, b.targetMin + over);
    const sx = x + px(start) + (start === b.targetMin ? gap : gap / 2);
    const sw = Math.max(1, px(end - start) - gap);
    out += `<rect x="${sx.toFixed(1)}" y="${y}" width="${sw.toFixed(1)}" height="${height}" rx="${Math.min(radius, sw / 2).toFixed(1)}" fill="${overColor}"/>`;
    start = end;
  }

  // Target mark, so the remaining distance is visible at a glance.
  if (b.targetMin < scale) {
    const tx = x + px(b.targetMin);
    out += `<rect x="${(tx - 1).toFixed(1)}" y="${y - 2}" width="2" height="${height + 4}" fill="#FFFFFF" fill-opacity="0.7"/>`;
  }
  return out;
}
