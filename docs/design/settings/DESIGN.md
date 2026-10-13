# Lyra Settings Design

Design specification and final visual references · 13 October 2026

This document defines the selected redesign of Lyra's desktop settings. It gives designers and implementers a common reference for layout, typography, branding, controls, content, interaction, and verification. The direction keeps the first concept's sidebar layout, the second concept's dark palette, the app's existing font, and softer monochrome outline icons.

The final corrections are incorporated: settings page titles have no subtitle, Theme uses a select, sliders use small capsule thumbs, and the sidebar uses the real outlined wordmark. The mockups are design references. The production Tauri settings UI has not been changed or activated by this document.

## Deliverables and design status

| Deliverable | Purpose |
| --- | --- |
| This specification | Product decisions, complete setting inventory, interaction rules, implementation guidance, and acceptance criteria |
| [PDF package](Lyra-Settings-Design.pdf) | Reviewable copy of the specification with all ten mockup plates |
| [Mockup gallery](MOCKUPS.md) | Ten final reference images covering all six pages and longer or conditional states |
| [Reference renderer](reference/index.html) | Reproducible mockup source using the actual desktop font and vector assets |
| [Asset manifest](reference/assets/sources.json) | Source locations and hashes for the copied brand and icon assets |
| [Visual review](design-qa.md) | Evidence and limitations of the final design review |

The Appearance direction and subsequent user corrections are the decision baseline. General, Players, Main Window, Marquee, and Karaoke apply that system to the existing settings inventory; their example states are supporting references, not claims of live player, hardware, or updater verification. Values shown in images illustrate the layout and do not change product defaults.

## Design intent

Settings should feel like part of Lyra. The user should find a category, understand what a control affects, change it, and see the relevant result without navigating away unnecessarily. A small native utility does not need a dashboard or a collection of raised cards.

The existing implementation already has useful categories, shared controls, and live previews. The redesign strengthens these assets. It reduces repeated card borders and shadows, aligns controls and values, gives headings distinct roles, and keeps artwork color from weakening setting-label contrast. It preserves the current product model and all existing options.

The design prioritizes a compact 860 x 640 settings window. Long pages scroll inside the main pane. Sidebar navigation, the page title, and the immediate-apply footer stay visible. Marquee and Karaoke keep a small preview above their scrolling controls. Appearance fits its normal state without scrolling.

## Decisions that define the final design

1. Keep the sidebar structure from the first concept. General, Appearance, and Players form the first group. Main Window, Marquee, and Karaoke sit under Surfaces.
2. Keep the second concept's warm charcoal and restrained plum atmosphere, with system blue for meaningful active states.
3. Use the same shared desktop font family as the app. Do not introduce a settings-only family or use the website's Geist family for application UI.
4. Render one page title only. No tagline, explanatory subtitle, or adjacent subtext belongs in the page-title header. Necessary help belongs with the setting it explains.
5. Use the existing real white integrated wordmark as one image asset. Do not assemble a separate symbol and typed Lyra label or redraw the mark.
6. Use the softer rounded outline direction with actual Phosphor Regular assets, consistently monochrome.
7. Use a select for Theme. Do not use radio tiles, a three-button theme selector, or decorative sun and moon controls.
8. Keep slender slider tracks, small horizontal capsule thumbs, quiet ticks below the rail, and readable aligned values. Do not restore the large circular knobs or dotted rails.
9. Use a compact segmented control for Lyric blur's four named levels. Other existing small categorical choices keep their segmented treatment.
10. Preserve immediate application of settings, existing state ownership, and platform-specific behavior.

## Shared window and navigation

| Element | Reference dimension or rule |
| --- | --- |
| Settings content frame | 860 x 640 logical pixels; final images are 1720 x 1280 pixels at 2x |
| Sidebar | 180 px wide; 10 px outer navigation padding |
| Main pane | Remaining 680 px; 28 px horizontal content padding |
| Page header | 70 px high; title begins 28 px from the top and left |
| Sidebar row | 34 px high, 7 px corner radius, 11 px icon-to-label gap |
| Navigation icon | 17 px logical size, optically centered |
| Sidebar group gap | 25 px before Surfaces |
| Common setting row | At least 43 px; approximately 52 px with one help line |
| Group spacing | Usually 22 px before a group; 16 px on the compact Appearance page |
| Footer | 32 px high; aligned with the main content edge |

