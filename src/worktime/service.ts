import { EventEmitter } from "node:events";
import { AwtrixBackend } from "./awtrix-backend";
import { applyCommand, type Command, minuteOfDay, type WorktimeState } from "./model";
import { MqttBackend } from "./mqtt-backend";

/** Global settings: how to reach the panel's Arbeitszeit app. */
export type WorktimeSettings = {
  /** "mqtt" (default) or the "awtrix" settings-API fallback. */
  mode?: "mqtt" | "awtrix";
  /** MQTT broker, e.g. mqtt://mosquitto.local:1883 or ws://mosquitto.local:9001 */
  url?: string;
  username?: string;
  password?: string;
  /** Base topic; the panel publishes on `<topic>/state` and listens on `<topic>/cmd`. */
  topic?: string;
  /** AWTRIX device for the fallback, e.g. http://awtrixng-xxxxxx.local */
  awtrixUrl?: string;
  /** Name of the script app on the panel. */
  awtrixApp?: string;
};

export const DEFAULT_TOPIC = "awtrix/arbeitszeit";
export const DEFAULT_AWTRIX_APP = "arbeitszeit";

export type ConnectionState = "unconfigured" | "connecting" | "connected" | "error";

/** What a backend reports back to the service. */
export type BackendSink = {
  setState(state: ConnectionState, error?: string): void;
  setWorktime(state: WorktimeState | undefined): void;
};

export type Backend = {
  start(): void;
  stop(): void;
  send(command: Command, current: WorktimeState | undefined): Promise<boolean>;
};

/**
 * Keeps the connection to the panel and its last known worktime state.
 *
 * Events:
 *   "worktime"  the worktime state changed
 *   "state"     the connection state changed
 */
export class WorktimeService extends EventEmitter<{ worktime: []; state: [] }> {
  #settings: WorktimeSettings = {};
  #backend: Backend | undefined;
  #state: ConnectionState = "unconfigured";
  #error: string | undefined;
  #worktime: WorktimeState | undefined;
  #updatedAt: number | undefined;

  get settings(): WorktimeSettings {
    return this.#settings;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  get error(): string | undefined {
    return this.#error;
  }

  get isConnected(): boolean {
    return this.#state === "connected";
  }

  /** Last state received from the panel; undefined until the first message. */
  get worktime(): WorktimeState | undefined {
    return this.#worktime;
  }

  /** Time (ms) of the last state update, for the status display. */
  get updatedAt(): number | undefined {
    return this.#updatedAt;
  }

  get mode(): "mqtt" | "awtrix" {
    return this.#settings.mode === "awtrix" ? "awtrix" : "mqtt";
  }

  /** Applies new connection settings; reconnects only when they changed. */
  configure(settings: WorktimeSettings): void {
    const next = normalize(settings);
    if (this.#backend && sameSettings(next, this.#settings)) {
      return;
    }
    this.#settings = next;
    this.#backend?.stop();
    this.#backend = undefined;
    this.#worktime = undefined;
    this.#updatedAt = undefined;
    this.emit("worktime");

    const sink: BackendSink = {
      setState: (state, error) => this.#setState(state, error),
      setWorktime: (state) => this.#setWorktime(state),
    };

    if (this.mode === "awtrix") {
      if (!next.awtrixUrl) {
        this.#setState("unconfigured");
        return;
      }
      this.#backend = new AwtrixBackend(next.awtrixUrl, next.awtrixApp ?? DEFAULT_AWTRIX_APP, sink);
    } else {
      if (!next.url) {
        this.#setState("unconfigured");
        return;
      }
      this.#backend = new MqttBackend(next, sink);
    }
    this.#backend.start();
  }

  /** Sends a command to the panel; true when it was accepted by the transport. */
  async send(command: Command): Promise<boolean> {
    if (!this.#backend || !this.isConnected) {
      return false;
    }
    const ok = await this.#backend.send(command, this.#worktime);
    if (ok) {
      // Show the change right away; the panel confirms it with its next state message.
      this.#setWorktime(applyCommand(this.#worktime, command, minuteOfDay()));
    }
    return ok;
  }

  #setWorktime(state: WorktimeState | undefined): void {
    this.#worktime = state;
    this.#updatedAt = Date.now();
    this.emit("worktime");
  }

  #setState(state: ConnectionState, error?: string): void {
    if (state === this.#state && error === this.#error) {
      return;
    }
    this.#state = state;
    this.#error = error;
    this.emit("state");
  }
}

function normalize(s: WorktimeSettings): WorktimeSettings {
  const trim = (v: string | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  return {
    mode: s.mode === "awtrix" ? "awtrix" : "mqtt",
    url: trim(s.url),
    username: trim(s.username),
    password: typeof s.password === "string" && s.password !== "" ? s.password : undefined,
    topic: trim(s.topic)?.replace(/\/+$/, "") ?? DEFAULT_TOPIC,
    awtrixUrl: trim(s.awtrixUrl)?.replace(/\/+$/, ""),
    awtrixApp: trim(s.awtrixApp) ?? DEFAULT_AWTRIX_APP,
  };
}

function sameSettings(a: WorktimeSettings, b: WorktimeSettings): boolean {
  return (
    a.mode === b.mode &&
    a.url === b.url &&
    a.username === b.username &&
    a.password === b.password &&
    a.topic === b.topic &&
    a.awtrixUrl === b.awtrixUrl &&
    a.awtrixApp === b.awtrixApp
  );
}

export const worktime = new WorktimeService();
