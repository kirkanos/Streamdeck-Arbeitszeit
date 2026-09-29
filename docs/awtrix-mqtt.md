# AWTRIX: MQTT state and commands for the Arbeitszeit app

The Stream Deck plugin mirrors the Berry app `arbeitszeit.ax` from
[awtrix-ng-scripts](https://github.com/kirkanos/awtrix-ng-scripts). The panel stays the source
of truth; the plugin only needs two MQTT topics from the app. This page proposes the Berry
changes (milestone M0 of the plan, to be committed in `awtrix-ng-scripts`).

Prerequisites on the panel: an MQTT broker configured in the AWTRIX settings (the Berry
`mqtt.publish` / `mqtt.subscribe` calls are silent no-ops without one).

## Topics

Base topic `awtrix/arbeitszeit` (a `# @config topic` setting, so it can be changed per panel).

### `awtrix/arbeitszeit/state` — published by the panel

```json
{ "start_min": 452, "paused": false, "pause_min": 0, "net_min": 123 }
```

| Field | Meaning |
| --- | --- |
| `start_min` | Clock-in time as minute of the day (`07:32` → `452`), `null` while not clocked in. Pauses that already ended are folded into it, exactly like the app moves `start` on resume. |
| `paused` | `true` while the time is frozen (select button pressed while running). |
| `pause_min` | Minute of the day the current pause began (the app's `paused_at`); `0` when not paused. |
| `net_min` | Net minutes the app currently shows (after the break deduction); informational. |

Published on every change (clock in, pause, resume, reset, midnight reset), once per minute
while the app runs, and as an answer to the `state` command. The plugin computes the display
from `start_min`, `paused` and `pause_min` with the same break rules as the app (30 min from 6 h
gross, 45 min from 8 h gross), so it stays live between messages.

Retained messages: the plugin asks for the state right after connecting (see `state` below), so
it works without a retained message. If the firmware's `mqtt.publish` accepts a retain flag
(`mqtt.publish(topic, payload, true)`), publish the state retained so a reconnecting plugin sees
it immediately without a round trip.

### `awtrix/arbeitszeit/cmd` — subscribed by the panel

Plain string payloads, applied exactly like the select button:

| Command | Effect |
| --- | --- |
| `clock_in` | Sets the start time to now (only while not clocked in). |
| `pause` | Freezes the time (only while running). |
| `resume` | Moves the start time by the pause length and continues (only while paused). |
| `reset` | Ends the day: clears `start`, like the midnight reset. |
| `state` | Publishes the current state (no change). |

Unknown or unfitting commands are ignored.

## Berry changes

Diff against the current `arbeitszeit.ax`. The button handling is split into `pause()` and
`resume()` so the button and the MQTT commands share one code path.

```diff
 # @config    ueber_max  number "Ueberstunden-Skala"      default=2 min=1 max=6 unit=h help="Wie viele Ueberstunden der Balken zusaetzlich fasst"
 # @config    max        number "Maximale Arbeitszeit"    default=10 min=1 max=14 unit=h help="Ab hier ertoent die Fanfare"
+# @config    topic      text   "MQTT-Topic"              default="awtrix/arbeitszeit" help="Status auf <topic>/state, Befehle auf <topic>/cmd"

 import string

 class Arbeitszeit
   var start_min, soll_min, total_min, max_min, configured
   var farbe, ueberzeit, icon_unter, icon_ueber, track
   var netto, over_min, fanfare_done, last_reset_day, stopped, paused_at
   var h_str, mm_str, text_x, colon_x, mm_x
+  var topic, last_pub_min

   def init()
     self.farbe = store.get("farbe")
@@
     self.h_str = nil
     self.mm_str = nil
+    self.topic = store.get("topic")
+    self.last_pub_min = -1

     var m = re.search("(\\d+):(\\d+)", store.get("start"))
     if m == nil return end
     self.start_min = self.parse_int(m[1]) * 60 + self.parse_int(m[2])
     self.configured = true
   end

+  def setup()
+    mqtt.subscribe(self.topic + "/cmd", / t, p -> self.on_cmd(t, p))
+  end
+
   # num() liest "09" als Oktalzahl und scheitert - deshalb Ziffern selbst umwandeln
   def parse_int(s)
@@
   def loop()
     if hour() < 0
       return
     end
     if self.configured && hour() == 0 && minute() == 0 && self.last_reset_day != day()
       self.last_reset_day = day()
-      store.set("start", "")
-      self.configured = false
-      self.netto = nil
-      self.h_str = nil
-      self.mm_str = nil
-      self.fanfare_done = false
-      self.stopped = false
-      self.paused_at = nil
+      self.reset()
       return
     end
     if !self.configured
       # Ab 8 Uhr als Erinnerung mit 0:00 zeigen, bis per Knopf oder Einstellung
       # ein Arbeitsbeginn gesetzt wird.
       self.netto = 0
       self.over_min = 0
       self.set_time_strings("0", "00")
+      self.publish_minutely()
       return
     end
     if self.stopped
+      self.publish_minutely()
       return                          # eingefroren, bis Mitternachts-Reset oder erneutes Einstempeln
     end
@@
     var mn = self.netto % 60
     self.set_time_strings(str(self.netto / 60), mn < 10 ? "0" + str(mn) : str(mn))
+    self.publish_minutely()
   end
@@
   def on_button(btn)
     if btn == "select"
       if !self.configured
         self.clock_in()
       elif !self.stopped
-        self.stopped = true
-        self.paused_at = hour() * 60 + minute()      # ausstempeln: Zeit einfrieren
+        self.pause()
       else
-        var pause_len = hour() * 60 + minute() - self.paused_at
-        if pause_len < 0
-          pause_len = 0
-        end
-        self.start_min += pause_len                  # Pause herausrechnen statt neu einzustempeln
-        self.save_start()
-        self.stopped = false
+        self.resume()
       end
     end
   end

+  # Befehle vom Stream Deck (oder jedem anderen MQTT-Client), wie der select-Knopf
+  def on_cmd(topic, payload)
+    if payload == "clock_in"
+      if !self.configured self.clock_in() end
+    elif payload == "pause"
+      if self.configured && !self.stopped self.pause() end
+    elif payload == "resume"
+      if self.configured && self.stopped self.resume() end
+    elif payload == "reset"
+      if self.configured self.reset() end
+    elif payload == "state"
+      self.publish_state()
+    end
+  end
+
   def clock_in()
     self.start_min = hour() * 60 + minute()
     self.save_start()
     self.configured = true
     self.stopped = false
     self.fanfare_done = false
+    self.publish_state()
   end

+  def pause()
+    self.stopped = true
+    self.paused_at = hour() * 60 + minute()      # ausstempeln: Zeit einfrieren
+    self.publish_state()
+  end
+
+  def resume()
+    var pause_len = hour() * 60 + minute() - self.paused_at
+    if pause_len < 0
+      pause_len = 0
+    end
+    self.start_min += pause_len                  # Pause herausrechnen statt neu einzustempeln
+    self.save_start()
+    self.stopped = false
+    self.paused_at = nil
+    self.publish_state()
+  end
+
+  # Arbeitstag beenden (Mitternacht oder Befehl): Arbeitsbeginn leeren
+  def reset()
+    store.set("start", "")
+    self.configured = false
+    self.netto = nil
+    self.h_str = nil
+    self.mm_str = nil
+    self.fanfare_done = false
+    self.stopped = false
+    self.paused_at = nil
+    self.publish_state()
+  end
+
+  # Zustand als JSON auf <topic>/state; kein json.dump, der String ist klein und fest
+  def publish_state()
+    var s = self.configured ? str(self.start_min) : "null"
+    var p = (self.configured && self.stopped) ? "true" : "false"
+    var pm = (self.configured && self.stopped && self.paused_at != nil) ? str(self.paused_at) : "0"
+    var n = self.netto != nil ? str(self.netto) : "0"
+    mqtt.publish(self.topic + "/state",
+      "{\"start_min\":" + s + ",\"paused\":" + p + ",\"pause_min\":" + pm + ",\"net_min\":" + n + "}")
+    self.last_pub_min = minute()
+  end
+
+  # Einmal pro Minute, damit ein neu verbundener Client den Zustand ohne Anfrage bekommt
+  def publish_minutely()
+    if minute() != self.last_pub_min
+      self.publish_state()
+    end
+  end
+
   # start_min als "SS:MM" zurueck in die Einstellungen schreiben
   def save_start()
```

Notes:

- `setup()` runs once after the app loads (and again after every settings save, which restarts
  the app); re-subscribing replaces the callback, so this is safe.
- `store.set("start", ...)` in `clock_in()`, `resume()` and `reset()` keeps the settings page in
  sync, as before. The plugin's settings-API fallback relies on exactly this value.
- `publish_state()` builds the JSON by hand; the payload is under 80 bytes and needs no
  `json.dump` import.
- The midnight reset now goes through `reset()` and therefore publishes `start_min: null`, so
  the Stream Deck key returns to its idle state at 0:00 as well.

## Broker reachability

The plugin runs on the computer with the Stream Deck app. The broker must accept a connection
from there: expose the MQTT port (1883, or 8883 with TLS) or add a WebSocket listener (e.g.
9001) and use `ws://broker:9001` in the plugin settings. For Mosquitto:

```
listener 1883
listener 9001
protocol websockets
```

## Verifying

```sh
mosquitto_sub -h broker -t 'awtrix/arbeitszeit/state' -v
mosquitto_pub -h broker -t 'awtrix/arbeitszeit/cmd' -m state
mosquitto_pub -h broker -t 'awtrix/arbeitszeit/cmd' -m clock_in
```

The first command should print a state line within a minute (immediately after the `state`
command), the last one should make the panel start counting.