A selected row uses a quiet neutral fill, a 3 px blue leading indicator, and a brighter icon. Text and shape identify selection as well as color. Hover is weaker than selection. Avoid moving or animated selection indicators.

Changing categories replaces the pane in place, returns its body to the top, and preserves the stable navigation. Retain the existing short section fade and disable it for Reduce Motion. Preserve the app's existing last-viewed-pane behavior rather than adding a new persistence mechanism.

The reference captures show application content, not simulated operating-system furniture. Tauri continues to provide the actual macOS titlebar and window controls. Preserve the titlebar drag region and platform-specific chrome. Do not implement a fake traffic-light toolbar in the web content.

## Wordmark and icon assets

The sidebar wordmark comes from [the production website asset](../../../apps/website/public/assets/lyra-logo.svg), which is the checked-in white integrated Lyra wordmark. It contains the actual three-bar Verse L and outlined lettering. The reference package copies it unchanged to [lyra-wordmark.svg](reference/assets/lyra-wordmark.svg); its source hash is recorded in the manifest.

Display the complete asset at approximately 78 px wide with its natural aspect ratio. Preserve its viewBox, letter spacing, shape, and transparency. Do not stretch it, replace its lettering with system text, or generate a raster approximation. The outlined wordmark's established lettering is a brand asset and does not introduce another UI font. Use the corresponding real black asset for a light background when the light treatment is implemented.

| Destination | Exact source glyph | Purpose |
| --- | --- | --- |
| General | SlidersHorizontal | Application behavior and system preferences |
| Appearance | Swatches | Visual appearance, rather than a paintbrush metaphor |
| Players | Headphones | Listening sources |
| Main Window | AppWindow | Main lyric window |
| Marquee | PictureInPicture | Floating dynamic panel |
| Karaoke | Subtitles | Overlay lyrics |

Use the Regular outlines as one family. Inactive icons use a neutral secondary tone; selected icons become white. Do not mix filled, duotone, and outline variants or put icons in colored tiles. Use a 14 px CaretDown from the same family for the Players disclosure. Player-source marks reuse the app's existing Simple Icons glyphs and remain monochrome.

The [Phosphor license](reference/assets/PHOSPHOR-LICENSE.txt) accompanies the supplied outline assets. Existing player-brand glyphs retain the provenance recorded in `apps/desktop-tauri/src/utils/brand-icons.ts`.

## Typography and content hierarchy

The shared application family is `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`, through the app's existing font resolution. The live Mac preview and saved System Default setting were checked. Settings should consume the same shared family policy rather than maintaining a competing settings-only stack.

Keep interface sizes in stable logical pixels. Changing lyric text size must not enlarge the settings controls themselves. A preview reads the actual selected lyric font and size; control chrome follows the shared app font policy. Preserve the existing fallback behavior for optional fonts.

| Role | Size and line height | Weight | Treatment |
| --- | --- | --- | --- |
| Page title | 22 / 28 px | 700 | One title; app-like spacing; no subtitle |
| Group heading | 13 / 20 px | 600 | Sentence case, separated by space |
| Navigation label | 13 px | 400; selected 500 | Stable baseline and row height |
| Setting label | 13 / 18 px | 400 | Primary text, quieter than a heading |
| Select and current value | 12.5 / 16 px | 400 or 500 | Values align on the right |
| Help line | 11.5 / 15 px | 400 | Readable secondary tone, 3 px below label |
| Preview context label | 11.5 / 16 px | 500 | Secondary; does not compete with groups |
| Active preview lyric | 20 / 25 px | 700 | Sharp and dominant |
| Adjacent preview lyric | 16 / 20 px | 500 | Dimmer with controlled depth blur |
| Footer | 11.5 px | 400 | Quiet immediate-apply message |

