# Three Floorplan Card: GitHub Copilot Handover

## 1. Purpose of this document

This document hands over the Three.js floorplan visualisation project for continued development in VS Code with GitHub Copilot.

The project is intended to become a Home Assistant Lovelace custom card distributed through HACS. Development began as a standalone Three.js application so geometry, lighting, door animation, state handling and visual effects could be developed independently of Home Assistant.

The central architectural principle is:

> Build one reusable floorplan engine with two hosts: a standalone mock host and a Home Assistant Lovelace card host.

Do not rewrite the renderer specifically for Home Assistant. Add a thin Home Assistant adapter around the existing core.

---

## 2. Current scope

The current implementation covers the foundations developed through Milestone 4:

- External floorplan JSON loading
- External visual configuration
- Standalone Three.js rendering
- Orbit, zoom and pan controls
- Rooms, floors, walls, doors, windows and passages
- Shared-wall generation
- World-coordinate connector matching
- Door opening/closing from mock entity state
- Light state simulation
- Light on/off, brightness and colour handling
- Mock Home Assistant state provider
- Visual alert-rule infrastructure
- Flash, pulse, highlight, room wash and camera-focus effects
- Effect priority handling
- Reduced-motion behaviour
- Support for building-level physical defaults

The initial Home Assistant custom-card adapter and HACS packaging are now implemented in this project. The core renderer is still shared with the standalone mock host. Outstanding release work includes browser testing in Home Assistant, HACS validation, a card editor, and confirmation that the repository name remains `ha_3d_floormap` (the built plugin filename must match it).

The initial card configuration is YAML-based. It supports external floorplan URLs, entity bindings, light/switch toggle and more-info actions, door-contact state, and alert effects. The renderer now owns a `ResizeObserver` and animation lifecycle that is cleaned up when the card disconnects.

---

## 3. Core architectural decisions

### 3.1 Separation of responsibilities

```text
Floorplan JSON
    |
    v
Loader and validation
    |
    v
Semantic and geometry model
    |
    v
Three.js renderer
    |
    v
Normalised state and action boundary
    |                        |
    v                        v
Standalone mock host     Home Assistant host
                             |
                             v
                    Lovelace custom card
                             |
                             v
                            HACS
```

Responsibilities must remain separated:

- **Floorplan:** physical and semantic building information.
- **Renderer:** Three.js scene, geometry, lights, doors, animation and visual effects.
- **State adapter:** converts raw host states into renderer-friendly states.
- **Mock provider:** simulates Home Assistant during standalone development.
- **Home Assistant adapter:** reads `hass.states`, invokes services and opens more-info dialogs.
- **Card configuration:** installation-specific entity bindings, behaviour and display settings.
- **Home Assistant automation:** decides whether an event is informational, a warning or an alarm.

### 3.2 Security and automation boundary

The card must not determine whether a raw event is a security alarm.

Example:

```text
binary_sensor.front_door = on
```

This means only that the door is open. It is information.

Home Assistant automation or template logic should evaluate context:

```text
front door open
AND
nobody home
```

and publish a separate alert entity, for example:

```text
binary_sensor.front_door_security_alert = on
```

The card then visualises that alert:

- Flash the door red
- Apply a red room wash
- Focus the camera
- Show an alert badge

The card owns presentation logic, not alarm logic. Compound conditions may remain available for visual convenience, but they must never be described as reliable security automation.

---

## 4. Recommended repository structure

Continue towards this structure:

