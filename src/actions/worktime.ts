import {
  action,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type KeyUpEvent,
  SingletonAction,
  type TitleParametersDidChangeEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { PLUGIN_ID } from "../config";
import { messageKey, worktimeKey } from "../render/keys";
import { showImage, updates } from "../throttle";
import {
  type Command,
  computeWorktime,
  DEFAULT_MAX_HOURS,
  DEFAULT_TARGET_HOURS,
  hoursToMinutes,
  minuteOfDay,
  nextCommand,
  type WorktimeOptions,
} from "../worktime/model";
import { worktime } from "../worktime/service";

export type WorktimeSettings = {
  /** Target hours per day (string from the property inspector). */
  targetHours?: string | number;
  /** Maximum hours per day; the bar ends here. */
  maxHours?: string | number;
};

/** A press held at least this long ends the day (reset) instead of cycling. */
export const LONG_PRESS_MS = 600;

export function worktimeOptions(settings: WorktimeSettings | undefined): WorktimeOptions {
  const targetMin = hoursToMinutes(settings?.targetHours, DEFAULT_TARGET_HOURS);
  return { targetMin, maxMin: Math.max(targetMin, hoursToMinutes(settings?.maxHours, DEFAULT_MAX_HOURS)) };
}

/** Image for keys that cannot show the worktime (not configured, offline, no state yet). */
export function unavailableImage(): string | undefined {
  if (worktime.state === "unconfigured") {
    return messageKey("Set up", "see settings");
  }
  if (!worktime.isConnected) {
    return messageKey("Offline", worktime.state === "error" ? "check settings" : "connecting…");
  }
  if (worktime.worktime === undefined) {
    return messageKey("Waiting", "for the panel");
  }
  return undefined;
}

/** Decides between the short-press command and the long-press reset. */
export function pressCommand(heldMs: number): Command {
  return heldMs >= LONG_PRESS_MS ? "reset" : nextCommand(worktime.worktime);
}

/** The worktime key: net time, progress bar and state; press cycles clock in / pause / resume, long press resets. */
@action({ UUID: `${PLUGIN_ID}.worktime` })
export class WorktimeAction extends SingletonAction<WorktimeSettings> {
  readonly #settings = new Map<string, WorktimeSettings>();
  /** Keys with a user-defined title: the caption is not drawn into the image then. */
  readonly #hasTitle = new Map<string, boolean>();
  readonly #pressedAt = new Map<string, number>();

  override onWillAppear(ev: WillAppearEvent<WorktimeSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<WorktimeSettings>): void {
    this.#settings.delete(ev.action.id);
    this.#hasTitle.delete(ev.action.id);
    this.#pressedAt.delete(ev.action.id);
    updates.forget(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<WorktimeSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onTitleParametersDidChange(ev: TitleParametersDidChangeEvent<WorktimeSettings>): Promise<void> {
    this.#hasTitle.set(ev.action.id, ev.payload.title.trim() !== "");
    return this.#render(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent<WorktimeSettings>): void {
    this.#pressedAt.set(ev.action.id, Date.now());
  }

  override async onKeyUp(ev: KeyUpEvent<WorktimeSettings>): Promise<void> {
    const pressedAt = this.#pressedAt.get(ev.action.id);
    this.#pressedAt.delete(ev.action.id);
    const command = pressCommand(pressedAt === undefined ? 0 : Date.now() - pressedAt);
    const ok = await worktime.send(command);
    await (ok ? ev.action.showOk() : ev.action.showAlert());
  }

  /** Re-renders all visible keys. */
  async refresh(): Promise<void> {
    for (const id of this.#settings.keys()) {
      await this.#render(id);
    }
  }

  async #render(actionId: string): Promise<void> {
    const key = this.actions.find((a) => a.id === actionId) as KeyAction<WorktimeSettings> | undefined;
    const settings = this.#settings.get(actionId);
    if (!key || !settings) {
      return;
    }

    const unavailable = unavailableImage();
    if (unavailable) {
      showImage(key, unavailable);
      return;
    }

    const options = worktimeOptions(settings);
    showImage(
      key,
      worktimeKey({
        worktime: computeWorktime(worktime.worktime, minuteOfDay(), options),
        ...options,
        showCaption: !this.#hasTitle.get(actionId),
      }),
    );
  }
}