Use weight, space, and contrast together; do not make every row bold. Do not use all-caps section labels, expansive tracking, marketing taglines, or a separate display face. Helpers should describe an effect or constraint, not repeat the label.

Keep the existing surface names and capitalization in navigation. Use Marquee in user-visible content; identifiers and persisted `island_*` keys remain unchanged. Use precise labels such as Background darkness, Text scale, and Click-through rather than inventing vague names.

## Color and materials

| Role | Reference value |
| --- | --- |
| Main base | `#171519` |
| Sidebar overlay | `rgba(10, 10, 13, 0.66)` |
| Primary text | `#F0F0F4` |
| Secondary help | `#ADADB7` |
| Quiet labels and footer | `#9797A3` |
| Control surface | `#29282E` |
| Selected segmented surface | `#46444D` |
| Separator | White at 8.5% opacity |
| Active accent | `#0A84FF` |
| Focus outline | `#77B6FF`, 2 px |
| Slider unfilled rail | `#49464F` |
| Slider thumb | `#E8E8ED` |

Use a quiet artwork-derived wash, strongest inside the preview and subdued under settings. The reference uses existing cover artwork with blur and a dark overlay. It does not establish burgundy as a permanent brand accent: the artwork changes with playback. If artwork is absent, retain a neutral dark base and a legible preview.

Prefer flat grouping and lightweight row separators. Do not reinstate raised group cards or add borders and shadows around every setting. Use elevation only where it explains a menu or a floating surface. Native material must respect the operating system's transparency preference.

The final visual package specifies the dark direction. A light treatment must use the same hierarchy and geometry with the real black wordmark, readable dark text, neutral controls, and the existing system theme policy. Light and high-transparency desktop states still require separate implementation QA; the dark screenshots do not prove them.

## Control specifications

### Selects

Theme is a compact select showing Dark in the reference. Its menu choices are System, Light, and Dark. System maps to the existing `auto` value; changing the display label does not migrate stored settings. Move this existing control from General to Appearance and show it only once.

Theme and Font align to the same right edge and use a nominal 180 x 27 px popup. Longer player and display options can use 246 px while respecting label space. Use real native-select semantics and the existing shared control implementation. Platform-native disclosure appearance can vary; do not add a custom radio treatment to achieve identical arrows.

The menu supports pointer and keyboard selection, Escape, focus return, and an accessible name. A closed select shows the complete selected value or an intentional truncation with an accessible full value. Keep loading and unavailable choices understandable instead of showing an empty field.

### Sliders

The visible rail is 3 px high. The thumb is a 16 x 9 px horizontal capsule, pearl colored, with a fine edge and a restrained local shadow. Ticks are 1 x 3 px below the rail, aligned to discrete stops. The full input hit area is at least 24 px high; the track's visual thickness is not its clickable height.

Slider controls use a consistent 300 px control region, with a flexible rail, a 14 px gap, and a 52 px trailing value area. Values use tabular numerals where appropriate. Numeric information is primary; a friendly size label can sit below it. The Text size reference shows 16 px above Medium.

Preserve the existing step arrays and snapping behavior. Tick positions follow the step index, not an invented linear interpolation of nonuniform values. Text size has six stops and selects the third at 40%; Background darkness has five stops and selects the fourth at 75%. Apply the same component treatment to all surface sliders.

Support Arrow keys, Home, End, an accessible name, and `aria-valuetext`. A change announces the actual setting value, not merely the internal step index. Keep the existing setting action and debouncing policy. Do not round and write an existing saved value on mount; Marquee width can have an intermediate value after direct resizing.

### Segmented choices

Lyric blur has four options: Off, Subtle, Standard, Strong. Map them to 0, 0.5, 1, and 1.5. Standard uses a lighter graphite segment, not a bright primary button. The control's visual container is approximately 28 px high, with 24 px button targets.

Keep segmented choices for short existing categories: Top or Bottom, alignment, and one or two lyric lines. Use one selected state with clear semantics. Do not use segmented choices for Theme. A keyboard user must be able to identify and change the selected choice without relying on color.

### Switches and color