```text
three-floorplan-card/
├── src/
│   ├── core/
│   │   ├── types.ts
│   │   ├── config.ts
│   │   ├── loader.ts
│   │   ├── validator.ts
│   │   ├── geometry.ts
│   │   ├── openings.ts
│   │   ├── placements.ts
│   │   └── effects.ts
│   │
│   ├── renderer/
│   │   ├── renderer.ts
│   │   ├── wall-renderer.ts
│   │   ├── opening-renderer.ts
│   │   ├── light-renderer.ts
│   │   ├── door-renderer.ts
│   │   ├── effect-controller.ts
│   │   └── camera-controller.ts
│   │
│   ├── state/
│   │   ├── state-provider.ts
│   │   ├── state-normaliser.ts
│   │   ├── light-state.ts
│   │   ├── door-state.ts
│   │   └── mock-provider.ts
│   │
│   ├── adapters/
│   │   ├── standalone-adapter.ts
│   │   ├── home-assistant-adapter.ts
│   │   └── action-adapter.ts
│   │
│   ├── card/
│   │   ├── three-floorplan-card.ts
│   │   ├── three-floorplan-editor.ts
│   │   ├── card-config.ts
│   │   └── register-card.ts
│   │
│   ├── ui/
│   │   ├── developer-panel.ts
│   │   ├── loading-view.ts
│   │   └── error-view.ts
│   │
│   ├── main.ts
│   └── style.css
│
├── public/
│   ├── config.json
│   ├── floorplans/
│   │   └── reference-home.json
│   └── mock/
│       ├── mock-states.json
│       └── effects.json
│
├── schemas/
│   ├── floorplan.schema.json
│   ├── card-config.schema.json
│   ├── mock-state.schema.json
│   └── effects.schema.json
│
├── tests/
│   ├── geometry.test.ts
│   ├── openings.test.ts
│   ├── placements.test.ts
│   ├── light-state.test.ts
│   ├── door-state.test.ts
│   └── effects.test.ts
│
├── hacs.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
├── CHANGELOG.md
├── LICENSE
└── handover.md
```

The existing implementation may be less decomposed. Refactor incrementally. Do not remove working renderer functions during decomposition.

---

## 5. Floorplan JSON design

### 5.1 Root structure

```json
{
  "schemaVersion": "2.16",
  "id": "reference-home",
  "name": "Reference Home",
  "buildingDefaults": {
    "wallThickness": 0.16,
    "wallHeight": 2.4,
    "floorThickness": 0.12,
    "doorHeight": 2.05,
    "windowSillHeight": 0.8,
    "windowHeadHeight": 2.1
  },
  "rooms": [],
  "relationships": [],
  "wallAlignments": [],
  "entityPlacements": []
}
```

### 5.2 Configuration precedence

Use this order for physical values:

```text
object-specific value
    -> room-specific value, if later supported
    -> floorplan buildingDefaults
    -> card visual defaults
```

Do not treat the card configuration as the authoritative source of real building measurements when the floorplan provides them.

### 5.3 Room structure

```json
{
  "id": "main-bedroom",
  "name": "Main Bedroom",
  "type": "bedroom",
  "sizeCategory": "medium",
  "layout": {
    "x": 5.8,
    "y": 5.4,
    "width": 4.0,
    "height": 3.0
  },
  "connectors": []
}
```

The 2D floorplan uses `x` and `y`. Three.js maps these to world `x` and `z`; vertical height is Three.js `y`.

### 5.4 Connector structure

Supported connector types:

```text
door
window
open-passage
```

Base connector:

```json
{
  "id": "main-bedroom-right-door",
  "roomId": "main-bedroom",
  "side": "right",
  "type": "door",
  "position": 0.5167,
  "offset": 1.55,
  "width": 0.9
}
```

`offset` is the physical distance along the named room side. `position` may be retained as a normalised editor convenience, but rendering should use `offset` because it maps directly to geometry.

### 5.5 Door metadata

```json
{
  "id": "main-bedroom-right-door",
  "roomId": "main-bedroom",
  "side": "right",
  "type": "door",
  "offset": 1.55,
  "width": 0.9,
  "door": {
    "hinge": "left",
    "swing": "inward",
    "openAngle": 85,
    "height": 2.05
  }
}
```

Recommended values:

```text
hinge: left | right
swing: inward | outward
openAngle: 0..180
```

Potential future door motion values:

```text
swing
slide-left
slide-right
bifold
none
```

Do not require advanced door types for the first HACS version.

### 5.6 Window metadata

```json
{
  "id": "main-bedroom-top-window",
  "roomId": "main-bedroom",
  "side": "top",
  "type": "window",
  "offset": 2.0,
  "width": 1.5,
  "window": {
    "type": "sliding",
    "sillHeight": 0.8,
    "headHeight": 2.1,
    "frameDepth": 0.08
  }
}
```

Keep `window.type` extensible. Possible later values include:

```text
fixed
sliding
casement
awning
double-hung
glazed-door
```

For a window opening, geometry must contain:

1. Wall below the sill
2. Glass/frame between sill and head
3. Wall above the head

### 5.7 Connector relationships

```json
{
  "id": "bedroom-front-left-door--main-bedroom-right-door",
  "connectorA": "main-bedroom-right-door",
  "connectorB": "bedroom-front-left-door",
  "importance": "required"
}
```

A physical internal door should be generated from the relationship, not once from each room. This avoids duplicate doors.

