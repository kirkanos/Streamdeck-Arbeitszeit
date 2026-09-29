# Worktime

Your working time from the [AWTRIX Arbeitszeit app](https://github.com/kirkanos/awtrix-ng-scripts/tree/main/arbeitszeit) on your Elgato Stream Deck: net time, progress to the target, overtime, and clock in / pause / resume from a key.

## Features

* **Worktime** key:
  * The net working time as `H:MM`, with the same break rules as the panel: 30 minutes are deducted from 6 hours gross, 45 minutes from 8 hours.
  * A progress bar that fills up to the target hours; overtime is appended as orange segments up to the maximum hours, with a mark at the target.
  * Green while under the target, orange in overtime, red once the maximum is reached. A pause indicator and a "paused" caption while clocked out.
  * Before 8:00 without a clock-in the key is dimmed (the panel hides the app then); from 8:00 it shows `0:00` as a reminder, like the panel.
  * The caption under the time (time to go, overtime, state) is left out if you set your own title.
  * Pressing the key cycles clock in → pause → resume, exactly like the select button on the panel. Holding it for a moment ends the day (reset).
* **Dial Worktime** (Stream Deck + / + XL): the touch strip shows time, caption and bar; push or tap the dial to clock in / pause / resume, hold to end the day.
* Live updates over MQTT from the panel; the plugin recomputes the time every 30 seconds in between, so the key stays live even when the panel only publishes once a minute. The panel remains the source of truth, its select button keeps working.
* Fallback without MQTT: the plugin polls the app setting `start` through the AWTRIX settings API and writes it when you clock in, resume or reset.

## Installation

Download the [latest release](https://github.com/kirkanos/Streamdeck-Arbeitszeit/releases/latest) and open `com.kirkanos.arbeitszeit.streamDeckPlugin`. Requires Stream Deck 7.1 or newer.

Then add a Worktime key, open its settings and enter the MQTT broker URL (and username / password, if the broker needs them). The same connection is used by all keys and dials.

## Settings

Connection (shared by all keys and dials, stored in the plugin's global settings):

| Setting | Meaning | Default |
| --- | --- | --- |
| Source | MQTT (recommended) or the AWTRIX settings API fallback | MQTT |
| Broker URL | `mqtt://`, `mqtts://`, `ws://` or `wss://` URL of the broker | |
| Username, Password | Broker credentials, if any | |
| Topic | Base topic; the panel publishes `<topic>/state` and listens on `<topic>/cmd` | `awtrix/arbeitszeit` |
| AWTRIX URL | Fallback only: the panel, e.g. `http://awtrixng-xxxxxx.local` | |
| App name | Fallback only: name of the script app on the panel | `arbeitszeit` |

Per key or dial:

| Setting | Meaning | Default |
| --- | --- | --- |
| Target hours | The bar fills up to here in green; beyond it the time counts as overtime | `8` |
| Maximum hours | The bar ends here; the key turns red once the net time reaches it | `10` |

The break rules are fixed, as in the Berry app.

## Prerequisites

* The AWTRIX panel runs the `arbeitszeit` Berry app with the MQTT extension described in [docs/awtrix-mqtt.md](docs/awtrix-mqtt.md): it publishes its state as JSON on `awtrix/arbeitszeit/state` and applies the commands `clock_in`, `pause`, `resume` and `reset` from `awtrix/arbeitszeit/cmd`.
* An MQTT broker that both the panel and the computer with the Stream Deck app can reach (for Mosquitto: port 1883, or a WebSocket listener on 9001; see the same page).
* Without MQTT, the fallback needs the panel's HTTP API reachable from the computer. It assumes `GET /api/v1/apps/<app>/config` returns the app settings including `start` (`"HH:MM"`, empty while not clocked in) and `PATCH /api/v1/apps/<app>/config` with `{ "start": "HH:MM" }` sets it. The panel has no pause state in its settings, so a pause is kept in the plugin only: the panel keeps counting until you resume, then the start time is moved by the pause length, exactly like the panel's own button does.

## Development

Worktime is a Node.js plugin built with the official [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/) (`@elgato/streamdeck`, TypeScript, rollup) and [mqtt.js](https://github.com/mqttjs/MQTT.js). The settings pages use [sdpi-components](https://sdpi-components.dev).

| Path | Content |
| --- | --- |
| `src/actions/` | One class per Stream Deck action (key and dial) |
| `src/worktime/` | Worktime model (break rules, state, commands), connection service, MQTT and AWTRIX backends |
| `src/render/` | SVG images for keys and touch strips |
| `plugin/` | Static plugin files: manifest, icons, settings pages (`ui/`), dial layout |
| `assets/` | Plugin icon source (rendered to PNG by the build) |
| `docs/` | The proposed Berry changes for the panel |
| `scripts/` | Build |

```sh
npm install
npm test               # unit tests (break rules, state parsing, commands, rendering)
npm run typecheck

# Development: a parallel-installable copy "Worktime (dev)"
npm run link:dev       # build + link into Stream Deck (once)
npm run watch:dev      # rebuild and restart the plugin on every change

npm run validate       # build + streamdeck validate
npm run pack           # Release/com.kirkanos.arbeitszeit.streamDeckPlugin
```

Linking and restarting need the Stream Deck developer mode (`npx streamdeck dev`, then restart the Stream Deck app once). Plugin logs are written to `dist/<plugin id>.sdPlugin/logs/`.

GitHub Actions builds and tests every push (`.github/workflows/ci.yml`) and publishes a release with the packed plugin for tags like `v1.0.0` (`.github/workflows/release.yml`).

## Troubleshooting

* **Keys show "Set up":** open a key's settings and enter the broker URL (or the AWTRIX URL for the fallback).
* **Keys show "Offline":** the broker (or panel) is not reachable from this computer, or the credentials are wrong; the settings page shows the error.
* **Keys show "Waiting":** connected, but the panel has not published a state yet. Check that the Berry app has the MQTT extension and that the panel has a broker configured; the plugin asks for the state on connect and the app publishes once a minute.