Switches retain familiar off and on positions, a quiet gray off track, and system-blue on track. The visible switch is 32 x 18 px with a 14 px thumb, inside at least a 24 px high target. Row spacing gives it room to be operated comfortably.

The lyric color well is one compact native color input, approximately 32 x 24 px. It has an edge that remains visible when the selected color is white. Use the system color picker and existing color-setting action. Do not invent a curated palette or remove custom color selection.

### Actions and feedback

Secondary action buttons use a neutral popup-like surface and concise verbs. Preserve the existing clear-cache feedback sequence: Clear cache, Clearing, Cleared, or Couldn't clear. Prevent duplicate actions while pending. Forget remains quiet beside the remembered-player rule.

Update actions follow actual updater state. Checking and downloading disable duplicate checks; a ready update offers Restart to install; an unavailable build has an unavailable action and an accurate explanation. Use the current version from the host rather than the illustrative version shown in a mockup.

On a failed setting write, keep or restore the last confirmed state and show concise feedback near the relevant control through the existing action runner. The design does not add a global Save or Cancel flow.

## General page

Order groups as System, Storage, conditional Display, conditional Touch Bar, and Updates. General has no large preview and no title subtitle. Theme moves to Appearance.

| Setting or action | Control | Existing owner or behavior |
| --- | --- | --- |
| Battery saver | Switch | `behavior.battery_saver`; changes polling and visual-effect policy |
| Hide when paused | Switch | `behavior.hide_when_paused`; affects every Lyra window |
| Launch at login | Switch | Existing autostart action and actual OS result |
| Lyrics cache | Clear cache action | Existing cache action; cleared lyrics can be fetched again |
| Show on screen | Select | `preferred_monitor`; display only when more than one monitor is available |
| Show Lyra in the Control Strip | Switch | `touch_bar_control_strip`; hardware and capability gated |
| Updates | State-dependent action | Existing host updater state and version |

Hide Display when there is only one screen. Keep Primary (default) and actual monitor names and resolutions. Show Touch Bar only when the host reports it present. If its Control Strip route is unavailable, retain the existing disabled state and explanation. Do not use these illustrative hardware controls to claim support on every Mac.

## Appearance page

Order the compact preview, Theme row, Typography, and Background. The normal state fits inside the fixed frame. There is no subtitle under Appearance. Live preview labels the preview itself.

| Setting | Control and choices | State field |
| --- | --- | --- |
| Theme | Select: System, Light, Dark | `ui.theme`; System maps to `auto` |
| Font | Select: System Default, SF Pro Rounded, Inter, Monospace | `appearance.font_family` |
| Text size | Slider: 12, 14, 16, 18, 20, 24 px | `appearance.font_size` |
| Lyric color | Native color well | `appearance.text_color` |
| Background darkness | Slider: 0, 25, 50, 75, 100% | `appearance.background_opacity` |
| Lyric blur | Segmented: Off, Subtle, Standard, Strong | `appearance.lyric_blur` |

Keep the shared font option values and fallback behavior. Background darkness's help identifies Main Window and Marquee. Karaoke's own shade setting remains separate. Lyric blur softens surrounding lines; it must not blur the active line. Previews read current values without creating an independent appearance model.

## Players page

Order groups as Following, Now playing, and Remembered players. Preserve the difference between current playback sessions and previously seen apps. This page does not become an account or integration marketplace.

| Setting or action | Control | Existing route |
| --- | --- | --- |
| Player | Select: Whichever is playing or Only an actual known app | `setPinnedApp` |
| Only follow music | Switch | `setOnlyMusic` |
| Lyrics for browser media | Select: Ask, Look up lyrics, Don't look up | `behavior.browser_lyrics`: Ask, Allow, Deny |
| Current session details | Disclosure | Existing session, timing, classification, and capability data |
| Per-track music override | Existing action in session details | `setTrackOverride` |
| Remembered app rule | Select: Music only, Always follow, Never follow | `setAppRule`: Auto, Always, Never |
| Forget remembered player | Quiet feedback action | `forgetPlayer`; existing rule-removal semantics |

