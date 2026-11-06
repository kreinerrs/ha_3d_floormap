# Changelog

## 0.4.0-m4
- Fixed missing paired doors.
- Added door jambs and near-full-width leaves.
- Closed wall corners and junctions.
- Added visual rules and effects engine with priority and reduced-motion support.
## 0.5.0

- Add the Home Assistant Lovelace card and Home Assistant state/action adapters.
- Allow input_boolean helpers to act as virtual lights or door contacts.
- Load external floorplans, map entity updates to the renderer, and support configured tap/hold actions and alert effects.
- Add renderer resize handling and teardown for Home Assistant card lifecycle.
- Add HACS manifest, bundled-card build, configuration/state tests, and installation documentation.

## Unreleased

- Add `rooms` card option to show only selected rooms, and `bindings_file` to share bindings, alerts and room status between cards (card entries override).

- Stack floors above the highest wall or raised room of the floor below; double-click a floor button to spread the floors apart or restore the normal gap.

- Draw hinged (turn) and tilt-and-turn windows, accept `window-contact` placements, and let a second binding with `mode: tilt` drive the tilt while the default binding drives the turn (turn hides the tilt).

### TODO

- Edit global bindings from Home Assistant: first a websocket command that reads/writes the bindings file (HA storage as source of truth, JSON exported for the card), then a custom integration with config/options flow and entity selectors filtered by placement type, optionally a click-to-assign panel.

- Load floorplan schema 3.0, with per-floor toggle buttons stacked by floor elevation and an overlay listing ignored elements.
- Raise rooms and areas by `elevation` (solid plinth below, larger wall top on shared walls, doors at the higher floor with the drop left below) and layer area surfaces to avoid overlapping planes.
- Add floorplan motion/presence sensor placements with directional coverage and optional HA-reported position markers.
- Add configurable sun/moon compass artwork and update scene lighting/shadow direction from sun azimuth/elevation.
- Add floorplan-coordinate light and door-contact placements with HA entity bindings.
- Animate door leaves in the configured inward or outward swing direction.
- Keep closed door leaves visible and animate contact state changes over 400 ms.
- Resolve paired door metadata consistently and retain openings when settings are only on one side.