Paired connectors can have different local offsets and still refer to the same physical position. Always calculate world-space connector positions before validating a pair.

---

## 6. Geometry rules and lessons learned

### 6.1 World-coordinate connector matching

Do not compare connector offsets directly.

For a room layout and connector:

```typescript
function connectorWorldPoint(room: Room, connector: Connector) {
  const l = room.layout;

  switch (connector.side) {
    case "top":
      return { x: l.x + connector.offset, z: l.y };
    case "bottom":
      return { x: l.x + connector.offset, z: l.y + l.height };
    case "left":
      return { x: l.x, z: l.y + connector.offset };
    case "right":
      return { x: l.x + l.width, z: l.y + connector.offset };
  }
}
```

A pair is geometrically matched when:

- A relationship links the connectors
- Connector types are compatible
- The calculated world points are within tolerance
- Wall orientations are compatible
- Widths are compatible or can be reconciled

A practical initial tolerance is:

```typescript
Math.max(config.matchingTolerance, wallThickness)
```

Log a warning when a relationship exists but the world coordinates are outside tolerance.

### 6.2 Shared walls

Do not render four complete wall boxes for every room.

Instead:

1. Convert room boundaries into horizontal and vertical wall lines.
2. Group coincident collinear lines.
3. Merge overlapping intervals.
4. Associate openings with the merged line.
5. Split the line around openings.
6. Render the remaining wall segments once.

This prevents double-thickness shared walls and overlapping shadows.

### 6.3 Corners and junctions

Previous approaches showed gaps or protrusions at corners. The current pragmatic solution adds wall-thickness-sized junction pieces at:

- External endpoints
- Corners
- T-junctions
- Orthogonal crossings

The longer-term robust solution is a wall polygon/union builder that generates watertight wall geometry. Do not attempt a large computational geometry rewrite during the initial HACS conversion unless the current junction solution demonstrably fails.

### 6.4 Door openings

For a door:

- Split the wall at the door width.
- Retain wall material above the door.
- Add jamb geometry at both sides.
- Position the pivot at the hinge edge.
- Size the door leaf to the opening with only a small operational clearance.

The previous `width * 0.96` leaf produced an obvious gap. Use a small absolute clearance instead, for example:

```typescript
const leafWidth = openingWidth - 0.012;
```

The exact value should eventually be configurable.

### 6.5 Windows

For each window:

- Split the base wall along the window width.
- Add lower wall geometry to the sill.
- Add glazing/frame from sill to head.
- Add upper wall geometry from head to wall height.
- Avoid placing a complete hidden wall behind the window.

### 6.6 Open passages

Open passages remove the wall segment. They do not create a door leaf or glazing.

---

## 7. Entity placement design

### 7.1 Principle

Physical or semantic placement belongs in the floorplan. Home Assistant entity IDs belong in installation-specific bindings.

### 7.2 Floorplan placement

```json
{
  "id": "dining-main-light-placement",
  "kind": "light",
  "entityRef": "dining-main",
  "attachment": {
    "targetType": "room",
    "targetId": "dining",
    "anchor": "ceiling-centre",
    "height": 2.3
  },
  "visualAdjustment": {
    "offset": [0.0, -0.05, 0.0],
    "rotation": [0, 0, 0],
    "scale": 1.0
  }
}
```

Suggested anchors:

```text
centre
ceiling-centre
floor-centre
wall-centre
corner-top-left
corner-top-right
frame-top
connector-centre
custom
```

Use semantic anchors whenever possible. Use explicit coordinates only when semantic placement is insufficient.

### 7.3 Home Assistant binding

```yaml
bindings:
  dining-main:
    entity: light.dining_room
  bedroom-door:
    entity: binary_sensor.bedroom_door
```

This keeps the floorplan reusable across installations.

---

## 8. Standalone mock-state JSON

Example:

```json
{
  "bindings": [
    {
      "ref": "dining-main",
      "entityId": "light.dining_room",
      "targetId": "dining",
      "kind": "light",
      "placement": {
        "height": 2.2,
        "offset": [0, 0, 0]
      }
    },
    {
      "ref": "bedroom-door",
      "entityId": "binary_sensor.bedroom_door",
      "targetId": "bedroom-front-left-door--main-bedroom-right-door",
      "kind": "door-contact"
    }
  ],
  "states": [
    {
      "entity_id": "light.dining_room",
      "state": "on",
      "attributes": {
        "brightness": 190,
        "rgb_color": [255, 205, 140]
      }
    },
    {
      "entity_id": "binary_sensor.bedroom_door",
      "state": "off",
      "attributes": {
        "device_class": "door"
      }
    }
  ]
}
```