A session row leads with app and track, then its short status. Source branding remains monochrome. Keep capability and transport detail secondary behind the disclosure. Preserve pinning and override actions, the remembered-player rules, and their precedence. Do not make browser metadata lookup appear enabled merely because an app is detected.

Ask must preserve the existing one-time browser lookup consent flow. Explain the active choice accurately; the mock's Ask helper is not universal copy for Allow or Deny. Keep the existing loading and empty states, active or paused statuses, ignored-media reasons, and the Players page's existing 3-second refresh while visible. Add no playback polling loop.

## Main Window page

Order groups as Visibility, Window, and Lyrics. Preserve the existing control set; this page does not add another large preview merely to fill space.

| Setting | Control | State field |
| --- | --- | --- |
| Show Main Window | Switch | `ui.floating_visible` through existing visibility action |
| Show over full-screen apps | Switch | `ui.floating_show_on_fullscreen` |
| Hide when nothing is playing | Switch | `window.hide_when_idle` |
| Keep window on top | Switch | `window.always_on_top` |
| Click-through | Switch | `window.click_through` |
| Focus on current line | Switch | `behavior.karaoke_mode` |
| Text scale | Slider: 75%, Normal, 125%, 150%, 200% | `ui.floating_font_scale` |

Keep the on-top explanation that it does not apply while maximized or full screen. Keep Click-through's effect explicit. Text scale is relative to Appearance's base Text size. Visibility changes must continue to use the existing host visibility policy rather than local frontend assumptions.

## Marquee page

Keep a compact pinned preview above the scrollable groups: Visibility, Window, Layout, Background, and Cover art. The three reference states show the start, the full Layout group, and the lower controls. The title remains Marquee in every visible state.

| Setting or action | Control and choices | State field or action |
| --- | --- | --- |
| Show Marquee | Switch | `ui.island_visible` through existing visibility action |
| Show over full-screen apps | Switch | `ui.island_show_on_fullscreen` |
| Lock position | Switch | `ui.island_locked` |
| Click-through | Switch | `ui.island_click_through`; turns panel controls off |
| Position | Reset position action | Existing reset action |
| Size | Select: Match screen, Small, Medium, Large, Extra large | `ui.island_scale`; null means Match screen |
| Width | Slider: Narrow, Standard, Wide, Widest | `ui.island_base_width`; 450, 600, 750, 900 |
| Lines | Segmented: Current only, Current and next | `ui.island_lines`; 1 or 2 |
| Text scale | Shared five-step scale slider | `ui.island_font_scale` |
| Transparency | Slider: Solid, Low, Standard, High, Clear | `ui.island_transparency`; 0, .25, .5, .75, 1 |
| Show cover art | Switch | `ui.island_show_cover` |
| Circular | Switch, disabled without cover art | `ui.island_cover_circle` |
| Spin while playing | Switch, disabled without cover art | `ui.island_cover_spin` |

Size retains the existing scales: Small .85, Medium 1, Large 1.2, Extra large 1.4. Match screen may show the size currently selected by the host. Do not compute display-fitting, notch geometry, width limits, or cross-monitor scaling in this settings UI.

The production preview should continue to reuse real Marquee markup and state. Native Liquid Glass or HUD material remains host-owned; the browser reference cannot prove desktop-material behavior. Battery saver and Reduce Transparency keep their existing effect policy. Disabling cover art disables its shape and spin controls without deleting the saved preferences.

## Karaoke page

Keep its compact pinned preview above Visibility, Layout, and Text. The upper and lower reference states show all existing controls without squeezing them into an unreadable full-page form.

| Setting | Control and choices | State field |
| --- | --- | --- |
| Show Karaoke Lyrics | Switch | `ui.karaoke_visible` through existing visibility action |
| Show over full-screen apps | Switch | `ui.karaoke_show_on_fullscreen` |
| Position | Segmented: Top, Bottom | `ui.karaoke_position` |
| Distance from edge | Slider: None, Small, Medium, Large, Extra, Max | `ui.karaoke_offset_px`; 0, 24, 48, 72, 96, 120 |
| Width | Slider: 50, 60, 70, 80, 90, 100% | `ui.karaoke_width_pct` |
| Text scale | Shared five-step scale slider | `ui.karaoke_font_scale` |
| Alignment | Segmented: Left, Center, Right | `ui.karaoke_alignment` |
| Lines | Segmented: Current only, Current and next | `ui.karaoke_lines`; 1 or 2 |
| Bold lyrics | Switch | `ui.karaoke_bold` |
| Shade behind lyrics | Slider: None, 25, 50, 75% | `ui.karaoke_bg_opacity` |

