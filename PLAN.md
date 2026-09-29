# Streamdeck-Arbeitszeit

Stream Deck plugin `com.kirkanos.arbeitszeit`. Status: plan only, no code yet.

## Goal

Mirror of the Berry app `../awtrix-ng-scripts/arbeitszeit` on the deck: net working time, progress bar to the target, overtime, clock in and out from a key. The AWTRIX panel stays the source of truth.

## Keys & dials

- **Worktime** key: `H:MM`, progress bar up to the target hours, then overtime segments, color under target vs. overtime, pause indicator. Press cycles clock in, pause, resume (same as the select button on the panel). Long press ends the day (reset). Hidden state before 8:00 without a start time, like the Berry app.
- **Dial**: touch strip with time and bar, push cycles clock in / pause / resume.

## Data source & API

- The Berry app is extended to publish its state over MQTT to Mosquitto (already in the Grafana stack):
  - `awtrix/arbeitszeit/state` (retained): `{ "start_min": 452, "paused": false, "pause_min": 0, "net_min": 123 }`, published on every change and once per minute.
  - `awtrix/arbeitszeit/cmd`: `clock_in`, `pause`, `resume`, `reset`; the app subscribes and applies them exactly like the select button.
- The plugin uses `mqtt` (mqtt.js) over TCP or WebSocket, computes the display from `start_min` and `pause_min` itself (break rules: 30 min from 6 h, 45 min from 8 h) and re-renders every 30 s.
- Fallback without MQTT: read and write the app setting `start` via the AWTRIX settings API and poll.

## Settings

- MQTT URL, username, password.
- Target hours (default 8), maximum hours (default 10), break rules as in the Berry app.

## Open questions

- Whether the AWTRIX NG Berry runtime exposes `mqtt.publish` and `mqtt.subscribe` in the installed firmware. If not, use the settings-API fallback and polling.
- Mosquitto reachability from the Mac: expose port 1883 from the Grafana stack or add a WebSocket listener on 9001.
- Whether to keep the panel's select button as a second control (yes by default, the state topic keeps both in sync).

## Milestones

- M0: extend the Berry app with MQTT state and command topics (commit in `awtrix-ng-scripts`).
- M1: Worktime key read-only from MQTT, tests for the net-time calculation.
- M2: clock in / pause / resume / reset commands.
- M3: dial and touch strip.
- M4: CI workflows, release `v1.0.0`.

## Scaffold

Copy the tooling from [Kuma Glance](https://github.com/kirkanos/kuma-glance) (`../Streamdeck-Uptime-Kuma`), not from Termine:

- `@elgato/streamdeck` ^3, `@elgato/cli`, TypeScript, rollup via `scripts/build.mjs` and `createRollupConfig()` from its `rollup.config.mjs`; `tsconfig` extends `@tsconfig/node20`, `moduleResolution: Bundler`, `customConditions: ["node"]`.
- Manifest: SDKVersion 3, Nodejs 24, `Software.MinimumVersion` 7.1, version `0.0.0.0` (the build fills it in).
- Layout: `plugin/` (manifest, `ui/`, `layouts/`, icons), `src/plugin.ts`, `src/actions/`, `src/<service>/`, `src/render/` (reuse `svg.ts` and `theme.ts`).
- Dev variant `<uuid>-dev` via `--dev`, `npm run link:dev`, `npm run watch:dev`.
- Settings pages: static HTML with vendored sdpi-components 4.0.1 in `plugin/ui/`.
- CI: `.github/workflows/ci.yml` (typecheck, vitest, pack, artifact) and `release.yml` (tag `v*`, `PLUGIN_VERSION`, `gh release create`).
- Tests: vitest for model and render code, like `render.test.ts` in Kuma Glance.
- Secrets live in the action settings, never in global settings. Passwords are exchanged for a token once and not stored.
- No license for now.
