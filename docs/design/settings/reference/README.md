# Settings reference renderer

This folder renders static design references for the accompanying specification. It uses the actual desktop font stack, unchanged production wordmark, real Phosphor Regular icons, and existing cover and player-brand assets. It does not integrate with Tauri or write application state.

Serve this directory with any local static server and open `index.html`. Supported query parameters:

- `section=general|appearance|players|main|island|karaoke`
- `scale=1|2` for the fixed 860 x 640 logical content frame
- `scroll=layout|end` for continuation views
- `hardware=1` on General for the conditional monitor and Touch Bar example

Navigation and browser-native input controls are inspectable. Displayed values are illustrative. Action buttons do not perform the real cache, policy, updater, visibility, or persistence operations. The final documentation images are in `../mockups/`.

UI font resolution follows the real desktop app. The wordmark is outlined artwork and does not require its brand font to be installed. `assets/sources.json` records copied asset sources and hashes; `assets/PHOSPHOR-LICENSE.txt` accompanies the outline icon assets. Player-source paths were copied unchanged from the app's existing CC0 Simple Icons definitions.
