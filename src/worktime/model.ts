/**
 * The worktime model, a mirror of the Berry app `arbeitszeit.ax` on the
 * AWTRIX panel. The panel is the source of truth: it publishes its state and
 * applies the commands. The plugin only recomputes the net time between two
 * updates, with the same rules as the panel.
 */

/** Hour from which an unstarted day is shown as 0:00 (before that the app is hidden). */
export const SHOW_FROM_MIN = 8 * 60;

export const DEFAULT_TARGET_HOURS = 8;
export const DEFAULT_MAX_HOURS = 10;

/**
 * State as published by the panel on `awtrix/arbeitszeit/state`.
 * All `*Min` values are minutes of the day (0–1439) on the panel's clock.
 */
export type WorktimeState = {
  /** Clock-in time; undefined while not clocked in (before the day starts or after a reset). */
  startMin?: number;
  /** True while the time is frozen ("clocked out"). */
  paused: boolean;
  /** Minute of the day the current pause began; only meaningful while paused. */
  pausedAtMin: number;
  /** Sum of the pauses already taken today, in minutes. */
  pauseTotalMin: number;
  /** Net time as computed by the panel when it published; only used for plausibility. */
  netMin?: number;
};

export type Command = "clock_in" | "pause" | "resume" | "reset";

export type Phase =
  /** Not clocked in, before 8:00: the panel hides the app. */
  | "idle"
  /** Not clocked in, from 8:00: the panel shows 0:00 as a reminder. */
  | "ready"
  | "running"
  | "paused";

export type Worktime = {
  phase: Phase;
  /** Minutes of attendance since clock-in, pauses taken included. */
  grossMin: number;
  /** Break actually deducted: the larger of the pauses taken and the statutory one. */
  breakMin: number;
  netMin: number;
  /** Net minutes beyond the target, 0 while under it. */
  overMin: number;
  /** Net minutes still missing to the target, 0 once reached. */
  remainingMin: number;
  /** The maximum working time has been reached ("Feierabend!"). */
  reachedMax: boolean;
};

export type WorktimeOptions = {
  targetMin: number;
  maxMin: number;
};

/**
 * Break rule of the Berry app. Pauses taken count towards the statutory break
 * instead of adding to it.
 *
 * Deducted from the attendance is the smallest duration that both covers the
 * pauses taken and satisfies the statutory break for the working time it
 * produces (over 6 h: 30 min, over 9 h: 45 min). When the attendance sits just
 * above a threshold, less than the full break suffices and the working time is
 * capped at the threshold instead. Defined this way the result is always
 * permissible, always the largest permissible one, and a longer pause can never
 * yield more working time.
 */
export function breakMinutes(attendanceMin: number, pauseTakenMin = 0): number {
  const attendance = Math.max(0, attendanceMin);
  const taken = Math.max(0, pauseTakenMin);
  let deduction = taken;
  if (attendance - deduction > 6 * 60 && deduction < 30) {
    deduction = Math.max(taken, Math.min(30, attendance - 6 * 60));
  }
  if (attendance - deduction > 9 * 60 && deduction < 45) {
    deduction = Math.max(taken, Math.min(45, attendance - 9 * 60));
  }
  return deduction;
}

/** Net working time for an attendance and the pauses already taken, never negative. */
export function netMinutes(attendanceMin: number, pauseTakenMin = 0): number {
  const attendance = Math.max(0, attendanceMin);
  return Math.max(0, attendance - breakMinutes(attendance, pauseTakenMin));
}

/** Phase of the 1 Hz colon blink, mirroring the panel's `(now_ms() / 500) % 2`. */
export function colonVisible(nowMs: number = Date.now()): boolean {
  return Math.floor(nowMs / 500) % 2 === 0;
}

