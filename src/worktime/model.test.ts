import { describe, expect, it } from "vitest";
import {
  applyCommand,
  breakMinutes,
  colonVisible,
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
  it("deducts nothing under 6 hours", () => {
    expect(breakMinutes(0)).toBe(0);
    expect(breakMinutes(at(5, 59))).toBe(0);
    expect(netMinutes(at(5, 59))).toBe(at(5, 59));
  });

  it("deducts 30 minutes above 6 hours of working time", () => {
    expect(breakMinutes(at(7))).toBe(30);
    expect(netMinutes(at(7))).toBe(at(6, 30));
    expect(netMinutes(at(9, 30))).toBe(at(9));
  });

  it("deducts 45 minutes above 9 hours of working time", () => {
    expect(breakMinutes(at(10))).toBe(45);
    expect(netMinutes(at(10))).toBe(at(9, 15));
  });

  it("caps the working time at a threshold instead of over-deducting", () => {
    // 6:30 attendance: deducting the full 30 lands exactly on 6 h, which needs no break.
    expect(netMinutes(at(6, 30))).toBe(at(6));
    expect(breakMinutes(at(6, 20))).toBe(20);
    expect(netMinutes(at(6, 20))).toBe(at(6));
  });

  it("counts a pause taken towards the statutory one instead of adding to it", () => {
    // 35 minutes taken cover the 30 owed: only the 5 minutes above it cost time.
    expect(breakMinutes(at(9), 35)).toBe(35);
    expect(netMinutes(at(9), 35)).toBe(at(8, 25));
    // Without pressing pause the same attendance keeps the statutory 30.
    expect(netMinutes(at(9), 0)).toBe(at(8, 30));
  });

  it("still enforces the statutory break when too little was taken", () => {
    expect(breakMinutes(at(10), 35)).toBe(45);
    expect(netMinutes(at(10), 35)).toBe(at(9, 15));
  });

  it("deducts the full pause once it exceeds the statutory one", () => {
    expect(breakMinutes(at(10), 60)).toBe(60);
    expect(netMinutes(at(10), 60)).toBe(at(9));
  });

  it("is always permissible, maximal and monotonic", () => {
    const required = (net: number) => (net > at(9) ? 45 : net > at(6) ? 30 : 0);
    for (let attendance = 0; attendance <= at(14); attendance += 1) {
      let previous = Number.POSITIVE_INFINITY;
      for (let taken = 0; taken <= attendance; taken += 1) {
        const net = netMinutes(attendance, taken);
        const deduction = attendance - net;
        // Covers the pause taken and the statutory break for the result.
        expect(deduction).toBeGreaterThanOrEqual(taken);
        expect(deduction).toBeGreaterThanOrEqual(required(net));
        // No larger net time would be permissible.
        for (let d = taken; d < deduction; d += 1) {
          expect(d).toBeLessThan(required(attendance - d));
        }
        // A longer pause never yields more working time.
        expect(net).toBeLessThanOrEqual(previous);
        previous = net;
      }
    }
  });

  it("never goes negative", () => {
    expect(netMinutes(-30)).toBe(0);
    expect(netMinutes(60, 600)).toBe(0);
  });
});

describe("colonVisible", () => {
  it("toggles every 500 ms", () => {
    expect(colonVisible(0)).toBe(true);
    expect(colonVisible(499)).toBe(true);
    expect(colonVisible(500)).toBe(false);
    expect(colonVisible(1000)).toBe(true);
  });
});