The mock provider should support:

```typescript
interface StateProvider {
  getState(entityId: string): EntityState | undefined;
  subscribe(listener: StateListener): () => void;
}
```

A separate action interface is recommended:

```typescript
interface ActionProvider {
  toggle(entityId: string): Promise<void> | void;
  callService(domain: string, service: string, data: object): Promise<void> | void;
  showMoreInfo(entityId: string): void;
}
```

The Home Assistant adapter should implement the same interfaces.

---

## 9. Normalised state models

### 9.1 Lights

```typescript
interface LightViewState {
  available: boolean;
  on: boolean;
  brightness: number;  // 0..1
  colour: string;      // CSS-compatible colour
  colourTemperature?: number;
}
```

Support:

- `on` and `off`
- `brightness`
- `rgb_color`
- `hs_color`
- colour temperature
- `unknown`
- `unavailable`

Use a visual intensity curve rather than a direct linear conversion:

```typescript
const intensity = minimumGlow +
  Math.pow(normalisedBrightness, 1.6) * intensityMultiplier;
```

### 9.2 Doors

```typescript
interface DoorViewState {
  available: boolean;
  open: boolean;
}
```

The sensor state controls the physical door animation. Security alert styling should come from a separate alert entity or presentation rule.

---

## 10. Visual effects JSON

Example:

```json
{
  "rules": [
    {
      "id": "front-door-alert",
      "all": [
        {
          "entity": "binary_sensor.front_door_security_alert",
          "state": "on"
        }
      ],
      "effects": [
        {
          "target": "front-hall",
          "effect": "flash",
          "color": "#ff2020",
          "intervalMs": 450,
          "priority": 10
        },
        {
          "target": "front-door",
          "effect": "highlight",
          "color": "#ff2020",
          "priority": 10
        },
        {
          "target": "front-hall",
          "effect": "camera-focus",
          "priority": 10
        }
      ]
    }
  ]
}
```

Supported effect types:

```text
flash
pulse
highlight
room-wash
camera-focus
```

Requirements:

- Higher priority effects override lower priority effects on the same visual target.
- Effects stop when their rule no longer matches.
- Reduced-motion preferences replace rapid flashing with a static warning style.
- Effects should not reconstruct the scene.
- The effects engine must accept a generic state lookup, not depend directly on Home Assistant.

Recommended later additions:

```text
badge
outline
icon
camera-preset
whole-floor-wash
```

---

## 11. Standalone configuration JSON

```json
{
  "floorplanUrl": "/floorplans/reference-home.json",
  "mockStateUrl": "/mock/mock-states.json",
  "effectsUrl": "/mock/effects.json",
  "camera": {
    "allowRotation": true,
    "allowZoom": true,
    "allowPan": true
  },
  "visuals": {
    "wallThickness": 0.16,
    "wallHeight": 2.4,
    "floorThickness": 0.12,
    "doorHeight": 2.05,
    "defaultDoorWidth": 0.9,
    "windowSillHeight": 0.8,
    "windowHeadHeight": 2.1,
    "defaultWindowWidth": 1.5,
    "frameDepth": 0.08,
    "ambientIntensity": 0.5,
    "sunlightIntensity": 0.9,
    "shadows": true,
    "matchingTolerance": 0.08
  }
}
```

During standalone development, another floorplan can be selected with:

```text
?floorplan=my-plan.json
```

The file must be placed under `public/floorplans/`.

---

## 12. Home Assistant custom-card design

### 12.1 Card registration

Target card type:

```yaml
type: custom:three-floorplan-card
```

The card class should provide at least:

```typescript
class ThreeFloorplanCard extends HTMLElement {
  setConfig(config: ThreeFloorplanCardConfig): void;
  set hass(hass: HomeAssistant);
  getCardSize(): number;
  getGridOptions?(): object;
  disconnectedCallback(): void;
}
```

Prefer Lit only if it materially simplifies lifecycle and editor integration. The Three.js canvas itself should remain managed by the renderer, not recreated on every Lit render.

### 12.2 Suggested Lovelace configuration

