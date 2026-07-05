# Lyra Standards

Lyra is a desktop lyrics app with a Rust core, Tauri bridge, and React UI. These standards define the quality bar for maintainable changes.

## Project Standards

- Business logic belongs in `crates/lyra-core`.
- Tauri commands and events are bridge code only: delegate, serialize, emit, and manage desktop integration.
- React surfaces render backend state and forward user intent; they must not independently compute playback, lyric sync, cache behavior, or provider logic.
- Shared contracts must be represented once per layer. Avoid hand-maintained duplicate DTOs across views.
- Cross-platform behavior must be explicit for macOS, Windows, and Linux; Linux must not inherit macOS styling or assumptions by default.
- Persistence paths and store names must remain stable and case-consistent.
- Performance is a major product requirement. Prefer designs that minimize CPU, GPU, memory, IPC, bundle size, and battery impact, especially because Lyra can keep multiple always-on-top surfaces alive while audio is playing.
- User-visible failures must leave the UI in an honest state: no success feedback after failed commands.
- Changes must be verified with the narrowest meaningful checks before being considered complete.

## Frontend Standards

### Architecture

- Keep the SPA routing model: `/`, `/island`, `/karaoke`, and `/settings`.
- Prefer shared hooks for repeated IPC, event subscription, visibility, playback snapshot, and settings behavior.
- View components should compose focused components; avoid large files that mix IPC, animation loops, rendering, persistence, and controls.
- Use typed Tauri command wrappers instead of raw `invoke` scattered through views.
- Keep frontend DTOs centralized and aligned with Rust serde shapes.

### Component Boundaries

- Components should have one primary responsibility: layout, data binding, control behavior, or presentational rendering.
- Prefer one exported component per file, especially for route files and surface-level components.
- Small private subcomponents may live in the same file when they exist only to implement one reusable component and are not reused elsewhere.
- Shared components must accept explicit props and avoid reaching directly into Tauri commands or global document state.
- Route entrypoints may coordinate hooks and compose components, but should not contain large presentational trees.
- Extract a component when markup, state, and event handling for one UI unit exceed what can be understood at a glance.

### Redundancy And Repetition

- In new code and refactored code, reduce repetition when it lowers maintenance risk, prevents inconsistent behavior, or clarifies an established boundary.
- Do not extract code only to satisfy "DRY"; keep local repetition when a shared abstraction would hide intent or couple unrelated concerns.
- Centralize stable values and mappings that must stay consistent, such as placeholder labels, settings option arrays, surface config maps, command payload maps, and shared fallback constants.
- Prefer shared hooks or utilities for repeated event, listener, subscription, timer, observer, and cleanup patterns once the lifecycle behavior is understood.
- Remove dead comments, stale fallback code, and commented-out implementations when working near them.
- Keep redundancy cleanup behavior-preserving unless the change is explicitly scoped as a user-visible behavior update.

### File Naming

- Component file names must use `kebab-case`.
- Exported React component symbols remain `PascalCase`.
- Hook file names must use `kebab-case`, while hook functions remain `usePascalCase`.
- Avoid mixed naming styles such as `PlayerSidebar.tsx`, `player_sidebar.tsx`, or `index.tsx` for new extracted components unless preserving an existing route entrypoint.
- Existing route entrypoints such as `views/app/index.tsx` may remain as-is unless a route restructure explicitly renames them.

### Hooks

- Hooks may own subscriptions, timers, `requestAnimationFrame` loops, and Tauri event cleanup.
- Every hook that registers a listener, timeout, interval, animation frame, or observer must clean it up.
- Hooks that call Tauri commands should expose typed state and typed actions, not raw `invoke` calls.
- Hook names remain `usePascalCase`; hook file names use `kebab-case`.
- **Documentation:** All custom hooks must be documented using JSDoc/TSDoc comments directly above the hook signature and options interfaces. This ensures rich editor auto-complete and hover context. Documentation must cover:
  - **Responsibility:** What external systems, APIs, or event listeners (e.g., Tauri events like `playback-tick`) the hook coordinates.
  - **Inputs & Outputs:** The purpose and constraints of options/params (especially callbacks, configurations, and refs) and returned states/handlers.
  - **Lifecycle Side Effects & Cleanup:** The lifecycle of any async boundaries, subscriptions, timers, or observers, and how cleanups or cancellation tokens are implemented to handle unmounts.


### State And Data Flow

- Playback state comes from `get_render_snapshot` and `playback-tick`.
- UI visibility and surface settings flow through `get_ui_state`, `ui-settings-changed`, `get_settings`, and `app-settings-changed`.
- Do not update React state during render. Use effects or derived values.
- Avoid duplicating backend-derived state in React when it can be derived cheaply from the current snapshot.
- Avoid redundant Tauri commands across surfaces; central hooks should dedupe, debounce, or cache where the behavior allows it.
- Optimistic UI updates must have rollback or reconciliation on failed backend commands.
- Avoid swallowing command failures unless the failure is truly non-actionable and documented by a shared helper.

### Forms And Settings

- Settings controls must use controlled values from the current settings snapshot.
- Settings changes must reconcile with backend events after command completion.
- Debounced settings writes must preserve the latest user-selected value.
- Destructive or irreversible settings actions require honest pending, success, and failure states.

### TypeScript

