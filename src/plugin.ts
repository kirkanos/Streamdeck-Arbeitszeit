import streamDeck from "@elgato/streamdeck";
import { DialWorktimeAction } from "./actions/dial-worktime";
import { WorktimeAction } from "./actions/worktime";
import { worktime, type WorktimeSettings } from "./worktime/service";

type JsonValue = Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0];

/** The net time is recomputed from the last panel state this often. */
const REFRESH_MS = 30_000;

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

worktime.on("worktime", refreshAll);

worktime.on("state", () => {
  streamDeck.logger.info(`panel connection: ${worktime.state}${worktime.error ? ` (${worktime.error})` : ""}`);
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
