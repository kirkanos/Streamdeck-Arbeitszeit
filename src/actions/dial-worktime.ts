import {
  action,
  type DialAction,
  type DialDownEvent,
  type DialUpEvent,
  type DidReceiveSettingsEvent,
  SingletonAction,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { PLUGIN_ID } from "../config";
import { dialCanvas, dialMessage } from "../render/dial";
import { updates } from "../throttle";
import { type Command, computeWorktime, minuteOfDay } from "../worktime/model";
import { worktime } from "../worktime/service";
import { LONG_PRESS_MS, pressCommand, type WorktimeSettings, worktimeOptions } from "./worktime";

/** A dial showing the worktime on the touch strip; push or tap cycles, hold resets. */
@action({ UUID: `${PLUGIN_ID}.dial-worktime` })
export class DialWorktimeAction extends SingletonAction<WorktimeSettings> {
  readonly #settings = new Map<string, WorktimeSettings>();
  readonly #pressedAt = new Map<string, number>();

  override onWillAppear(ev: WillAppearEvent<WorktimeSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<WorktimeSettings>): void {
    this.#settings.delete(ev.action.id);
    this.#pressedAt.delete(ev.action.id);
    updates.forget(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<WorktimeSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onDialDown(ev: DialDownEvent<WorktimeSettings>): void {
    this.#pressedAt.set(ev.action.id, Date.now());
  }

  override onDialUp(ev: DialUpEvent<WorktimeSettings>): Promise<void> {
    const pressedAt = this.#pressedAt.get(ev.action.id);
    this.#pressedAt.delete(ev.action.id);
    return this.#send(ev.action, pressCommand(pressedAt === undefined ? 0 : Date.now() - pressedAt));
  }

  override onTouchTap(ev: TouchTapEvent<WorktimeSettings>): Promise<void> {
    return this.#send(ev.action, pressCommand(ev.payload.hold ? LONG_PRESS_MS : 0));
  }

  async refresh(): Promise<void> {
    for (const id of this.#settings.keys()) {
      await this.#render(id);
    }
  }

  async #send(dial: DialAction<WorktimeSettings>, command: Command): Promise<void> {
    if (!(await worktime.send(command))) {
      await dial.showAlert();
    }
  }

  async #render(actionId: string): Promise<void> {
    const dial = this.actions.find((a) => a.id === actionId);
    const settings = this.#settings.get(actionId);
    if (!dial?.isDial() || !settings) {
      return;
    }

    let canvas: string;
    if (worktime.state === "unconfigured") {
      canvas = dialMessage("Set up", "open the dial settings");
    } else if (!worktime.isConnected) {
      canvas = dialMessage("Offline", worktime.state === "error" ? "check settings" : "connecting…");
    } else if (worktime.worktime === undefined) {
      canvas = dialMessage("Waiting", "for the panel");
    } else {
      const options = worktimeOptions(settings);
      canvas = dialCanvas({ worktime: computeWorktime(worktime.worktime, minuteOfDay(), options), ...options });
    }
    updates.update(dial.id, canvas, (value) => dial.setFeedback({ canvas: value }));
  }
}
