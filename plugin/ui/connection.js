/**
 * Shared "AWTRIX panel" connection section of the property inspectors.
 *
 * The plugin owns the connection: this page sends the connection settings once
 * ({ event: "connect" }) and shows the status the plugin reports back
 * ({ event: "status" }). The settings are stored in the plugin's global settings.
 */
(function () {
  const client = SDPIComponents.streamDeckClient;
  const $ = (id) => document.getElementById(id);

  const STATE_TEXT = {
    connected: "Connected",
    connecting: "Connecting…",
    error: "Connection problem",
    unconfigured: "Not set up",
  };

  function send(payload) {
    client.send("sendToPlugin", payload);
  }

  function showMessage(text, kind) {
    const box = $("panel-message");
    box.textContent = text || "";
    box.className = `message ${kind || ""}`;
    box.hidden = !text;
  }

  function showMode(mode) {
    $("panel-mqtt").hidden = mode !== "mqtt";
    $("panel-awtrix").hidden = mode !== "awtrix";
  }

  function renderStatus(status) {
    const badge = $("panel-status");
    badge.className = `status ${status.state}`;
    $("panel-status-text").textContent = STATE_TEXT[status.state] || status.state;
    const target = status.mode === "awtrix" ? status.awtrixUrl : status.url;
    let detail = status.error || target || "";
    if (!status.error && status.state === "connected") {
      detail = `${target} · ${status.hasState ? "panel state received" : "waiting for the panel"}`;
    }
    $("panel-status-detail").textContent = detail;

    $("panel-setup").hidden = status.configured;
    $("panel-disconnect").hidden = !status.configured;
    for (const el of document.querySelectorAll(".requires-connection")) {
      el.hidden = !status.configured;
    }

    // Prefill the form with the stored settings.
    if (!status.configured) {
      const mode = status.mode === "awtrix" ? "awtrix" : "mqtt";
      $("panel-mode").value = mode;
      showMode(mode);
      if (status.url && !$("panel-url").value) $("panel-url").value = status.url;
      if (status.username && !$("panel-username").value) $("panel-username").value = status.username;
      if (status.topic && !$("panel-topic").value) $("panel-topic").value = status.topic;
      if (status.awtrixUrl && !$("panel-awtrix-url").value) $("panel-awtrix-url").value = status.awtrixUrl;
      if (status.awtrixApp && !$("panel-awtrix-app").value) $("panel-awtrix-app").value = status.awtrixApp;
    }
  }

  client.sendToPropertyInspector.subscribe((message) => {
    const payload = message.payload || {};
    if (payload.event === "status") {
      renderStatus(payload);
    }
  });

  const TEMPLATE = `
    <sdpi-item label="AWTRIX panel">
      <div id="panel-status" class="status unconfigured">
        <div><strong id="panel-status-text">…</strong><span id="panel-status-detail"></span></div>
      </div>
    </sdpi-item>
    <div id="panel-message" class="message" hidden></div>
    <div id="panel-setup" hidden>
      <sdpi-item label="Source">
        <sdpi-select id="panel-mode">
          <option value="mqtt">MQTT (recommended)</option>
          <option value="awtrix">AWTRIX settings API</option>
        </sdpi-select>
      </sdpi-item>
      <div id="panel-mqtt">
        <sdpi-item label="Broker URL"><sdpi-textfield id="panel-url" placeholder="mqtt://broker.local:1883"></sdpi-textfield></sdpi-item>
        <sdpi-item label="Username"><sdpi-textfield id="panel-username" placeholder="optional"></sdpi-textfield></sdpi-item>
        <sdpi-item label="Password"><sdpi-password id="panel-password" placeholder="optional"></sdpi-password></sdpi-item>
        <sdpi-item label="Topic"><sdpi-textfield id="panel-topic" placeholder="awtrix/arbeitszeit"></sdpi-textfield></sdpi-item>
        <p class="hint">mqtt://, mqtts://, ws:// and wss:// URLs. The panel publishes on &lt;topic&gt;/state and listens on &lt;topic&gt;/cmd.</p>
      </div>
      <div id="panel-awtrix" hidden>
        <sdpi-item label="AWTRIX URL"><sdpi-textfield id="panel-awtrix-url" placeholder="http://awtrixng-xxxxxx.local"></sdpi-textfield></sdpi-item>
        <sdpi-item label="App name"><sdpi-textfield id="panel-awtrix-app" placeholder="arbeitszeit"></sdpi-textfield></sdpi-item>
        <p class="hint">Polls the app setting "start" every 30 seconds. Pauses are only kept in the plugin until you resume.</p>
      </div>
      <sdpi-item><sdpi-button id="panel-connect">Connect</sdpi-button></sdpi-item>
      <p class="hint">The connection settings are stored in the Stream Deck plugin settings on this computer.</p>
    </div>
    <div id="panel-disconnect" hidden>
      <sdpi-item><sdpi-button id="panel-disconnect-button">Change connection</sdpi-button></sdpi-item>
    </div>`;

  window.addEventListener("DOMContentLoaded", () => {
    $("panel-connection").innerHTML = TEMPLATE;

    $("panel-mode").addEventListener("valuechange", () => showMode($("panel-mode").value));

    $("panel-connect").addEventListener("click", () => {
      const mode = $("panel-mode").value === "awtrix" ? "awtrix" : "mqtt";
      const settings = {
        mode,
        url: ($("panel-url").value || "").trim(),
        username: ($("panel-username").value || "").trim(),
        password: $("panel-password").value || "",
        topic: ($("panel-topic").value || "").trim(),
        awtrixUrl: ($("panel-awtrix-url").value || "").trim(),
        awtrixApp: ($("panel-awtrix-app").value || "").trim(),
      };
      if (mode === "mqtt" && !settings.url) {
        showMessage("Please enter the broker URL", "error");
        return;
      }
      if (mode === "awtrix" && !settings.awtrixUrl) {
        showMessage("Please enter the AWTRIX URL", "error");
        return;
      }
      showMessage("", "");
      send({ event: "connect", settings });
    });

    $("panel-disconnect-button").addEventListener("click", () => {
      showMessage("", "");
      send({ event: "disconnect" });
    });

    send({ event: "getStatus" });
  });
})();