The preview must represent the selected position, alignment, width, line count, text scale, weight, and shade. It should stay visible while lower controls are adjusted. The active line remains clear at every shade level. Do not substitute the shared background-darkness setting for this surface's independent shade control.

## State and interaction rules

Keep the existing settings hook and action runner as the command boundary. Shared controls receive state and invoke existing actions; they do not call player adapters or implement business policy. A new visual wrapper is not a new settings store.

- Initial load uses the existing skeleton and named sections; avoid a blank pane or placeholder values that look saved.
- A control's pending state prevents duplicate actions where needed. Failures remain understandable and retryable.
- Platform and capability gating come from the host. A disabled preference retains its label and explanation.
- Player details expand locally without changing playback. Ignored and paused sessions remain distinct from failures.
- Clearing cache and forgetting a player preserve their existing scope. Do not add unrelated reset actions.
- Category changes return the body to the top. Scrolling does not move the sidebar, page title, pinned preview, or footer.
- A preview uses real setting values. Production previews update through existing state/event delivery, not a new timer.
- Honor keyboard focus. Arrow, Home, End, Space, select menus, and Escape must use the appropriate control semantics.

The reference renderer lets native inputs, segments, disclosures, and navigation be inspected locally. It never calls Tauri, writes preferences, clears cache, controls playback, or installs an update. Production actions and live previews are separate implementation work.

## Accessibility and platform requirements

Use the existing `RowContext` and `useRowAria` naming and description patterns. Decorative icons have empty alt text; the wordmark has Lyra as its accessible name; navigation exposes the current page. A slider exposes its semantic value and a switch exposes its checked state. Disable actual controls, not only their opacity.