```yaml
type: custom:three-floorplan-card
floorplan:
  source: /local/floorplans/reference-home.json

camera:
  mode: orbit
  allow_rotation: true
  allow_zoom: true
  allow_pan: false

appearance:
  shadows: true
  ambient_intensity: 0.5
  sunlight_intensity: 0.9
  max_pixel_ratio: 2

bindings:
  dining-main:
    entity: light.dining_room
    tap_action:
      action: toggle
    hold_action:
      action: more-info

  bedroom-door:
    entity: binary_sensor.bedroom_door
    target: bedroom-front-left-door--main-bedroom-right-door
    tap_action:
      action: more-info

alerts:
  - entity: binary_sensor.front_door_security_alert
    state: "on"
    effects:
      - target: front-hall
        effect: flash
        colour: "#ff2020"
        priority: 10
      - target: front-hall
        effect: camera-focus
```

### 12.3 `hass` update strategy

When Home Assistant assigns a new `hass` object:

1. Extract only entities referenced by bindings or visual rules.
2. Compare relevant state and relevant attributes to cached values.
3. Normalise changed entities.
4. Update only the affected Three.js object.
5. Re-evaluate visual rules only when a referenced entity changes.
6. Do not rebuild the complete scene.

### 12.4 Actions

Recommended defaults:

- Light tap: toggle
- Light hold: more-info
- Door sensor tap: more-info
- Room tap: optional camera focus
- Locks and physical door actuators: no default control

Any lock or actuator service call must require explicit configuration and should support confirmation.

### 12.5 Home Assistant errors

The card should distinguish:

- Floorplan file missing
- Invalid JSON
- Unsupported schema version
- Entity binding missing
- Home Assistant entity missing
- Entity unknown
- Entity unavailable
- WebGL unavailable
- Configuration invalid

Do not fail with a blank canvas.

---

## 13. HACS packaging direction

The HACS deliverable is a dashboard/plugin repository, not a backend integration for the first release.

The compiled JavaScript bundle is written to:

```text
dist/ha_3d_floormap.js
```

The bundle filename matches the current repository name, as required for a HACS dashboard plugin. Update the build output, manifest, and resource URL if the GitHub repository is renamed. The repository root includes:

```text
hacs.json
README.md
CHANGELOG.md
.github/workflows/validate.yml
```

Current `hacs.json`:

```json
{
  "name": "Three Floorplan Card",
  "content_in_root": false,
  "filename": "ha_3d_floormap.js"
}
```

The publishing manifest and workflow were checked against current HACS dashboard guidance. A public GitHub repository and release are still needed for a versioned HACS installation.

---

## 14. Recommended next implementation sequence

### Phase A: stabilise current standalone engine

1. Import the latest real floorplan JSON.
2. Add automated fixture tests for known door pairs.
3. Add geometry diagnostics for unmatched relationships.
4. Add debug anchor and wall-line displays.
5. Verify corners, T-junctions, windows and passages at multiple wall thicknesses.
6. Verify floorplan `buildingDefaults` override card defaults.

### Phase B: formal provider interfaces

1. Extract `StateProvider`.
2. Extract `ActionProvider`.
3. Update `MockProvider` to implement both interfaces.
4. Ensure the renderer has no import from Home Assistant types.
5. Ensure state updates are target-specific.

### Phase C: Home Assistant adapter

1. Add Home Assistant TypeScript interfaces.
2. Implement `HomeAssistantStateProvider` over `hass.states`.
3. Implement service calls for light toggle.
4. Implement more-info events.
5. Add lifecycle cleanup.
6. Test unavailable and renamed entities.

### Phase D: custom card

1. Register `custom:three-floorplan-card`.
2. Implement `setConfig` validation.
3. Create renderer once when connected.
4. Load the floorplan once unless its URL changes.
5. Feed relevant `hass` updates into the state adapter.
6. Resize using `ResizeObserver`.
7. Add loading and error states.

### Phase E: card editor

Start with a minimal editor:

- Floorplan URL
- Camera mode
- Rotation, zoom and pan switches
- Shadow quality
- Binding rows with Home Assistant entity selectors

Keep complex effect-rule editing in YAML for the first release.

### Phase F: HACS release preparation

1. Produce a single distributable bundle.
2. Add HACS manifest.
3. Add installation documentation.
4. Add release and validation workflows.
5. Test installation as a custom HACS repository.
6. Test upgrade without removing card configuration.

---

## 15. Testing strategy

### 15.1 Geometry fixtures

Maintain small purpose-specific fixtures:

