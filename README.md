# Three Floorplan Card

A Home Assistant Lovelace custom card for rendering a building floorplan as an interactive Three.js model. The renderer remains host-independent; a small Home Assistant adapter supplies entity states and actions, while the standalone mock app remains available for development.

## Development

```sh
npm ci
npm run dev
```

The standalone preview loads its floorplan, mock states, effects, and visual defaults from `public/`. Select a different floorplan with `?floorplan=filename.json`.

## Build

```sh
npm test
npm run build
```

`npm run build` type-checks the source and writes the HACS dashboard bundle to `dist/ha_3d_floormap.js`. The bundle includes Three.js and the card styles. `npm run build:standalone` builds the standalone preview to `dist-standalone/`, leaving the HACS bundle intact.

The HACS bundle must be included in the repository/release. Its name currently matches this repository (`ha_3d_floormap`), as required for HACS dashboard repositories. If the GitHub repository is renamed, update `vite.card.config.ts`, `hacs.json`, and the resource URL below to match.

## Install through HACS

1. In HACS, add this public GitHub repository as a custom repository with the **Dashboard** category.
2. Download the repository, then add the card resource in **Settings → Dashboards → Resources** if HACS did not add it automatically:
   - URL: `/hacsfiles/ha_3d_floormap/ha_3d_floormap.js`
   - Resource type: **JavaScript module**
3. Put the floorplan JSON under Home Assistant's `/config/www/` directory. For example, `/config/www/floorplans/home.json` is served as `/local/floorplans/home.json`.
4. Add the card to a dashboard in YAML mode.

## Card configuration

The Lovelace card editor lets you enter the floorplan URL and assign Home Assistant entities to its `entityPlacements`. Placement IDs are kept as binding keys; new placements appear unassigned, and saved bindings for removed placements are preserved and flagged for review.

```yaml
type: custom:three-floorplan-card
floorplan:
  source: /local/floorplans/home.json

height: 900 # optional display height in pixels; defaults to 480

bindings_file: /local/floorplans/home.bindings.json # optional shared bindings, alerts and room_status
rooms: [living, dining] # optional; show only these room IDs (site areas, stairs and objects are hidden)

objects: # optional defaults for how objects are drawn
  display: shown # shown, transparent, hidden, active or active-else-transparent
  furniture: transparent # per category: appliance / furniture; wins over display, an object's own display wins over both

toolbar:
  position: left # or right, top, or bottom

camera:
  allow_rotation: true
  allow_zoom: true
  allow_pan: false

camera_views:
  - id: kitchen-entry
    name: Kitchen from entry
    position: [2, 5, -3] # [floorplan x, height, floorplan y]
    target: [8, 0, 4]

appearance:
  style: standard # standard, comic, or futuristic
  line_thickness: 3 # outline width in pixels for comic/futuristic styles
  shadows: true
  ambient_intensity: 0.5
  sunlight_intensity: 0.9
  max_pixel_ratio: 2

bindings:
  dining-ceiling-light:
    entity: light.dining_room
    tap_action: toggle
    hold_action: more-info

  bedroom-door-contact:
    entity: binary_sensor.bedroom_door
    tap_action: more-info

  living-motion-sensor:
    entity: binary_sensor.living_room_motion
    kind: motion-sensor

  living-environment-sensor:
    entity: sensor.living_environment

  kitchen-blind:
    entity: cover.kitchen_blind

  kitchen-water-leak:
    entity: binary_sensor.kitchen_water_leak
    kind: water-leak

celestial:
  sun:
    entity: sun.sun
    position: [18, 0]
    radius: 2.5
  # Optional: use an entity that exposes numeric azimuth and elevation attributes.
  # moon:
  #   entity: sensor.moon_position
  #   position: [20, 0]
  #   radius: 2.5

alerts:
  - entity: binary_sensor.front_door_security_alert
    state: "on"
    effects:
      - target: front-hall
        effect: flash
        color: "#ff2020"
        priority: 10
      - target: front-hall
        effect: camera-focus
      - target: kitchen-entry
        effect: camera-focus # target a saved camera view by its ID
```

`floorplan.source` accepts a URL to a floorplan JSON document. The file must use a supported `2.x` schema and contain rooms with layouts and connectors. Physical building measurements in `buildingDefaults` take precedence over card appearance defaults.

