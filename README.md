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

```yaml
type: custom:three-floorplan-card
floorplan:
  source: /local/floorplans/home.json

camera:
  allow_rotation: true
  allow_zoom: true
  allow_pan: false

appearance:
  shadows: true
  ambient_intensity: 0.5
  sunlight_intensity: 0.9
  max_pixel_ratio: 2

bindings:
  dining-light:
    entity: light.dining_room
    target: dining
    tap_action: toggle
    hold_action: more-info

  bedroom-door:
    entity: binary_sensor.bedroom_door
    kind: door-contact
    target: bedroom-front-left-door--main-bedroom-right-door
    tap_action: more-info

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
```

`floorplan.source` accepts a URL to a floorplan JSON document. The file must use a supported `2.x` schema and contain rooms with layouts and connectors. Physical building measurements in `buildingDefaults` take precedence over card appearance defaults.

Each binding key is the renderer reference. A light or switch `target` is the floorplan room ID where its visual marker is placed. A door-contact `target` is the connector ID, or the paired connector ID produced by joining both connector IDs with `--`. `kind` is inferred as `light` for `light.*` and `switch.*` entities and `door-contact` otherwise. Bindings and alert targets are checked against the loaded floorplan and show an error if unresolved.

Supported actions are `toggle`, `more-info`, and `none`. Light bindings default to tap `toggle` and hold `more-info`; door contacts default to `more-info` for both. Toggle is limited to `light` and `switch` entities. Alerts are display rules only: define security/alarm conditions in Home Assistant and bind the resulting alert entity here.

Supported alert effects are `flash`, `pulse`, `highlight`, `room-wash`, and `camera-focus`. Effects target room IDs; `color` (or `colour`) and `priority` are optional. Reduced-motion preferences disable rapid animation.

## Scope and limitations

- The card supports visualization, light and door-contact state display, configured light/switch toggles, more-info, and entity-driven alert effects.
- A YAML configuration editor, automated browser testing, and HACS release validation are not yet included.
- The initial supported floorplan schema is `2.x`; malformed configurations and failed floorplan requests are shown in the card rather than leaving a blank canvas.
- Home Assistant automations remain responsible for deciding whether events constitute warnings or alarms.