```text
single-room.json
shared-wall.json
door-offset-pair.json
external-door.json
window-test.json
passage-test.json
t-junction.json
corner-test.json
full-reference-home.json
```

### 15.2 Geometry tests

Test:

- Same physical door with different local offsets
- Door pair outside tolerance
- Duplicate shared walls merged
- Door cut once from a shared wall
- Passage removes wall material
- Window creates lower and upper infill
- External corners close at different thickness values
- T-junctions close
- Width conflict produces a warning

### 15.3 State tests

Test:

- Light on/off
- Brightness 0 and 255
- RGB
- HS
- Colour temperature
- Unknown
- Unavailable
- Door open/closed
- Missing entity

### 15.4 Effects tests

Test:

- One condition
- Multiple `all` conditions
- `stateNot`
- Higher-priority effect wins
- Effect cancels correctly
- Reduced-motion mode
- Camera focus does not continually reset manual control after effect cancellation

### 15.5 Regression requirement

Do not remove or regress:

- JSON floorplan loading
- Orbit controls in standalone mode
- Mock-state toggles
- Configurable building dimensions
- Door/window rendering
- Shared-wall logic
- External visual rules

---

## 16. Performance guidelines

- Use one animation loop.
- Update only changed entity objects.
- Cache materials and geometries where practical.
- Avoid rebuilding the scene when `hass` changes.
- Cap device pixel ratio, especially for wall-mounted tablets.
- Allow shadows to be disabled.
- Consider pausing continuous rendering when no animation, controls or effects are active.
- Use `ResizeObserver` rather than relying only on the global resize event.
- Dispose geometries, materials, textures and controls when reloading or disconnecting.

---

## 17. Accessibility and usability

- Do not rely on colour alone.
- Support labels, icons or tooltips for open/closed and alert states.
- Honour `prefers-reduced-motion`.
- Provide a static alert alternative to flashing.
- Allow a fixed camera for dashboard use.
- Retain orbit mode for setup and diagnostics.
- Provide large touch targets.
- Avoid accidental dashboard scrolling while manipulating the 3D view.

---

## 18. Known design risks

### Geometry tolerance

A single tolerance may not suit every floorplan. Diagnostics should report the measured distance between related connectors and the tolerance used.

### Floorplan quality

The renderer cannot reliably reconstruct invalid or geometrically inconsistent relationships. Validation should report issues instead of silently inventing geometry.

### Duplicate meaning

Do not embed Home Assistant entity IDs permanently inside reusable physical geometry. Retain logical `entityRef` bindings.

### Security logic

Do not migrate alarm decisions into the card. Home Assistant remains the automation source of truth.

### HACS coupling

Do not let packaging requirements leak into the core renderer. HACS should distribute the card host, not define the engine architecture.

---

## 19. Definition of the first useful HACS release

The first release is complete when it can:

1. Load an external floorplan JSON.
2. Render rooms, shared walls, doors, windows and passages.
3. Bind Home Assistant light entities.
4. Show light on/off, brightness and colour.
5. Bind door contact entities.
6. Animate door open/closed state.
7. Show unknown and unavailable states.
8. Toggle lights through an explicit card action.
9. Open Home Assistant more-info dialogs.
10. Visualise a separate Home Assistant alert entity.
11. Apply flash, pulse, highlight, room wash and camera focus effects.
12. Honour reduced-motion preferences.
13. Show actionable configuration and loading errors.
14. Operate in both standalone mock mode and Home Assistant mode.
15. Install and update through a custom HACS repository.

---

## 20. Instructions for GitHub Copilot

When continuing this project:

1. Preserve existing behaviour unless a change is explicitly required.
2. Prefer incremental refactoring over a complete rewrite.
3. Keep the renderer host-independent.
4. Keep Home Assistant automation logic outside the card.
5. Use world-space positions for opening matching.
6. Render shared walls once.
7. Add tests before changing geometry rules.
8. Treat floorplan physical values as authoritative over visual defaults.
9. Maintain the standalone mock environment throughout HACS development.
10. Update this handover, the README and the changelog when architecture or JSON contracts change.

A suitable first Copilot task is:

> Review the existing Milestone 4 source against `handover.md`. Introduce `StateProvider` and `ActionProvider` interfaces, refactor the existing mock provider to implement them, and add a Home Assistant adapter skeleton without changing current standalone behaviour. Add tests for the provider boundary and keep the renderer independent of Home Assistant types.