describe("computeWorktime", () => {
  it("is idle before 8:00 and ready from 8:00 while not clocked in", () => {
    expect(computeWorktime(undefined, at(7, 59), options)).toMatchObject({ phase: "idle", netMin: 0 });
    expect(computeWorktime(undefined, at(8), options)).toMatchObject({ phase: "ready", netMin: 0 });
    expect(computeWorktime({ paused: false, pausedAtMin: 0, pauseTotalMin: 0 }, at(9), options).phase).toBe("ready");
  });

  it("counts from the start time", () => {
    const state: WorktimeState = { startMin: at(7, 32), paused: false, pausedAtMin: 0, pauseTotalMin: 0 };
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
    const state: WorktimeState = { startMin: at(8), paused: false, pausedAtMin: 0, pauseTotalMin: 0 };
    expect(computeWorktime(state, at(14), options).netMin).toBe(at(6));
    expect(computeWorktime(state, at(14, 30), options).netMin).toBe(at(6));
    expect(computeWorktime(state, at(15), options).netMin).toBe(at(6, 30));
    expect(computeWorktime(state, at(18), options).netMin).toBe(at(9, 15));
  });

  it("credits a pause taken against the statutory break", () => {
    const state: WorktimeState = { startMin: at(8), paused: false, pausedAtMin: 0, pauseTotalMin: 35 };
    // 9 h attendance, 35 min pressed: the 35 cover the 30 owed, only they are deducted.
    expect(computeWorktime(state, at(17), options)).toMatchObject({ grossMin: at(9), breakMin: 35, netMin: at(8, 25) });
  });

  it("reports overtime and the maximum", () => {
    const state: WorktimeState = { startMin: at(7), paused: false, pausedAtMin: 0, pauseTotalMin: 0 };
    // 8:30 attendance → 8:00 net: target reached, no overtime yet
    expect(computeWorktime(state, at(15, 30), options)).toMatchObject({ netMin: at(8), overMin: 0, remainingMin: 0 });
    // 8:45 attendance → 8:15 net
    expect(computeWorktime(state, at(15, 45), options)).toMatchObject({ overMin: 15, reachedMax: false });
    // 10:45 attendance → 10:00 net
    expect(computeWorktime(state, at(17, 45), options)).toMatchObject({ netMin: at(10), reachedMax: true });
  });

  it("freezes the time while paused", () => {
    const state: WorktimeState = { startMin: at(8), paused: true, pausedAtMin: at(12), pauseTotalMin: 0 };
    const w = computeWorktime(state, at(15), options);
    expect(w).toMatchObject({ phase: "paused", grossMin: 240, netMin: 240 });
    expect(computeWorktime(state, at(23), options).netMin).toBe(240);
  });

  it("clamps a start time in the future to zero", () => {
    expect(computeWorktime({ startMin: at(9), paused: false, pausedAtMin: 0, pauseTotalMin: 0 }, at(8), options).netMin).toBe(0);
  });
});

describe("commands", () => {
  it("cycles clock in → pause → resume like the select button", () => {
    expect(nextCommand(undefined)).toBe("clock_in");
    expect(nextCommand({ startMin: at(8), paused: false, pausedAtMin: 0, pauseTotalMin: 0 })).toBe("pause");
    expect(nextCommand({ startMin: at(8), paused: true, pausedAtMin: at(12), pauseTotalMin: 0 })).toBe("resume");
  });

  it("applies the commands like the panel", () => {
    const started = applyCommand(undefined, "clock_in", at(8, 5));
    expect(started).toEqual({ startMin: at(8, 5), paused: false, pausedAtMin: 0, pauseTotalMin: 0 });

    const paused = applyCommand(started, "pause", at(12));
    expect(paused).toEqual({ startMin: at(8, 5), paused: true, pausedAtMin: at(12), pauseTotalMin: 0 });

    // A 40 minute pause leaves the start alone and goes into the total.
    const resumed = applyCommand(paused, "resume", at(12, 40));
    expect(resumed).toEqual({ startMin: at(8, 5), paused: false, pausedAtMin: 0, pauseTotalMin: 40 });

    // A second pause adds to it.
    const again = applyCommand(applyCommand(resumed, "pause", at(15)), "resume", at(15, 10));
    expect(again).toMatchObject({ startMin: at(8, 5), pauseTotalMin: 50 });

    expect(applyCommand(resumed, "reset", at(17))).toBeUndefined();
  });

  it("ignores commands that do not fit the state", () => {
    const running: WorktimeState = { startMin: at(8), paused: false, pausedAtMin: 0, pauseTotalMin: 0 };
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
      pausedAtMin: 0,
      pauseTotalMin: 0,
      netMin: 123,
    });
    expect(parseState('{"start_min":452,"paused":true,"pause_min":700}')).toMatchObject({ paused: true, pausedAtMin: 700 });
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
