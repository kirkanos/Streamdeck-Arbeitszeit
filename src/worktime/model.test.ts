import { describe, expect, it } from "vitest";
import {
  applyCommand,
  breakMinutes,
  computeWorktime,
  formatDuration,
  formatStartSetting,
  hoursToMinutes,
  netMinutes,
  nextCommand,
  parseStartSetting,
  parseState,
  type WorktimeState,
} from "./model";

const options = { targetMin: 8 * 60, maxMin: 10 * 60 };
const at = (h: number, m = 0) => h * 60 + m;

describe("break rules", () => {
  it("deducts nothing under 6 hours gross", () => {
    expect(breakMinutes(0)).toBe(0);
    expect(breakMinutes(at(5, 59))).toBe(0);
    expect(netMinutes(at(5, 59))).toBe(at(5, 59));
  });

  it("deducts 30 minutes from exactly 6 hours gross", () => {
    expect(breakMinutes(at(6))).toBe(30);
    expect(netMinutes(at(6))).toBe(at(5, 30));
    expect(netMinutes(at(7, 59))).toBe(at(7, 29));
  });

  it("deducts 45 minutes from exactly 8 hours gross", () => {
    expect(breakMinutes(at(8))).toBe(45);
    expect(netMinutes(at(8))).toBe(at(7, 15));
    expect(netMinutes(at(10, 45))).toBe(at(10));
  });

  it("never goes negative", () => {
    expect(netMinutes(-30)).toBe(0);
  });
});

describe("computeWorktime", () => {
  it("is idle before 8:00 and ready from 8:00 while not clocked in", () => {
    expect(computeWorktime(undefined, at(7, 59), options)).toMatchObject({ phase: "idle", netMin: 0 });
    expect(computeWorktime(undefined, at(8), options)).toMatchObject({ phase: "ready", netMin: 0 });
    expect(computeWorktime({ paused: false, pauseMin: 0 }, at(9), options).phase).toBe("ready");
  });

  it("counts from the start time", () => {
    const state: WorktimeState = { startMin: at(7, 32), paused: false, pauseMin: 0 };
    expect(computeWorktime(state, at(9, 2), options)).toMatchObject({
      phase: "running",
      grossMin: 90,
      breakMin: 0,
      netMin: 90,
      overMin: 0,
      remainingMin: at(8) - 90,
      reachedMax: false,
    });
  });

  it("applies the break rules at the boundaries", () => {
    const state: WorktimeState = { startMin: at(8), paused: false, pauseMin: 0 };
    expect(computeWorktime(state, at(13, 59), options).netMin).toBe(at(5, 59));
    expect(computeWorktime(state, at(14), options).netMin).toBe(at(5, 30));
    expect(computeWorktime(state, at(16), options).netMin).toBe(at(7, 15));
  });

  it("reports overtime and the maximum", () => {
    const state: WorktimeState = { startMin: at(7), paused: false, pauseMin: 0 };
    // 8:45 gross → 8:00 net: target reached, no overtime yet
    expect(computeWorktime(state, at(15, 45), options)).toMatchObject({ overMin: 0, remainingMin: 0 });
    // 9:00 gross → 8:15 net
    expect(computeWorktime(state, at(16), options)).toMatchObject({ overMin: 15, reachedMax: false });
    // 10:45 gross → 10:00 net
    expect(computeWorktime(state, at(17, 45), options)).toMatchObject({ overMin: 120, reachedMax: true });
  });

  it("freezes the time while paused", () => {
    const state: WorktimeState = { startMin: at(8), paused: true, pauseMin: at(12) };
    const w = computeWorktime(state, at(15), options);
    expect(w).toMatchObject({ phase: "paused", grossMin: 240, netMin: 240 });
    expect(computeWorktime(state, at(23), options).netMin).toBe(240);
  });

  it("clamps a start time in the future to zero", () => {
    expect(computeWorktime({ startMin: at(9), paused: false, pauseMin: 0 }, at(8), options).netMin).toBe(0);
  });
});

describe("commands", () => {
  it("cycles clock in → pause → resume like the select button", () => {
    expect(nextCommand(undefined)).toBe("clock_in");
    expect(nextCommand({ startMin: at(8), paused: false, pauseMin: 0 })).toBe("pause");
    expect(nextCommand({ startMin: at(8), paused: true, pauseMin: at(12) })).toBe("resume");
  });

  it("applies the commands like the panel", () => {
    const started = applyCommand(undefined, "clock_in", at(8, 5));
    expect(started).toEqual({ startMin: at(8, 5), paused: false, pauseMin: 0 });

    const paused = applyCommand(started, "pause", at(12));
    expect(paused).toEqual({ startMin: at(8, 5), paused: true, pauseMin: at(12) });

    // A 40 minute pause moves the start time by 40 minutes.
    const resumed = applyCommand(paused, "resume", at(12, 40));
    expect(resumed).toEqual({ startMin: at(8, 45), paused: false, pauseMin: 0 });

    expect(applyCommand(resumed, "reset", at(17))).toBeUndefined();
  });

  it("ignores commands that do not fit the state", () => {
    const running: WorktimeState = { startMin: at(8), paused: false, pauseMin: 0 };
    expect(applyCommand(running, "clock_in", at(9))).toBe(running);
    expect(applyCommand(running, "resume", at(9))).toBe(running);
    expect(applyCommand(undefined, "pause", at(9))).toBeUndefined();
  });
});

describe("parseState", () => {
  it("reads the panel's JSON", () => {
    expect(parseState('{"start_min":452,"paused":false,"pause_min":0,"net_min":123}')).toEqual({
      startMin: 452,
      paused: false,
      pauseMin: 0,
      netMin: 123,
    });
    expect(parseState('{"start_min":452,"paused":true,"pause_min":700}')).toMatchObject({ paused: true, pauseMin: 700 });
  });

  it("treats a missing or null start as not clocked in", () => {
    expect(parseState('{"start_min":null,"paused":false,"pause_min":0,"net_min":0}')).toMatchObject({ startMin: undefined, paused: false });
    expect(parseState("{}")).toMatchObject({ startMin: undefined });
  });

  it("rejects garbage", () => {
    expect(parseState("")).toBeUndefined();
    expect(parseState("not json")).toBeUndefined();
    expect(parseState("[1,2]")).toBeUndefined();
    expect(parseState('{"start_min":"soon"}')).toBeUndefined();
  });
});

describe("settings and formats", () => {
  it("parses and writes the start setting", () => {
    expect(parseStartSetting("08:05")).toBe(485);
    expect(parseStartSetting("7:32")).toBe(452);
    expect(parseStartSetting("")).toBeUndefined();
    expect(parseStartSetting(undefined)).toBeUndefined();
    expect(formatStartSetting(485)).toBe("08:05");
    expect(formatStartSetting(452)).toBe("07:32");
  });

  it("formats durations as H:MM", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("reads hour settings with defaults", () => {
    expect(hoursToMinutes(undefined, 8)).toBe(480);
    expect(hoursToMinutes("7.5", 8)).toBe(450);
    expect(hoursToMinutes("7,5", 8)).toBe(450);
    expect(hoursToMinutes(10, 8)).toBe(600);
    expect(hoursToMinutes("abc", 8)).toBe(480);
  });
});