/** Minute of the day (0–1439) of a Date, in local time. */
export function minuteOfDay(date: Date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Computes what the panel would show at `nowMin` for the last known state. */
export function computeWorktime(state: WorktimeState | undefined, nowMin: number, o: WorktimeOptions): Worktime {
  const empty = (phase: Phase): Worktime => ({
    phase,
    grossMin: 0,
    breakMin: 0,
    netMin: 0,
    overMin: 0,
    remainingMin: o.targetMin,
    reachedMax: false,
  });

  if (state?.startMin === undefined) {
    return empty(nowMin >= SHOW_FROM_MIN ? "ready" : "idle");
  }

  // While paused the time is frozen at the moment the pause began; the running
  // pause is not in pauseTotalMin yet, exactly as on the panel.
  const until = state.paused ? state.pausedAtMin : nowMin;
  const grossMin = Math.max(0, until - state.startMin);
  const breakMin = breakMinutes(grossMin, state.pauseTotalMin);
  const netMin = netMinutes(grossMin, state.pauseTotalMin);

  return {
    phase: state.paused ? "paused" : "running",
    grossMin,
    breakMin,
    netMin,
    overMin: Math.max(0, netMin - o.targetMin),
    remainingMin: Math.max(0, o.targetMin - netMin),
    reachedMax: netMin >= o.maxMin,
  };
}

/** The command the select button (and a key press) sends in a state. */
export function nextCommand(state: WorktimeState | undefined): Command {
  if (state?.startMin === undefined) {
    return "clock_in";
  }
  return state.paused ? "resume" : "pause";
}

/** Applies a command locally, exactly like the panel would (used by the fallback and for optimistic updates). */
export function applyCommand(state: WorktimeState | undefined, command: Command, nowMin: number): WorktimeState | undefined {
  switch (command) {
    case "clock_in":
      return state?.startMin === undefined ? { startMin: nowMin, paused: false, pausedAtMin: 0, pauseTotalMin: 0 } : state;
    case "pause":
      return state?.startMin !== undefined && !state.paused ? { ...state, paused: true, pausedAtMin: nowMin } : state;
    case "resume": {
      if (state?.startMin === undefined || !state.paused) {
        return state;
      }
      // The start time stays put; the pause is added to the running total.
      const pauseLen = Math.max(0, nowMin - state.pausedAtMin);
      return { startMin: state.startMin, paused: false, pausedAtMin: 0, pauseTotalMin: state.pauseTotalMin + pauseLen };
    }
    case "reset":
      return undefined;
  }
}

/** Parses the JSON payload of the state topic; undefined for anything unusable. */
export function parseState(payload: string): WorktimeState | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  const startMin = asMinute(r.start_min);
  if (r.start_min !== undefined && r.start_min !== null && r.start_min !== "" && startMin === undefined) {
    return undefined;
  }
  const paused = r.paused === true || r.paused === 1 || r.paused === "true";
  // Panels before the pause rework publish only `pause_min`, and it carries the
  // minute the pause began rather than a total. Fall back to it when `paused_at`
  // is missing, so an older panel still freezes the time at the right moment.
  const legacy = r.paused_at === undefined;
  return {
    startMin,
    paused: startMin !== undefined && paused,
    pausedAtMin: (legacy ? asMinute(r.pause_min) : asMinute(r.paused_at)) ?? 0,
    pauseTotalMin: (legacy ? 0 : asMinute(r.pause_min)) ?? 0,
    netMin: asMinute(r.net_min),
  };
}

function asMinute(value: unknown): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/** Parses the app setting `start` ("HH:MM", or "" while not clocked in). */
export function parseStartSetting(value: string | undefined): number | undefined {
  const m = /(\d{1,2}):(\d{1,2})/.exec(value ?? "");
  if (!m) {
    return undefined;
  }
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min < 24 * 60 ? min : undefined;
}

/** Formats a minute of the day like the Berry app writes the `start` setting ("08:05"). */
export function formatStartSetting(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "H:MM", the format the panel shows. */
export function formatDuration(min: number): string {
  const total = Math.max(0, Math.round(min));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Hours setting from the property inspector (stored as string or number) with a default. */
export function hoursToMinutes(value: unknown, defaultHours: number): number {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  const hours = typeof n === "number" && Number.isFinite(n) && n > 0 ? n : defaultHours;
  return Math.round(hours * 60);
}
