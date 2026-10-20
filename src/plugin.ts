import streamDeck from "@elgato/streamdeck";
import { DialWorktimeAction } from "./actions/dial-worktime";
import { WorktimeAction } from "./actions/worktime";
import { worktime, type WorktimeSettings } from "./worktime/service";

type JsonValue = Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0];

/** The net time is recomputed from the last panel state this often. */
const REFRESH_MS = 30_000;
/** Colon blink while the time runs; matches the panel's 500 ms phase. */
const BLINK_MS = 500;

streamDeck.logger.setLevel("info");

const key = new WorktimeAction();
const dial = new DialWorktimeAction();

streamDeck.actions.registerAction(key);
streamDeck.actions.registerAction(dial);

// Keep every visible key and dial in sync with the panel.

function refreshAll(): void {
  void key.refresh();
  void dial.refresh();
}

/**
 * The colon blinks only while the time actually runs, so a stopped clock is
 * visibly stopped. The timer exists only then - idle and paused keys are
 * static and need no redraw twice a second.
 */
let blinkTimer: ReturnType<typeof setInterval> | undefined;

function syncBlink(): void {
  const state = worktime.worktime;
  const running = state?.startMin !== undefined && !state.paused;
  if (running && blinkTimer === undefined) {
    blinkTimer = setInterval(refreshAll, BLINK_MS);
  } else if (!running && blinkTimer !== undefined) {
    clearInterval(blinkTimer);
    blinkTimer = undefined;
  }
}

worktime.on("worktime", () => {
  syncBlink();
  refreshAll();
});

worktime.on("state", () => {
  streamDeck.logger.info(`panel connection: ${worktime.state}${worktime.error ? ` (${worktime.error})` : ""}`);
  syncBlink();
  refreshAll();
  sendToPropertyInspector(statusMessage());
});

setInterval(refreshAll, REFRESH_MS);

// Messages from the property inspectors (ui/*.html).

type UiMessage = { event: "getStatus" } | { event: "connect"; settings: WorktimeSettings } | { event: "disconnect" };

streamDeck.ui.onSendToPlugin<UiMessage>(async (ev) => {
  const message = ev.payload;
  switch (message.event) {
    case "getStatus":
      sendToPropertyInspector(statusMessage());
      break;
    case "connect":
      await saveSettings(message.settings);
      break;
    case "disconnect":
      await saveSettings({ ...worktime.settings, url: undefined, awtrixUrl: undefined, password: undefined });
      break;
  }
});

function statusMessage(): JsonValue {
  const s = worktime.settings;
  return {
    event: "status",
    state: worktime.state,
    error: worktime.error ?? "",
    mode: worktime.mode,
    url: s.url ?? "",
    username: s.username ?? "",
    topic: s.topic ?? "",
    awtrixUrl: s.awtrixUrl ?? "",
    awtrixApp: s.awtrixApp ?? "",
    configured: worktime.state !== "unconfigured",
    hasState: worktime.worktime !== undefined,
    updatedAt: worktime.updatedAt ?? 0,
  };
}

function sendToPropertyInspector(payload: JsonValue): void {
  if (streamDeck.ui.action) {
    streamDeck.ui.sendToPropertyInspector(payload).catch(() => undefined);
  }
}

async function saveSettings(settings: WorktimeSettings): Promise<void> {
  await streamDeck.settings.setGlobalSettings(settings);
  worktime.configure(settings);
  sendToPropertyInspector(statusMessage());
}

streamDeck.settings.onDidReceiveGlobalSettings<WorktimeSettings>((ev) => worktime.configure(ev.settings));

await streamDeck.connect();
worktime.configure(await streamDeck.settings.getGlobalSettings<WorktimeSettings>());
