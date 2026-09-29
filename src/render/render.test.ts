import { describe, expect, it } from "vitest";
import { computeWorktime, type Worktime } from "../worktime/model";
import { progressBar, SEGMENT_MIN } from "./bar";
import { dialCanvas, dialMessage } from "./dial";
import { caption, messageKey, worktimeKey } from "./keys";
import { THEME } from "./theme";

const options = { targetMin: 8 * 60, maxMin: 10 * 60 };
const at = (h: number, m = 0) => h * 60 + m;

const decode = (dataUrl: string) => Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8");

const running = (netMin: number, over: Partial<Worktime> = {}): Worktime => ({
  phase: "running",
  grossMin: netMin,
  breakMin: 0,
  netMin,
  overMin: Math.max(0, netMin - options.targetMin),
  remainingMin: Math.max(0, options.targetMin - netMin),
  reachedMax: netMin >= options.maxMin,
  ...over,
});

const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)</g)].map((m) => m[1]);

describe("captions", () => {
  it("describes every phase", () => {
    expect(caption(computeWorktime(undefined, at(7), options))).toBe("not started");
    expect(caption(computeWorktime(undefined, at(9), options))).toBe("press to clock in");
    expect(caption(running(at(5, 30)))).toBe("2:30 to go");
    expect(caption(running(at(8, 15)))).toBe("+0:15 overtime");
    expect(caption(running(at(10)))).toBe("max reached");
    expect(caption({ ...running(at(3)), phase: "paused" })).toBe("paused");
  });
});

describe("worktime key", () => {
  it("is a 144×144 SVG data URL", () => {
    const image = worktimeKey({ worktime: running(90), ...options });
    expect(image.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svg = decode(image);
    expect(svg).toContain('width="144" height="144"');
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("shows the net time as H:MM without a blinking colon", () => {
    const svg = decode(worktimeKey({ worktime: running(at(1, 5)), ...options }));
    expect(texts(svg)).toEqual(["1:05", "6:55 to go"]);
  });

  it("colors the day green under the target and orange in overtime", () => {
    expect(decode(worktimeKey({ worktime: running(at(4)), ...options }))).toContain(`fill="${THEME.ok}"`);
    const over = decode(worktimeKey({ worktime: running(at(8, 30)), ...options }));
    expect(over).toContain(`height="5" fill="${THEME.warn}"`);
    expect(texts(over)).toEqual(["8:30", "+0:30 overtime"]);
  });

  it("turns red once the maximum is reached", () => {
    const svg = decode(worktimeKey({ worktime: running(at(10)), ...options }));
    expect(svg).toContain(`height="5" fill="${THEME.error}"`);
    expect(texts(svg)).toContain("max reached");
  });

  it("draws the pause indicator only while paused", () => {
    const paused = decode(worktimeKey({ worktime: { ...running(at(3)), phase: "paused" }, ...options }));
    expect(paused).toContain("paused");
    expect(paused.match(/<rect x="112"/g)).toHaveLength(1);
    expect(decode(worktimeKey({ worktime: running(at(3)), ...options }))).not.toContain('<rect x="112"');
  });

  it("renders the hidden state before 8:00 dimmed and without a bar", () => {
    const svg = decode(worktimeKey({ worktime: computeWorktime(undefined, at(7), options), ...options }));
    expect(texts(svg)).toEqual(["0:00", "not started"]);
    expect(svg).toContain(THEME.empty);
    expect(svg).not.toContain(THEME.muted);
  });

  it("leaves out the caption when the key has its own title", () => {
    const svg = decode(worktimeKey({ worktime: running(at(2)), ...options, showCaption: false }));
    expect(texts(svg)).toEqual(["2:00"]);
  });
});

describe("progress bar", () => {
  const bar = (netMin: number) => progressBar({ netMin, ...options }, 0, 0, 600, 8, "NORMAL", "OVER");

  it("fills the normal color up to the target", () => {
    expect(bar(0)).not.toContain("NORMAL");
    // 4 h of a 10 h bar = 40 %
    expect(bar(at(4))).toContain('width="240.0" height="8" rx="3" fill="NORMAL"');
    expect(bar(at(4))).not.toContain("OVER");
  });

  it("appends overtime segments after the target", () => {
    const full = bar(at(9));
    expect(full).toContain('width="480.0" height="8" rx="3" fill="NORMAL"');
    expect(full.match(/fill="OVER"/g)).toHaveLength(60 / SEGMENT_MIN);
    expect(bar(at(8, 10)).match(/fill="OVER"/g)).toHaveLength(1);
  });

  it("does not grow beyond the maximum", () => {
    expect(bar(at(12)).match(/fill="OVER"/g)).toHaveLength(120 / SEGMENT_MIN);
  });
});

describe("dial and messages", () => {
  it("draws the touch strip at 200×100 with time and caption", () => {
    const svg = decode(dialCanvas({ worktime: running(at(7, 45)), ...options }));
    expect(svg).toContain('width="200" height="100"');
    expect(texts(svg)).toEqual(["Worktime", "7:45", "0:15 to go"]);
  });

  it("escapes message text", () => {
    expect(decode(messageKey("A & B", "<x>"))).toContain("A &amp; B");
    expect(decode(dialMessage("Offline", "check <settings>"))).not.toContain("<settings>");
  });
});