- TypeScript should run with strict settings.
- Avoid `unknown`, broad `Record<string, unknown>`, and `Partial<T>` patches unless narrowed at the boundary.
- Avoid `@ts-expect-error`; if platform-specific DOM attributes are needed, model or isolate them.
- Prefer standard semantic HTML controls plus CSS over non-standard DOM attributes that require JSX type escapes.
- Shared types should live in a dedicated frontend contract module.
- Prefer the `@/` alias for imports from `apps/desktop-tauri/src`; reserve relative imports for same-directory files, colocated CSS, and intentionally local assets.

### Accessibility

- Interactive elements should be semantic controls whenever possible.
- Any element with `role="button"` must support Enter and Space.
- Every keyboard-focusable control must have visible `:focus-visible` styling.
- Icon-only controls require accessible labels.
- Do not remove outlines without an equivalent focus style.
- Long repeated interactive lists should avoid placing every item in the normal Tab order; use a single entry point with roving `tabIndex` or arrow-key navigation.

### Styling And UX

- Preserve platform-specific styling through `body[data-os]`.
- Respect `prefers-reduced-motion`.
- Keep controls stable in size; hover, focus, and active states must not shift layout.
- CSS class names should remain stable during refactors unless changing them improves clarity and all usage is updated.
- Avoid dead commented UI implementations in committed code.

### CSS

- Prefer CSS custom properties for shared colors, sizing, opacity, font scale, and motion duration.
- Avoid one-off inline styles except for dynamic CSS variables or measured layout values.
- New CSS should be colocated with the surface or component it styles.
- Avoid `transition: all`; transition only the properties that should animate.
- Avoid `!important` except for accessibility or global reduced-motion overrides.

### Motion And Animation

- Motion for React is the approved frontend animation library for React-state-driven layout, presence, gesture, and interruptible UI animations.
- Default to CSS transitions and keyframes for simple state, entrance, hover, focus, placeholder, and surface animations.
- Reserve `requestAnimationFrame` for playback-synced or continuously measured animations such as lyric progress, word colouring, progress rings, and visualizer bars.
- Centralize motion tokens as CSS custom properties: durations, easing curves, and common animation names.
- Prefer animating `transform` and `opacity`; avoid continuous animation of layout, blur, filter, and backdrop-filter unless explicitly justified and reduced-motion gated.
- Do not use `transition: all`.
- All motion must have a `prefers-reduced-motion` behavior.
- Use `will-change` only for active or short-lived animated elements, not broad static lists.
- New use of Motion for React should justify why CSS is insufficient for that interaction.
- Do not use Motion for React in playback-synced lyric, progress, or visualizer hot paths.
- Do not add other animation libraries, such as React Spring or GSAP, without explicit project approval.

### Performance

- Treat performance as a default design constraint, not a late optimization pass.
- Use `requestAnimationFrame` loops only when the surface is visible and animation is needed.
- Avoid DOM reads inside per-frame loops when values can be cached.
- Keep playback-synced updates outside React render loops when per-frame interpolation is required.
- Prefer derived values, stable props, and narrow state updates over broad parent re-renders.
- Memoize only when it protects a measured or obvious hot path; avoid decorative memoization that obscures code.
- Virtualize, window, or otherwise bound long repeated UI lists before making every row interactive or animated.
- Debounce slider, resize, drag, and settings persistence writes before sending IPC commands.
- Prefer `transform` and `opacity` for visual movement; avoid layout, paint-heavy, blur, filter, and backdrop-filter work in frequently updated paths.
- Keep expensive visual effects gated by reduced-motion or low-power states.
- Keep bundle size small. New dependencies, assets, and generated code must justify their runtime and download cost.
- Avoid work in hidden windows or invisible surfaces; subscriptions, timers, observers, and animation loops should pause or narrow when the surface is hidden.
- Prefer simple data structures and O(1) or bounded work in polling, playback, lyric rendering, and animation paths.
- Do not reintroduce polling loops when backend events already provide updates.

### Dependencies

- `pnpm` is the standard package manager for frontend work.
- Frontend dependency changes must update the relevant `pnpm-lock.yaml`.
- Do not use `npm`, Yarn, or Bun for frontend dependency installation or script execution unless explicitly required for a one-off compatibility check.
- Do not add frontend dependencies for small utilities that can be written clearly in local code.
- Motion for React is the preferred dependency when a React animation library is warranted.
- New UI dependencies must justify bundle size, maintenance health, and Tauri compatibility.
- Icon additions should use the existing icon approach unless a broader icon system is intentionally adopted.

### Frontend Security And Privacy

- Do not expose secrets, tokens, filesystem paths, or raw backend errors in the UI.
- Treat artwork and provider URLs as untrusted display inputs.
- Do not add remote scripts, remote stylesheets, or analytics without explicit project approval.

### Verification

- Frontend changes must pass:
  - `cd apps/desktop-tauri && pnpm lint`
  - `cd apps/desktop-tauri && pnpm build`
- Bridge-impacting changes must also pass:
  - `cargo check --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml`
- UI refactors require a manual smoke test of main, island, karaoke, and settings surfaces.
- Frontend behavior touching settings, visibility, playback display, or lyric rendering needs a manual smoke-test note.
- Accessibility changes need keyboard-only verification.
- Animation or visual-effect changes need verification in normal and reduced-motion modes.