Set `height` to change the display area height in pixels (minimum 240; default 480). Select a room from the toolbar or tap its floor in the overview to transition to a top-down room focus; use the room and saved-view picker to move between destinations or the home icon to return to the overview. Define optional named viewpoints in `camera_views`: each requires a unique `id`, display `name`, camera `position`, and `target`. Coordinates are `[floorplan x, height, floorplan y]` in the same units as the floorplan; the camera position is where the viewer looks from and target is the point it looks at. To capture coordinates for a new saved view, focus the 3D floorplan and press **C**, or select the crosshair toolbar button. The live readout shows the current camera `position` and `target`; copy those two lines into a `camera_views` entry. Press **C** again or **Escape** to hide the readout. Saved views appear in their own group in the toolbar selector. The vertically stacked, icon-based entity filters can be positioned on either side with `toolbar.position`; use `top` or `bottom` for a horizontal toolbar. Tap a filter to show or hide that type, or press and hold to isolate it; the all-types icon restores every type. Doors remain visible as part of the floorplan architecture and are not a filter. These filters only affect the visualization. For development, set `debug: true` to add a flask button to the toolbar: it cycles through all-active, all-inactive and live states for every bound entity (lights, locks, doors, covers, leak, motion, presence and environment sensors). It only changes the 3D display and never calls Home Assistant services; a second list button opens an entity tester that lists every placement in the floorplan, bound or not (unbound ones get temporary `debug.<id>` entities), with toggles for lights, doors, windows, locks and sensors and sliders for covers and environment values, driving the visuals as live states would. Panels (tester, camera coordinates, ignored elements) have a close button. Leave `debug` off in production.

An alert's `camera-focus` effect can target either a room ID (existing behavior) or a saved camera view ID. This lets an event both highlight a room and move the camera to a useful named angle. Camera view IDs must not duplicate floorplan room IDs.

The wall cutaway button fades exterior walls facing the viewer to 30% opacity, keeps exterior walls on the opposite side opaque, and fades shared walls between rooms so you can see through the interior. Long wall runs are split wherever room adjacency changes, and the rule updates as you rotate the view. The cutaway can be toggled off at any time.

Set `appearance.style` to `standard` (default), `comic`, or `futuristic` to change the scene's visual theme. Comic uses brighter, flatter room colors and dark architectural outlines; futuristic uses dark surfaces and cyan edges. Set `appearance.line_thickness` to change outline width in pixels (default `3`, minimum `1`); it can also be adjusted in the visual card editor. Entity-state colors and interaction behavior are unchanged.

Use the optional top-level `room_status` list to tint rooms from Home Assistant entities. Match `room` to a room ID in the floorplan JSON and set either a `states` map for discrete states (occupancy, alerts, and similar) or `ranges` for numeric readings such as temperature. Colors must be `#RRGGBB`. If an entity value is unknown, unavailable, or not mapped, its room returns to its normal floor color.

```yaml
room_status:
  - room: living-room # floorplan room ID
    entity: binary_sensor.living_room_occupied
    states:
      "on": "#39a96b"
      "off": "#687782"

  - room: bedroom
    entity: sensor.bedroom_temperature
    # Omit attribute to use the entity's main state.
    ranges:
      - max: 18
        color: "#4488ff"
      - max: 24
        color: "#44bb66"
      # The final range can omit max to act as the fallback.
      - color: "#ff5533"
```

For a numeric entity attribute, set `attribute` to its exact attribute name (for example, `attribute: temperature`). Ranges are checked in order; `max` is inclusive, and the first matching range supplies the room tint. A final range without `max` is an optional fallback. Configure at most one `room_status` rule per room. The translucent tint preserves the room's floor appearance and works in all three visual styles; it can be combined with the existing alert effects.

Optional top-level `areas` render outdoor site features as flat, unlabeled shapes; rectangles and ellipses are supported. `kind` controls the illustrative color (`garden`, `deck`, `driveway`, or `pond`), while `roofed: true` subtly darkens the color. A site-areas button appears when areas are present: it toggles their rendering and fits the overview to either the building or the complete site. Room focus remains active while changing this setting; returning to the overview uses the selected view.

```json
"areas": [
  {
    "id": "back-garden",
    "name": "Garden",
    "kind": "garden",
    "shape": "rect",
    "layout": { "x": -5, "y": -4, "width": 12, "height": 8 }
  },
  {
    "id": "pond",
    "name": "Pond",
    "kind": "pond",
    "shape": "ellipse",
    "layout": { "x": 9, "y": 3, "width": 4, "height": 2 }
  }
]
```

The scene includes a dark-green ground rectangle with a border around the building by default. Optionally define a custom ground outline in floorplan coordinates:

