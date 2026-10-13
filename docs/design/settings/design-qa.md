# Settings design review

Final review · 13 October 2026

**Result: passed for the documentation reference scope.** The specification, ten final mockup images, and 22-page PDF were reviewed together. No actionable P0, P1, or P2 issue remains within that scope. This result does not certify the production Tauri UI or native runtime behavior.

## Review baseline

The selected Appearance direction is the visual baseline, with the user's subsequent corrections taking precedence: the existing desktop font, softer monochrome outline icons, a Theme select, refined capsule sliders, title-only page headers, and the real Lyra wordmark. The supporting pages apply that system to the current settings inventory.

The earlier generated draft was normalized to the same 860 x 640 logical content frame as the final renderer before comparison. Final captures use a 1720 x 1280 browser viewport at 2x. Both the complete Appearance frame and a focused Typography/control crop were compared. Generated lettering, icon approximations, and simulated window controls are superseded by the real assets and documented native-chrome boundary.

Working comparison images and browser metrics are retained in the task's visualization directory:

- [Complete Appearance comparison](/Users/eisewilliam/.codex/visualizations/2026/10/12/01a13251-a307-7702-a433-45a0e2662dfc/appearance-final-comparison.png)
- [Typography and control comparison](/Users/eisewilliam/.codex/visualizations/2026/10/12/01a13251-a307-7702-a433-45a0e2662dfc/appearance-control-comparison.png)
- [Capture measurements](/Users/eisewilliam/.codex/visualizations/2026/10/12/01a13251-a307-7702-a433-45a0e2662dfc/final-mockup-metrics.json)

The portable deliverables are the files in this settings folder. The task-local evidence links above supplement them.

## Visual checks

| Surface | Evidence and result |
| --- | --- |
| Layout and geometry | All ten captures use the same frame, sidebar, header, content edges, and footer. Appearance, normal General, Players, and Main Window fit without scrolling. Long Marquee, Karaoke, and conditional General content scroll inside the pane. |
| Typography and hierarchy | Browser-computed font family matches the desktop app's shared family. Every page header contains one title and no subtitle. Group headings, setting labels, help, values, and preview lyrics have distinct roles. |
| Color and materials | The selected dark charcoal/plum treatment and blue active states are retained. The existing cover image supplies the preview wash; adjacent lyrics remain readable. This is a browser visual reference for the intended material. |
| Branding and icons | The real white integrated wordmark is byte-identical to its checked-in source. Navigation uses actual Phosphor Regular SVGs. Existing player-brand path data is preserved. All captures reported zero missing image assets. |
| Controls and details | Theme is a native select. Sliders have thin rails, capsule thumbs, quiet ticks, aligned values, and larger interactive bounds than their visual rail. Switches, segments, disclosure, separators, and selected navigation were reviewed at full frame and control scale. |

All ten mockups in [the gallery](MOCKUPS.md) were visually reviewed. The final PDF was rendered and every page inspected for clipped text, broken tables, missing images, incorrect page furniture, and readability. The ten image plates match the final captures. Continuation screenshots intentionally show partially scrolled rows at the body boundary; the persistent title, preview, and footer remain intact.

## Corrections made during review

| Finding | Correction and final evidence |
| --- | --- |
| Long content expanded the grid pane and pushed the footer out of view. | Constrained the pane to the reference frame, allowed the body to shrink, and kept scrolling within the body. Footer bottom is 1280 px in all ten final captures. |
| Appearance had a small unnecessary overflow. | Tightened preview and group spacing while retaining the hierarchy. Its final body has matching 538 px client and scroll heights. |
| A thin range input gave the rail too small an interaction target. | Retained the 3 px visual rail inside a 24 px input target. Switch and segmented-control targets were also checked. |
| The first artwork wash and adjacent lyrics were too subdued. | Strengthened the actual-artwork wash and adjacent-line opacity, then recaptured all ten images and rebuilt the PDF. |
| The first PDF had misaligned landscape page furniture and an almost-empty introduction page. | Corrected decoration for each page size and removed the unnecessary page. The final PDF contains 12 specification pages and ten landscape plates. |

## Reference behavior checks

- Navigation and native Theme selection were exercised in the browser reference.
- Keyboard ArrowRight moved Text size from 16 px to the next existing step, 18 px, with the accessible value updated.
- Selecting Subtle lyric blur updated its selected state and `aria-pressed` value.
- The browser reported no console errors during the reference checks.
- Each final capture reported one title-only header, no missing assets, and a visible footer.
- Reference JavaScript syntax was checked with Node. Document links, image dimensions, asset hashes, and PDF page/text presence were checked separately.

Solid-token contrast against `#171519` was measured: primary text 15.96:1, secondary text 8.15:1, quiet text 6.28:1, and blue accent 4.97:1. These values cover those specific token pairs; they are not a complete accessibility audit of artwork, transparency, control boundaries, or production states.

## Remaining implementation verification

The static reference has no Tauri bridge, saved-setting writes, cache operations, updater execution, live player policy changes, or native window effects. Those integrations require the acceptance checks in [the specification](DESIGN.md).

Implementation must still verify real macOS chrome and materials, light theme, Reduce Motion and Reduce Transparency, Windows and Linux styling, screen-reader behavior, real player availability and artwork changes, hardware-dependent monitor and Touch Bar rows, persistence, and immediate application to all four windows. The hardware and player screenshots are illustrative states, not observations of connected devices or live sessions.
