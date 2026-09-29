import { applyCommand, type Command, formatStartSetting, minuteOfDay, parseStartSetting, type WorktimeState } from "./model";
import type { Backend, BackendSink } from "./service";

/** How often the app setting `start` is read from the panel. */
const POLL_MS = 30_000;
const TIMEOUT_MS = 8_000;

/**
 * Fallback without MQTT: reads and writes the Berry app's `start` setting
 * ("HH:MM") through the AWTRIX app config API.
 *
 * Assumed endpoints (AWTRIX NG):
 *   GET   /api/v1/apps/<app>/config   → { "start": "08:30", "soll": 8, ... }
 *                                       (or a list of { "key", "value" } items)
 *   PATCH /api/v1/apps/<app>/config   ← { "start": "08:30" }
 *
 * The panel has no pause state in its settings, so a pause is kept in the
 * plugin only: resuming moves the start time by the pause length, exactly
 * like the panel's select button does.
 */
export class AwtrixBackend implements Backend {
  readonly #configUrl: string;
  readonly #sink: BackendSink;
  #timer: ReturnType<typeof setInterval> | undefined;
  #pausedAt: number | undefined;
  #startMin: number | undefined;
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
      this.#pausedAt = next?.pauseMin;
      return true;
    }
    // clock_in, resume and reset change the start time on the panel.
    const ok = await this.#writeStart(next?.startMin);
    if (ok) {
      this.#pausedAt = undefined;
      this.#startMin = next?.startMin;
    }
    return ok;
  }

  #publish(): void {
    if (this.#startMin === undefined) {
      this.#sink.setWorktime({ paused: false, pauseMin: 0 });
    } else {
      this.#sink.setWorktime({ startMin: this.#startMin, paused: this.#pausedAt !== undefined, pauseMin: this.#pausedAt ?? 0 });
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
      const startMin = parseStartSetting(readStart(await response.json()));
      if (startMin !== this.#startMin) {
        // The start moved on the panel (button, settings page or midnight reset).
        this.#startMin = startMin;
        this.#pausedAt = undefined;
      }
      this.#sink.setState("connected");
      this.#publish();
    } catch (err) {
      this.#sink.setState("error", `Cannot reach AWTRIX: ${(err as Error).message}`);
    } finally {
      this.#polling = false;
    }
  }

  async #writeStart(startMin: number | undefined): Promise<boolean> {
    try {
      const response = await fetch(this.#configUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: startMin === undefined ? "" : formatStartSetting(startMin) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.#sink.setState("error", `AWTRIX answered ${response.status} when writing the start time`);
        return false;
      }
      return true;
    } catch (err) {
      this.#sink.setState("error", `Cannot reach AWTRIX: ${(err as Error).message}`);
      return false;
    }
  }
}

/** Extracts the `start` value from either config answer shape. */
export function readStart(config: unknown): string | undefined {
  if (Array.isArray(config)) {
    const item = config.find((c) => c && typeof c === "object" && (c as { key?: unknown }).key === "start") as
      | { value?: unknown }
      | undefined;
    return typeof item?.value === "string" ? item.value : undefined;
  }
  if (config && typeof config === "object") {
    const value = (config as Record<string, unknown>).start;
    if (typeof value === "string") {
      return value;
    }
    if (value && typeof value === "object" && typeof (value as { value?: unknown }).value === "string") {
      return (value as { value: string }).value;
    }
  }
  return undefined;
}
