import { applyCommand, type Command, formatStartSetting, minuteOfDay, parseStartSetting, type WorktimeState } from "./model";
import type { Backend, BackendSink } from "./service";

/** How often the app setting `start` is read from the panel. */
const POLL_MS = 30_000;
const TIMEOUT_MS = 8_000;

/**
 * Fallback without MQTT: reads and writes the Berry app's `start` setting
 * ("HH:MM") through the AWTRIX app config API.
 *
 * Endpoints (AWTRIX NG 1.1):
 *   GET   /api/v1/apps/<app>/config   → { "name": "arbeitszeit", "fields": [ { "key": "start", "value": "08:30", ... }, ... ] }
 *                                       (older shapes { "start": "08:30" } and [ { "key", "value" } ] are accepted too)
 *   PATCH /api/v1/apps/<app>/config   ← { "start": "08:30", "pause": 35 }   (verified against firmware 1.2.2)
 *
 * The app keeps both halves of its state in settings: `start` is the clock-in
 * time and `pause` the sum of the pauses taken, so a pause survives here as
 * well and both sides compute the same net time. Only the running pause is
 * plugin-local - it has not been added to the total yet.
 */
export class AwtrixBackend implements Backend {
  readonly #configUrl: string;
  readonly #sink: BackendSink;
  #timer: ReturnType<typeof setInterval> | undefined;
  #pausedAt: number | undefined;
  #startMin: number | undefined;
  #pauseTotal = 0;
  #polling = false;

  constructor(baseUrl: string, app: string, sink: BackendSink) {
    this.#configUrl = `${baseUrl}/api/v1/apps/${encodeURIComponent(app)}/config`;
    this.#sink = sink;
  }

  start(): void {
    this.#sink.setState("connecting");
    void this.#poll();
    this.#timer = setInterval(() => void this.#poll(), POLL_MS);
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  async send(command: Command, current: WorktimeState | undefined): Promise<boolean> {
    const now = minuteOfDay();
    const next = applyCommand(current, command, now);
    if (next === current) {
      return true;
    }
    if (command === "pause") {
      this.#pausedAt = next?.pausedAtMin;
      return true;
    }
    // clock_in, resume and reset change what the panel has stored.
    const ok = await this.#writeConfig(next?.startMin, next?.pauseTotalMin ?? 0);
    if (ok) {
      this.#pausedAt = undefined;
      this.#startMin = next?.startMin;
      this.#pauseTotal = next?.pauseTotalMin ?? 0;
    }
    return ok;
  }

  #publish(): void {
    if (this.#startMin === undefined) {
      this.#sink.setWorktime({ paused: false, pausedAtMin: 0, pauseTotalMin: 0 });
    } else {
      this.#sink.setWorktime({
        startMin: this.#startMin,
        paused: this.#pausedAt !== undefined,
        pausedAtMin: this.#pausedAt ?? 0,
        pauseTotalMin: this.#pauseTotal,
      });
    }
  }

  async #poll(): Promise<void> {
    if (this.#polling) {
      return;
    }
    this.#polling = true;
    try {
      const response = await fetch(this.#configUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) {
        this.#sink.setState("error", `AWTRIX answered ${response.status} for ${this.#configUrl}`);
        return;
      }
      const config = await response.json();
      const startMin = parseStartSetting(readField(config, "start"));
      const pauseTotal = Math.max(0, Number(readField(config, "pause") ?? 0) || 0);
      if (startMin !== this.#startMin) {
        // The start moved on the panel (button, settings page or midnight reset).
        this.#startMin = startMin;
        this.#pausedAt = undefined;
      }
      this.#pauseTotal = pauseTotal;
      this.#sink.setState("connected");
      this.#publish();
    } catch (err) {
      this.#sink.setState("error", `Cannot reach AWTRIX: ${(err as Error).message}`);
    } finally {
      this.#polling = false;
    }
  }

  async #writeConfig(startMin: number | undefined, pauseMin: number): Promise<boolean> {
    try {
      const response = await fetch(this.#configUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: startMin === undefined ? "" : formatStartSetting(startMin), pause: pauseMin }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.#sink.setState("error", `AWTRIX answered ${response.status} when writing the work time`);
        return false;
      }
      return true;
    } catch (err) {
      this.#sink.setState("error", `Cannot reach AWTRIX: ${(err as Error).message}`);
      return false;
    }
  }
}

/** Extracts one setting's value from any of the config answer shapes. */
export function readField(config: unknown, key: string): string | undefined {
  if (config && typeof config === "object" && Array.isArray((config as { fields?: unknown }).fields)) {
    return readField((config as { fields: unknown[] }).fields, key);
  }
  if (Array.isArray(config)) {
    const item = config.find((c) => c && typeof c === "object" && (c as { key?: unknown }).key === key) as
      | { value?: unknown }
      | undefined;
    return item?.value === undefined || item.value === null ? undefined : String(item.value);
  }
  if (config && typeof config === "object") {
    const value = (config as Record<string, unknown>)[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
    if (value && typeof value === "object") {
      const inner = (value as { value?: unknown }).value;
      if (typeof inner === "string" || typeof inner === "number") {
        return String(inner);
      }
    }
  }
  return undefined;
}
