# Bug Tracker

## Open Bugs

_(none)_

## Changelog

- **v1.4.0** (2026-09-02) — Reliability release: early Windows mutex prevents piled-up instances; initial prices fetch in the background; display waits for server health and auto-launches in a dedicated Chrome/Edge profile; playback starts automatically and muted; 15-second media-stall watchdog; failed playlists retry instead of stopping permanently; chart requests have browser/backend timeouts and cannot freeze the loop; Flask handles safe conditional/range media delivery; Windows Task Scheduler installer starts once at logon and restarts after failure; automated Linux tests and Windows package builds added
- **v1.3.1** (2026-04-03) — Build: build.bat reads VERSION file automatically, exe filename includes version (PreciousMetalsSignage-vX.Y.Z.exe), VERSION bundled into exe
- **v1.3.0** (2026-04-03) — Image slide support: playlist now accepts .jpg/.jpeg/.png/.webp/.gif alongside videos; images display fullscreen for a configurable duration (default 10s) then advance; admin shows video/image icons in playlist; new "Image display" duration slider in Display settings
- **v1.2.0** (2026-04-03) — Currency selector: added CAD/USD/EUR dropdown in admin Ticker settings; price fetcher now pulls EURUSD=X alongside CADUSD=X; prices table stores all three currencies; display ticker and chart slides render in the selected currency ($ for USD/CAD, € for EUR); chart data API returns all three price arrays per request
- **v1.1.0** (2026-04-03) — Smart monitor picker: replaced manual offset X/Y inputs with auto-detected monitor dropdown using `screeninfo`, added "Identify" button that flashes monitor numbers on all screens, settings now store monitor index instead of raw pixel offsets

## Fixed Bugs

- [x] **2026-09-02** — Hung/reopened application instances could pile up until Windows restarted *(fixed v1.4.0: OS mutex is acquired before heavyweight imports; scheduled task ignores duplicate starts)*
- [x] **2026-09-02** — Online chart request or a stalled decoder could stop the rotation indefinitely *(fixed v1.4.0: bounded requests, fail-safe chart dismissal, no-progress watchdog, automatic playlist retry)*
- [x] **2026-09-02** — Auto-start checkbox did not perform any startup action and every launch reset playback to stopped *(fixed v1.4.0: auto-launch is implemented, playback defaults to playing, Windows logon-task installer included)*
- [x] **2026-04-03** — Display sometimes shows "No videos loaded" when videos are in the playlist *(fixed v1.0.2: root causes — /api/playlist didn't check file existence, splash never updated for stopped-with-videos state, broken videos caused infinite error loop. Fix: backend adds `exists` flag, display filters out missing files, splash shows contextual messages, consecutive error tracking stops infinite loops, debug logging added throughout)*

- [x] **2026-04-03** — No "Add All Videos" button — Joey has 30+ videos, adding one by one is painful *(fixed v1.0.1: added POST /api/playlist/add-all endpoint + "Add All" button in admin)*
- [x] **2026-04-03** — Playlist card too long with many videos — needs scrollable list with max-height *(fixed v1.0.1: added max-height 400px with overflow-y scroll + video count badge in header)*
- [x] **2026-04-03** — Multiple instances can start on the same port — need to prevent duplicate launches *(fixed v1.0.1: socket check + lockfile guard on startup; second launch opens browser to admin and exits)*