```json
"ground": {
  "polygon": [[-2, -2], [24, -2], [24, 11], [-2, 11]],
  "color": "#193d2d"
}
```

The polygon must contain at least three finite `[x, y]` points. Its border is drawn automatically.

Add `entityPlacements` to the floorplan JSON to define stable placement IDs independently from installation-specific HA entity IDs. Set top-level `entitySettings.coordinates` to `"room"` to interpret a room placement's `[x, y]` position relative to its room's top-left `[x, y]` layout origin, or an area placement relative to its area's top-left layout origin; set it to `"floorplan"` for absolute floorplan coordinates. If omitted, `"floorplan"` is assumed for backward compatibility. Relative positions are converted to floorplan coordinates when the JSON loads. Light, water-leak, and environmental-sensor placements use either `roomId` or `areaId`, a position, and optional height; motion and presence sensor placements also accept either location. Area placements must lie within the referenced area's bounds (including the ellipse for elliptical areas). Door-contact and cover placements reference a door or window connector ID. Water-leak placements use `"type": "water-leak"` and bind to a Home Assistant `binary_sensor` with `kind: water-leak`; their marker turns red when the sensor is on. For a single Home Assistant sensor that exposes multiple readings as attributes, add a `measures` array to its environmental placement. Each measure has a display `name` and exact entity-attribute key, with optional `unit` and `precision` (0–4); use `"attribute": "state"` to display the entity's main state. If no unit is configured, the card checks `unit_of_measurement` for `state` or `<attribute>_unit` for other attributes. Missing attribute values display as `—`. Without `measures`, the card displays the entity state and `unit_of_measurement` as before. `display: value` and `display: label-value` remain available for single-value sensor bindings. Motion and presence sensor placements use a position plus `facingDegrees`, `fieldOfViewDegrees` (full cone angle), and `range`. For every bearing, top is 0°, right is 90°, bottom is 180°, and left is 270°. Heights, coordinates, and ranges use floorplan units. Sensor coverage is always drawn faintly and becomes brighter while its bound entity is `on`; it is clipped by floorplan walls, including doors regardless of contact state or animation. An optional `detectionPositionAttribute` names a HA entity attribute containing `[x, y]` or `{x, y}` coordinates; only valid reported positions are shown as markers.

Use each placement ID as the key under `bindings`, then set its HA `entity`. `kind` is inferred as `light` for `light.*` and `switch.*`, `cover` for `cover.*`, `environment-sensor` for `sensor.*`, and `door-contact` otherwise; set it explicitly to `motion-sensor` or `presence-sensor` for those placements. The existing `target` option remains supported for floorplans without placements. Placement, binding, and alert references are checked against the loaded floorplan and show an error if unresolved.

For celestial artwork, set the floorplan's `northDegrees` to the compass bearing of the floorplan's top edge (clockwise from true north; `0` means top is north). Configure `celestial.sun` and optionally `celestial.moon`; each body has an entity, an optional floorplan `[x, y]` anchor, and an optional marker radius. If the anchor is omitted in YAML, it is read from the floorplan JSON under `celestial.sun.position` or `celestial.moon.position`; a position supplied in YAML takes precedence over the JSON value. The sun entity defaults to `sun.sun`. Both configured entities must expose numeric `azimuth` and `elevation` attributes; Home Assistant's built-in `sun.sun` does, while moon-position attributes may require an integration that provides them. The compass sits on the floor and the marker moves around an illustrative sphere. When sun position is available, it also sets the scene's directional light and shadow direction; sunlight is disabled below the horizon. The moon is visual only. The card does not calculate celestial positions or model a ceiling.

The included `reference-home.json` defines light, door-contact, motion-sensor, and multi-measure environmental-sensor placements; bind only the placements that have real entities in your Home Assistant instance.

For example, map the measurements exposed by one entity to the attributes supplied by your integration:

```json
{
  "id": "living-environment-sensor",
  "type": "environment-sensor",
  "roomId": "living",
  "position": [3.3, 0.5],
  "height": 1.5,
  "measures": [
    { "name": "Temperature", "attribute": "temperature", "unit": "°C", "precision": 1 },
    { "name": "Humidity", "attribute": "humidity", "unit": "%", "precision": 0 },
    { "name": "CO₂", "attribute": "carbon_dioxide", "unit": "ppm", "precision": 0 },
    { "name": "Illuminance", "attribute": "illuminance", "unit": "lx", "precision": 0 },
    { "name": "Pressure", "attribute": "pressure", "unit": "hPa", "precision": 0 },
    { "name": "VOC", "attribute": "voc", "unit": "ppb", "precision": 0 }
  ]
}
```

