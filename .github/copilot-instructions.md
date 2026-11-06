# GitHub Copilot Instruction for the Repository


---
apply:
  - "src/**/*.ts"
  - "src/**/*.js"
---
# Home Assistant Custom Card Dev Rules
# Token Budget: Maximize snippet reuse. Never rewrite full files unless requested.

## Code Constraints
- Stack: TypeScript, LitElement (lit), Lit Html (html, css).
- Styling: Use Shadow DOM `static get styles()`. Prefer Home Assistant CSS variables (e.g., `--primary-text-color`, `--card-background-color`, `--mdc-icon-color`).
- Outputs: Provide ONLY the relevant updated method, function, or template block. Do not include boilerplate imports or unmodified wrapper code.

## Home Assistant Frontend API Specs
- Object Model: `this.hass` provides states. Ensure state checks safely handle undefined (e.g., `this.hass.states[this._config.entity]?.state`).
- Config Method: `setConfig(config)` must throw errors for missing critical fields (like `entity`).
- Card Sizes: `getCardSize()` must return an integer (default `3`).


- Provide an element stub for `getConfigElement()` targeting the companion editor UI if expected by the repo architecture.


## Coding Standards
- Always use functional components with arrow functions (`const MyComponent = () => {}`).
- Enforce strict TypeScript typing; avoid using `any` at all costs.
- Use async/await instead of `.then()` promises.

## Testing & Documentation
- Every new utility function requires a corresponding unit test using Vitest.
- Write brief JSDoc comments for all exported functions explaining the parameters and return types.