Target at least 4.5:1 contrast for normal text, 3:1 for qualifying large text, and 3:1 for essential control indicators against adjacent colors. Validate artwork-tinted states as well as flat token pairs. These requirements follow the [W3C contrast guidance](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html) and [non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Token calculations and visual inspection alone are not a complete accessibility audit.

Provide at least 24 px high interaction targets for compact controls, clear focus outlines, and readable hints. Keep focus from being hidden under pinned preview regions. Respect Reduce Motion, Reduce Transparency, and battery-saver settings. User-visible text must remain readable at increased system text size; a fixed-size settings window may need more internal scrolling rather than smaller type.

The supplied mockups are macOS dark references. Windows must retain its own caption controls, Segoe UI fallback, input behavior, and current platform selectors. Linux must use explicit Linux styling and its host behavior; it is not a macOS fallback. Preserve all four Lyra window surfaces. This design changes no player-support claim or adapter capability; [PLAYER_SUPPORT.md](../../PLAYER_SUPPORT.md) remains the authoritative support matrix.

## Implementation approach

Reuse the current settings architecture. The design package duplicates assets only as frozen documentation inputs; production should consume the real shared brand and icon sources.

| Existing location | Intended change |
| --- | --- |
| `views/settings/index.tsx` | Keep section switching and scrolling; title-only header; place compact previews above scrolling bodies where specified |
| `views/settings/components/nav.tsx` | Keep section IDs and groups; replace glyphs with the chosen real outline assets; add the real wordmark |
| `views/settings/settings.css` | Map hierarchy, spacing, flat rows, shared font, native-control treatment, and existing OS variants |
| `views/settings/components/body.tsx` | Move Theme to Appearance; use segmented Lyric blur; preserve the full current inventory and handlers |
| `components/settings-controls/select.tsx` | Reuse native select semantics and accessibility; align sizing |
| `components/settings-controls/snap-slider.tsx` | Keep step/value handling; refine track, thumb, ticks, focus, and target area |
| Shared Row, Toggle, Segmented, action feedback | Preserve labels, hints, state semantics, and action handling |
| `components/previews.tsx` | Reuse existing appearance state and real surface markup; preserve effect accuracy |
| `hooks/use-settings.ts` and command utilities | Preserve persistence, debounce keys, event updates, and command ownership |

Implement the shared shell and controls first, then Appearance, then apply the same system to the remaining pages. Keep changes surgical and preserve unrelated workspace work. Do not rename commands, migrate `island_*` keys, alter player policy, add a new backend, or change polling to achieve the visual redesign.

When production UI is implemented, add a user-facing Unreleased changelog entry in the same change. Run the appropriate frontend, contract, and browser checks and host checks if host behavior changes. No changelog or player-support update is required merely to publish this design document.

## Acceptance criteria

| Area | Observable acceptance |
| --- | --- |
| Header | Exactly one section title; no page-title subtitle or tagline |
| Brand | Real SVG wordmark, unchanged geometry and natural ratio |
| Font | Same desktop family policy; no website or independent settings font |
| Icons | One actual Regular outline family, monochrome, consistent size and baseline |
| Layout | 860 x 640 frame; no horizontal overflow; sidebar and footer stay visible |
| Appearance | All normal-state controls fit without body scrolling |
| Long pages | Every setting reachable; preview remains visible while scrolling Marquee and Karaoke |
| Theme | A select; System maps to auto; one placement in Appearance |
| Sliders | Correct stops, readable values, capsule thumb, thin rail, named keyboard-operable input |
| Dependencies | Cover shape and spin actually disabled when cover art is off |
| Conditional controls | Monitor and Touch Bar rows reflect host capabilities |
| States | Load, pending, empty, unavailable, and failure states do not imply a successful action |
| Preview | Uses confirmed settings and shows the correct surface effect |
| Accessibility | Names, descriptions, focus, contrast, keyboard and screen-reader checks pass |
| Platforms | Native chrome, platform styling, transparency and motion preferences preserved |
| Runtime | Existing events and command routes remain intact; no new playback polling |

The document reference has been browser-rendered and visually reviewed. Real Tauri commands, native desktop materials, screen-reader behavior, light mode, other OSes, hardware conditions, and live players remain implementation acceptance work. These limits are not evidence that the corresponding features fail.

## Research and owning sources

- [Apple settings guidance](https://developer.apple.com/design/human-interface-guidelines/settings) informed stable categories and contextual settings.
- [Apple slider guidance](https://developer.apple.com/design/human-interface-guidelines/sliders) informed the lozenge thumb, values, and discrete ticks.
- [Raycast settings](https://manual.raycast.com/settings) informed direct appearance controls and familiar preferences behavior.
- [Cal.com appearance reference](https://mobbin.com/screens/d5f4f721-9e90-431b-aebe-a220723d6547) and [Revolut Business appearance reference](https://mobbin.com/screens/d6ff3090-344e-4121-965a-3530f2ebe12b) informed restrained grouping and clearly visible choices.
- [Phosphor source assets](https://github.com/phosphor-icons/core) provide the chosen real outline family.
- [Desktop settings sources](../../../apps/desktop-tauri/src/views/settings/), [shared controls](../../../apps/desktop-tauri/src/components/settings-controls/), and [font resolution](../../../apps/desktop-tauri/src/utils/app-settings.ts) define the existing contracts and behavior.
- [Agent architecture reference](../../AGENT_ARCHITECTURE_REFERENCE.md), [player support](../../PLAYER_SUPPORT.md), and [brand masters](../../brand-explorations/2026-09-26-balance-manrope/README.md) provide the platform and asset constraints.

## Final mockup plates

The [gallery](MOCKUPS.md) includes General, Appearance, Players, Main Window, three Marquee views, two Karaoke views, and the conditional General hardware view. Each is a complete 2x capture of the same content frame. Continuation views intentionally show a different scroll position, not another page or a new setting category.

![Final Appearance mockup](mockups/02-appearance.jpg)
