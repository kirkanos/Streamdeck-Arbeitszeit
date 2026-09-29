import { randomBytes } from "node:crypto";
import mqtt, { type MqttClient } from "mqtt";
import { type Command, parseState } from "./model";
import type { Backend, BackendSink, WorktimeSettings } from "./service";

/** Command the panel answers with a fresh state message (for brokers without the retained state). */
const QUERY_COMMAND = "state";

const URL_PATTERN = /^(mqtt|mqtts|ws|wss):\/\/.+/i;

/**
 * Subscribes to the panel's retained state topic and publishes commands.
 * mqtt.js reconnects by itself; the connection state follows its events.
 */
export class MqttBackend implements Backend {
  readonly #settings: WorktimeSettings;
  readonly #sink: BackendSink;
  #client: MqttClient | undefined;
  #stopped = false;

  constructor(settings: WorktimeSettings, sink: BackendSink) {
    this.#settings = settings;
    this.#sink = sink;
  }

  get #stateTopic(): string {
    return `${this.#settings.topic}/state`;
  }

  get #cmdTopic(): string {
    return `${this.#settings.topic}/cmd`;
  }

  start(): void {
    const url = this.#settings.url ?? "";
    if (!URL_PATTERN.test(url)) {
      this.#sink.setState("error", "The URL must start with mqtt://, mqtts://, ws:// or wss://");
      return;
    }
    this.#sink.setState("connecting");

    const client = mqtt.connect(url, {
      username: this.#settings.username,
      password: this.#settings.password,
      clientId: `streamdeck-arbeitszeit-${randomBytes(4).toString("hex")}`,
      clean: true,
      connectTimeout: 15_000,
      reconnectPeriod: 5_000,
      keepalive: 30,
      // The connection state is shown on the keys; a self-signed broker certificate would
      // otherwise fail silently. Users with mqtts:// and a private CA see the error text.
      rejectUnauthorized: true,
    });
    this.#client = client;

    client.on("connect", () => {
      client.subscribe(this.#stateTopic, { qos: 1 }, (err) => {
        if (err) {
          this.#sink.setState("error", `Subscribe failed: ${err.message}`);
          return;
        }
        this.#sink.setState("connected");
        // Ask for the current state in case the broker did not keep a retained message.
        client.publish(this.#cmdTopic, QUERY_COMMAND, { qos: 0 }, () => undefined);
      });
    });
    client.on("reconnect", () => this.#sink.setState("connecting"));
    client.on("offline", () => this.#sink.setState("connecting"));
    client.on("close", () => {
      if (!this.#stopped) {
        this.#sink.setState("connecting");
      }
    });
    client.on("error", (err) => this.#sink.setState("error", describe(err)));
    client.on("message", (topic, payload) => {
      if (topic !== this.#stateTopic) {
        return;
      }
      const text = payload.toString("utf8");
      if (text.trim() === "") {
        // The retained message was cleared.
        this.#sink.setWorktime(undefined);
        return;
      }
      const state = parseState(text);
      if (state) {
        this.#sink.setWorktime(state);
      }
    });
  }

  stop(): void {
    this.#stopped = true;
    this.#client?.removeAllListeners();
    this.#client?.end(true);
    this.#client = undefined;
  }

  async send(command: Command): Promise<boolean> {
    if (!this.#client?.connected) {
      return false;
    }
    try {
      await this.#client.publishAsync(this.#cmdTopic, command, { qos: 1 });
      return true;
    } catch {
      return false;
    }
  }
}

function describe(err: Error & { code?: string | number }): string {
  const code = typeof err.code === "string" ? err.code : undefined;
  switch (code) {
    case "ECONNREFUSED":
      return "Connection refused: is the broker reachable from this computer?";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Broker host not found";
    default:
      // mqtt.js reports CONNACK errors like "Connection refused: Not authorized".
      return err.message || "Connection error";
  }
}