Bind that placement once to the entity containing those attributes:

```yaml
bindings:
  living-environment-sensor:
    entity: sensor.living_environment
```

Opening contacts interpret `on`/`open` as open and `off`/`closed` as closed. Hinged doors remain visible while closed and animate between positions over 400 ms. The opening angle, hinge, and swing direction are read from the floorplan connector's `door` settings when present. For paired connectors, settings on `connectorA` take precedence if both sides define them; settings on the other side are used when `connectorA` has none. If neither side has door settings, the renderer uses a left hinge, an 82-degree opening, and its default swing direction.

Door connectors support `door.style: "pocket-sliding"` (retracts into the wall, with `visibleFraction` defaulting to 0.15), `"sliding-glass"` (one half-width glazed leaf slides over the fixed half), and `"double"` (two hinged leaves without a center bar); `slideDirection` selects `start` or `end` along the floorplan axis. For a sliding-glass leaf initially on the positive axis half, `start` slides it over the other half. Window connectors support `window.type: "tilt"` for an inward-tilting sash on its bottom hinge (`openAngle` defaults to 12 degrees), or `"sliding"` for two overlapping panes. Set `sillHeight: 0` and the desired `headHeight` for a full-height opening. Fixed windows remain the default. Bind a `binary_sensor` to the connector with `kind: door-contact` and `target` to animate an opening; `on`/`open` animates open and `off`/`closed` animates shut. Bind a `cover.*` entity using a `cover` placement (or `kind: cover` and `target`) to show and animate a roller blind using `current_position` (0 closed/down, 100 open/up).

The standalone preview includes a multi-measure environmental sensor with sliders for changing its readings, a tilting kitchen window, a sliding-glass patio door, and a simulated cover control. Run `npm run dev` and adjust those controls to compare the visuals before binding real entities.

Bind a `binary_sensor` to either kind of opening using its connector ID; paired openings accept either connector ID:

```yaml
bindings:
  patio-slider:
    entity: binary_sensor.patio_door
    kind: door-contact
    target: patio-sliding-door
```

Supported actions are `toggle`, `more-info`, and `none`. Light bindings default to tap `toggle` and hold `more-info`; door contacts default to `more-info` for both. Toggle supports `light`, `switch`, and `input_boolean` entities. For a virtual light helper, bind an `input_boolean` with `kind: light`; for a virtual door contact, bind it with `kind: door-contact`. Alerts are display rules only: define security/alarm conditions in Home Assistant and bind the resulting alert entity here.

Supported alert effects are `flash`, `pulse`, `highlight`, `room-wash`, and `camera-focus`. Effects target room IDs; `color` (or `colour`) and `priority` are optional. Reduced-motion preferences disable rapid animation.

### Window sensors

Door and window contacts bind to a connector. For a `tilt-turn` window use two bindings on the same window (two `window-contact` placements): the default one (or `mode: open`) drives the turn, and `mode: tilt` drives the tilt. While the window is turned open the tilt is ignored. A `hinged` window and a `tilt` window need one sensor.

### Global bindings file

Move the `bindings:`, `alerts:` and `room_status:` blocks, unchanged, into a JSON file (`{ "bindings": {...}, "alerts": [...], "room_status": [...] }`) and point `bindings_file` at it. Every card using that floorplan, including cards limited with `rooms`, then shares the same entity assignments. Card entries override file entries (bindings by placement ID, alerts by entity, room status by room). A missing or invalid file logs a console warning and the card carries on with its own configuration.

Planned: a Home Assistant websocket command (and later an integration) to edit this file from the UI; see the TODO in `CHANGELOG.md`.

## Scope and limitations

- The card supports hinged, pocket-sliding, sliding-glass, and double doors; fixed, tilt, and sliding windows; contact-driven openings and cover-position roller blinds; environmental sensor value badges; light state display; presence/motion sensor coverage and optional reported-position markers; optional sun/moon compass artwork and sun-driven scene lighting; configured light/switch/input_boolean toggles; more-info; and entity-driven alert effects.
- A YAML configuration editor, automated browser testing, and HACS release validation are not yet included.
- The initial supported floorplan schema is `2.x`; malformed configurations and failed floorplan requests are shown in the card rather than leaving a blank canvas.
- Home Assistant automations remain responsible for deciding whether events constitute warnings or alarms.
