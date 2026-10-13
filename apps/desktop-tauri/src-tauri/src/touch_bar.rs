//! The Touch Bar on MacBook Pro models that have one: previous, play/pause
//! and next, then the line being sung with the next line dimmed after it.
//!
//! The bar belongs to the application (`NSApp.touchBar`), so it shows while a
//! Lyra window is active. Bars closer to the first responder nest inside it
//! through the other-items proxy (WebKit's typing suggestions in Settings).
//! Only the frontmost app's bar reaches the Touch Bar, so to show lyrics over
//! other apps Settings can add a Lyra button to the Control Strip that
//! presents a second copy of the bar system-modally. That uses undocumented
//! AppKit and DFRFoundation calls, looked up at run time; see `native`.
//! Items are native AppKit controls; the webviews are not involved.
//!
//! The poll loop hands every render to `sync`, which applies it on the main
//! thread only when something the bar shows has changed. Text changes at line
//! boundaries, never word by word: the bar sits in peripheral vision while
//! the user types, and motion there pulls the eye away from the screen. While
//! a bar is on screen it counts as a visible surface, so lyrics stay in time
//! even with every window hidden; the loop wakes as soon as a bar appears and
//! backs off when it goes.

use lyra_core::domain::{
    AppearanceSettings, LyricsStatus, NotFoundReason, PlaybackState, RenderSnapshot,
};

/// Shown for an instrumental break (an empty line in the lyrics).
const NOTE: &str = "♪";

/// Contrast every piece of text keeps against the Touch Bar's black: WCAG
/// AA for text this size.
const MIN_CONTRAST: f64 = 4.5;

/// The next line and status text are the lyric colour at this opacity range,
/// as faint as `MIN_CONTRAST` allows.
const AFTER_ALPHA: std::ops::RangeInclusive<f64> = 0.5..=0.75;

/// Everything the bar shows. Rebuilt on every tick; applied when it differs
/// from what is on the bar.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
struct Content {
    /// In the lyric colour: the current line, or the track's title.
    line: String,
    /// Dimmed after it: the next line, or what is happening with the lyrics.
    after: String,
    playing: bool,
    can_play_pause: bool,
    can_previous: bool,
    can_next: bool,
    /// Appearance → Font face, as the CSS font-family the windows use.
    font_family: String,
    /// Appearance → Lyric color, `#rrggbb`.
    text_color: String,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
impl Content {
    fn new(render: &RenderSnapshot, appearance: &AppearanceSettings) -> Self {
        let playback = &render.playback;
        let has_track = playback.track.is_some();
        let (line, after) = lines(render);
        Self {
            line,
            after,
            playing: playback.state == PlaybackState::Playing,
            can_play_pause: has_track && playback.caps.play_pause,
            can_previous: has_track && playback.caps.previous,
            can_next: has_track && playback.caps.next,
            font_family: appearance.font_family.clone(),
            text_color: appearance.text_color.clone(),
        }
    }
}

/// The two pieces of text: what is being sung and what comes next, or the
/// track and what is happening with its lyrics. Wording matches the
/// Marquee's compact placeholders.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn lines(render: &RenderSnapshot) -> (String, String) {
    let playback = &render.playback;
    let track = playback
        .track
        .as_ref()
        .filter(|_| playback.state != PlaybackState::Stopped);
    let Some(track) = track else {
        return (String::new(), "Waiting for playback".into());
    };
    let status = match &render.lyrics_status {
        LyricsStatus::Ready => return synced_lines(render, &track.title),
        LyricsStatus::Loading => "Loading lyrics",
        // Tapping the lyrics opens Lyra, where the main window asks.
        LyricsStatus::NotFound {
            reason: NotFoundReason::ConsentRequired,
        } => "Open Lyra to allow lyrics for browser media",
        LyricsStatus::NotFound {
            reason: NotFoundReason::NetworkError | NotFoundReason::RateLimit,
        }
        | LyricsStatus::Error(_) => "Lyrics unavailable",
        LyricsStatus::Unsynced | LyricsStatus::NotFound { .. } => "No synced lyrics",
    };
    (track.title.clone(), status.into())
}

/// The active line and the one after it. Before the first line the title
/// stands in, followed by the first line to come.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn synced_lines(render: &RenderSnapshot, title: &str) -> (String, String) {
    let visible = &render.visible_lines;
    let text = |line: &lyra_core::domain::VisibleLine| {
        let text = line.text.trim();
        if text.is_empty() { NOTE } else { text }.to_string()
    };
    match visible.iter().position(|line| line.is_active) {
        Some(active) => (
            text(&visible[active]),
            visible.get(active + 1).map(text).unwrap_or_default(),
        ),
        None => (
            title.to_string(),
            visible.first().map(text).unwrap_or_default(),
        ),
    }
}

/// The first family in a CSS font-family list, unquoted.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn first_family(css: &str) -> &str {
    css.split(',')
        .next()
        .unwrap_or_default()
        .trim()
        .trim_matches(|c| c == '\'' || c == '"')
}

/// `#rrggbb` (or `#rgb`) as sRGB components from 0 to 1.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_hex_color(hex: &str) -> Option<[f64; 3]> {
    let digits = hex.trim().strip_prefix('#')?;
    let expanded: String = match digits.len() {
        3 => digits.chars().flat_map(|c| [c, c]).collect(),
        6 => digits.to_string(),
        _ => return None,
    };
    let channel = |i: usize| {
        u8::from_str_radix(expanded.get(i..i + 2)?, 16)
            .ok()
            .map(|v| f64::from(v) / 255.0)
    };
    Some([channel(0)?, channel(2)?, channel(4)?])
}

/// WCAG contrast ratio of an sRGB colour against black.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn contrast_on_black(rgb: [f64; 3]) -> f64 {
    let linear = |c: f64| {
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let [r, g, b] = rgb.map(linear);
    (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05) / 0.05
}

/// How the bar draws Appearance → Lyric color on its black background.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
struct Palette {
    /// The current line: the lyric colour, mixed with just enough white to
    /// read on black when it is too dark (one picked for the light theme).
    line: [f64; 3],
    /// The next line and status text, with its opacity: the line colour
    /// dimmed, or a neutral white where dimming that colour can't stay
    /// legible.
    after: ([f64; 3], f64),
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
impl Palette {
    fn new(lyric_color: &str) -> Self {
        const WHITE: [f64; 3] = [1.0; 3];
        let base = parse_hex_color(lyric_color).unwrap_or(WHITE);
        let line = (0..=20)
            .map(|step| {
                let t = f64::from(step) / 20.0;
                base.map(|c| c + (1.0 - c) * t)
            })
            .find(|&rgb| contrast_on_black(rgb) >= MIN_CONTRAST)
            .unwrap_or(WHITE);
        let after = (0..)
            .map(|step| AFTER_ALPHA.start() + f64::from(step) * 0.05)
            .take_while(|alpha| AFTER_ALPHA.contains(alpha))
            .find(|&alpha| contrast_on_black(line.map(|c| c * alpha)) >= MIN_CONTRAST)
            .map(|alpha| (line, alpha))
            .unwrap_or((WHITE, *AFTER_ALPHA.start()));
        Self { line, after }
    }
}

/// Whether a Lyra bar can be seen. The app bar counts only while Lyra is the
/// active app: AppKit leaves its `visible` set after another app's bar
/// replaces it. Neither counts while nobody can see the Touch Bar (displays
/// asleep, screen locked, another user's session in front), so the poll loop
/// backs off as it does for hidden windows.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn bar_seen(display_on: bool, app_active: bool, app_bar: bool, strip_bar: bool) -> bool {
    display_on && ((app_active && app_bar) || strip_bar)
}

/// Whether this Mac has a Touch Bar, and whether Lyra can put a button in
/// its Control Strip. Settings shows the Touch Bar options only when the
/// first is true.
#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
pub struct Support {
    pub present: bool,
    pub control_strip: bool,
}

#[cfg(target_os = "macos")]
mod native {
    use super::{bar_seen, first_family, Content, Palette, Support};
    use lyra_core::domain::{AppearanceSettings, RenderSnapshot};
    use lyra_core::player::PlayerCommand;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool, NSObject, Sel};
    use objc2::{
        define_class, msg_send, sel, AllocAnyThread, ClassType, MainThreadMarker, MainThreadOnly,
    };
    use objc2_app_kit::{
        NSAccessibility, NSAccessibilityButtonRole, NSApplication,
        NSApplicationDidBecomeActiveNotification, NSApplicationDidResignActiveNotification,
        NSButton, NSButtonTouchBarItem, NSClickGestureRecognizer, NSColor, NSCustomTouchBarItem,
        NSFont, NSFontDescriptorSystemDesignRounded, NSFontWeightRegular, NSGestureRecognizer,
        NSImage, NSImageNameTouchBarPauseTemplate, NSImageNameTouchBarPlayTemplate,
        NSImageNameTouchBarSkipAheadTemplate, NSImageNameTouchBarSkipBackTemplate,
        NSLayoutConstraintOrientation, NSLineBreakMode, NSResponder, NSRunningApplication,
        NSStackView, NSTextField, NSTouchBar, NSTouchBarItem,
        NSTouchBarItemIdentifierFixedSpaceLarge, NSTouchBarItemIdentifierFixedSpaceSmall,
        NSTouchBarItemIdentifierFlexibleSpace, NSTouchBarItemIdentifierOtherItemsProxy,
        NSTouchTypeMask, NSView, NSWorkspace, NSWorkspaceDidActivateApplicationNotification,
        NSWorkspaceDidWakeNotification, NSWorkspaceScreensDidSleepNotification,
        NSWorkspaceScreensDidWakeNotification, NSWorkspaceSessionDidBecomeActiveNotification,
        NSWorkspaceSessionDidResignActiveNotification,
    };
    use objc2_foundation::{
        ns_string, NSArray, NSCopying, NSData, NSDistributedNotificationCenter,
        NSKeyValueObservingOptions, NSNotification, NSNotificationCenter,
        NSObjectNSKeyValueObserverRegistration, NSObjectProtocol, NSSet, NSSize, NSString,
    };
    use std::cell::{Cell, RefCell};
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Mutex, OnceLock};
    use tauri::{AppHandle, Manager};

    const PREVIOUS: &str = "app.lyralyrics.touchbar.previous";
    const PLAY_PAUSE: &str = "app.lyralyrics.touchbar.play-pause";
    const NEXT: &str = "app.lyralyrics.touchbar.next";
    const LYRICS: &str = "app.lyralyrics.touchbar.lyrics";
    const CONTROL_STRIP: &str = "app.lyralyrics.touchbar.control-strip";
    /// Where AppKit saves the user's arrangement of the app bar.
    const CUSTOMIZATION: &str = "app.lyralyrics.touchbar";

    /// The Control Strip process. It runs only on Macs with a Touch Bar, and
    /// forgets third-party buttons when it restarts.
    const CONTROL_STRIP_BUNDLE: &str = "com.apple.controlstrip";

    /// `presentSystemModalTouchBar:placement:…` placement that keeps the
    /// Control Strip on screen, so volume and brightness stay in reach. The
    /// system adds a close box at the bar's left.
    const BESIDE_CONTROL_STRIP: i64 = 0;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    /// A Lyra bar is on the Touch Bar now. Written on the main thread, read by
    /// the poll loop.
    static VISIBLE: AtomicBool = AtomicBool::new(false);
    /// What `sync` last sent to the main thread, so unchanged ticks don't
    /// touch AppKit.
    static SHOWN: Mutex<Option<Content>> = Mutex::new(None);

    thread_local! {
        /// AppKit objects live on the main thread only.
        static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    }

    struct State {
        /// Buttons, gesture recognizers and notification centers hold it
        /// weakly.
        target: Retained<Target>,
        /// `NSApp.touchBar`, shown while Lyra is the active app.
        app_bar: Bar,
        /// The Control Strip button and the bar it shows over other apps,
        /// while Settings asks for them.
        strip: Option<Strip>,
        /// What the bars show, so a bar built later starts up to date.
        content: Option<Content>,
        display: Display,
    }

    const SCREEN_LOCKED: &str = "com.apple.screenIsLocked";
    const SCREEN_UNLOCKED: &str = "com.apple.screenIsUnlocked";

    /// Whether anyone can see the Touch Bar, from workspace and screen-lock
    /// notifications. Lyra starts in an unlocked, awake session.
    #[derive(Default)]
    struct Display {
        asleep: Cell<bool>,
        locked: Cell<bool>,
        switched_out: Cell<bool>,
    }

    impl Display {
        fn on(&self) -> bool {
            !self.asleep.get() && !self.locked.get() && !self.switched_out.get()
        }

        fn note(&self, name: &NSString) {
            // SAFETY: AppKit notification names, valid for the life of the
            // process.
            let (sleep, wake, resign, become_active) = unsafe {
                (
                    NSWorkspaceScreensDidSleepNotification,
                    NSWorkspaceScreensDidWakeNotification,
                    NSWorkspaceSessionDidResignActiveNotification,
                    NSWorkspaceSessionDidBecomeActiveNotification,
                )
            };
            let is = |other: &NSString| name.isEqualToString(other);
            if is(sleep) || is(wake) {
                self.asleep.set(is(sleep));
            } else if is(resign) || is(become_active) {
                self.switched_out.set(is(resign));
            } else if is(&NSString::from_str(SCREEN_LOCKED)) {
                self.locked.set(true);
            } else if is(&NSString::from_str(SCREEN_UNLOCKED)) {
                self.locked.set(false);
            }
        }
    }

    struct Bar {
        bar: Retained<NSTouchBar>,
        previous: Retained<NSButtonTouchBarItem>,
        play_pause: Retained<NSButtonTouchBarItem>,
        next: Retained<NSButtonTouchBarItem>,
        lyrics: Retained<LyricsView>,
        line: Retained<NSTextField>,
        after: Retained<NSTextField>,
    }

    struct Strip {
        api: &'static ControlStripApi,
        button: Retained<NSCustomTouchBarItem>,
        bar: Bar,
        /// The Control Strip process the button was added to.
        host: Cell<Option<i32>>,
    }

    // ── Control Strip (undocumented) ────────────────────────────────────────
    //
    // Only the frontmost app's bar appears on the Touch Bar. To show lyrics
    // over other apps, Lyra adds a button to the Control Strip and presents
    // its bar system-modally when it is tapped, through undocumented AppKit
    // and DFRFoundation calls (the approach LyricsX, Pock and MTMR take).
    // Everything is looked up at run time, so if a macOS update removes a
    // call the option is unavailable instead of Lyra failing to launch.

    /// `void DFRElementSetControlStripPresenceForIdentifier(NSString *, BOOL)`
    type SetPresence = unsafe extern "C" fn(*const NSString, Bool);

    struct ControlStripApi {
        set_presence: SetPresence,
    }

    fn control_strip_api() -> Option<&'static ControlStripApi> {
        static API: OnceLock<Option<ControlStripApi>> = OnceLock::new();
        API.get_or_init(|| {
            let item_methods = [sel!(addSystemTrayItem:), sel!(removeSystemTrayItem:)];
            let bar_methods = [
                sel!(presentSystemModalTouchBar:placement:systemTrayItemIdentifier:),
                sel!(minimizeSystemModalTouchBar:),
                sel!(dismissSystemModalTouchBar:),
            ];
            let item_class = NSTouchBarItem::class().metaclass();
            let bar_class = NSTouchBar::class().metaclass();
            if !item_methods.into_iter().all(|s| item_class.responds_to(s))
                || !bar_methods.into_iter().all(|s| bar_class.responds_to(s))
            {
                log::warn!("Touch Bar: Control Strip calls are missing on this macOS");
                return None;
            }
            // SAFETY: a system framework path and symbol name; a missing
            // framework or symbol returns null, checked below.
            let symbol = unsafe {
                let framework = libc::dlopen(
                    c"/System/Library/PrivateFrameworks/DFRFoundation.framework/DFRFoundation"
                        .as_ptr(),
                    libc::RTLD_LAZY,
                );
                if framework.is_null() {
                    log::warn!("Touch Bar: DFRFoundation is missing on this macOS");
                    return None;
                }
                libc::dlsym(
                    framework,
                    c"DFRElementSetControlStripPresenceForIdentifier".as_ptr(),
                )
            };
            if symbol.is_null() {
                log::warn!("Touch Bar: Control Strip presence call is missing on this macOS");
                return None;
            }
            Some(ControlStripApi {
                // SAFETY: the symbol has this signature (DFRFoundation, as
                // declared by Pock and MTMR); the framework stays loaded.
                set_presence: unsafe { std::mem::transmute::<*mut c_void, SetPresence>(symbol) },
            })
        })
        .as_ref()
    }

    fn control_strip_pid() -> Option<i32> {
        NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(
            CONTROL_STRIP_BUNDLE,
        ))
        .firstObject()
        .map(|app| app.processIdentifier())
    }

    impl Strip {
        /// Put the button in the Control Strip, adding it again if the
        /// Control Strip restarted since it was added. Safe to repeat.
        fn assert_presence(&self) {
            let pid = control_strip_pid();
            if pid != self.host.get() {
                let item: &NSTouchBarItem = &self.button;
                // SAFETY: the selectors were checked in `control_strip_api`
                // and take an NSTouchBarItem; removing an unknown item is a
                // no-op.
                unsafe {
                    let _: () = msg_send![NSTouchBarItem::class(), removeSystemTrayItem: item];
                    let _: () = msg_send![NSTouchBarItem::class(), addSystemTrayItem: item];
                }
                self.host.set(pid);
            }
            // SAFETY: the function was resolved in `control_strip_api`.
            unsafe { (self.api.set_presence)(&*NSString::from_str(CONTROL_STRIP), Bool::YES) };
        }

        fn toggle(&self) {
            let bar: &NSTouchBar = &self.bar.bar;
            // SAFETY: the selectors were checked in `control_strip_api` and
            // take the bar (and a placement and the button's identifier).
            unsafe {
                if bar.isVisible() {
                    let _: () = msg_send![NSTouchBar::class(), minimizeSystemModalTouchBar: bar];
                } else {
                    let id = NSString::from_str(CONTROL_STRIP);
                    let _: () = msg_send![
                        NSTouchBar::class(),
                        presentSystemModalTouchBar: bar,
                        placement: BESIDE_CONTROL_STRIP,
                        systemTrayItemIdentifier: &*id
                    ];
                }
            }
        }

        fn remove(self, target: &Target) {
            let bar: &NSTouchBar = &self.bar.bar;
            let item: &NSTouchBarItem = &self.button;
            // SAFETY: as in `assert_presence` and `toggle`; dismissing a bar
            // that is not presented is a no-op. The observer was added in
            // `enable_control_strip`.
            unsafe {
                let _: () = msg_send![NSTouchBar::class(), dismissSystemModalTouchBar: bar];
                (self.api.set_presence)(&*NSString::from_str(CONTROL_STRIP), Bool::NO);
                let _: () = msg_send![NSTouchBarItem::class(), removeSystemTrayItem: item];
                bar.removeObserver_forKeyPath(target, ns_string!("visible"));
            }
        }
    }

    // ── Callbacks ───────────────────────────────────────────────────────────

    define_class!(
        /// Receives taps, bar visibility changes and the notifications that
        /// can make the Control Strip drop Lyra's button.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "LyraTouchBarTarget"]
        struct Target;

        unsafe impl NSObjectProtocol for Target {}

        impl Target {
            #[unsafe(method(previousTrack:))]
            fn previous_track(&self, _sender: Option<&AnyObject>) {
                send(PlayerCommand::Previous);
            }

            #[unsafe(method(playPause:))]
            fn play_pause(&self, _sender: Option<&AnyObject>) {
                send(PlayerCommand::PlayPause);
            }

            #[unsafe(method(nextTrack:))]
            fn next_track(&self, _sender: Option<&AnyObject>) {
                send(PlayerCommand::Next);
            }

            #[unsafe(method(openLyra:))]
            fn open_lyra_tapped(&self, _sender: Option<&AnyObject>) {
                open_lyra();
            }

            #[unsafe(method(toggleLyrics:))]
            fn toggle_lyrics(&self, _sender: Option<&AnyObject>) {
                with_state(|state| {
                    if let Some(strip) = &state.strip {
                        strip.toggle();
                    }
                });
                refresh_visibility(self.mtm());
            }

            #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
            fn observe_value(
                &self,
                _key_path: Option<&NSString>,
                _object: Option<&AnyObject>,
                _change: Option<&AnyObject>,
                _context: *mut c_void,
            ) {
                refresh_visibility(self.mtm());
            }

            #[unsafe(method(activeChanged:))]
            fn active_changed(&self, _notification: &NSNotification) {
                refresh_visibility(self.mtm());
            }

            /// Displays slept or woke, the screen locked or unlocked, or the
            /// user switched sessions.
            #[unsafe(method(displayChanged:))]
            fn display_changed(&self, notification: &NSNotification) {
                with_state(|state| state.display.note(&notification.name()));
                refresh_visibility(self.mtm());
            }

            /// Another app came forward, the Mac woke or the screen unlocked:
            /// moments the Control Strip has been seen to drop the button.
            #[unsafe(method(controlStripMayHaveReset:))]
            fn control_strip_may_have_reset(&self, _notification: &NSNotification) {
                with_state(|state| {
                    if let Some(strip) = &state.strip {
                        strip.assert_presence();
                    }
                });
            }
        }
    );

    define_class!(
        /// The lyrics: the two labels side by side, opening Lyra when
        /// tapped. VoiceOver reads it as one button and presses it here,
        /// since it can't trigger the tap gesture.
        #[unsafe(super(NSStackView, NSView, NSResponder, NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "LyraTouchBarLyricsView"]
        struct LyricsView;

        unsafe impl NSObjectProtocol for LyricsView {}

        impl LyricsView {
            #[unsafe(method(accessibilityPerformPress))]
            fn accessibility_perform_press(&self) -> bool {
                open_lyra();
                true
            }
        }
    );

    fn open_lyra() {
        if let Some(app) = APP.get() {
            crate::tray::open_lyra(app);
        }
    }

    fn send(command: PlayerCommand) {
        if let Some(app) = APP.get() {
            crate::tray::send_command(app, command);
        }
    }

    /// Read the state without panicking when AppKit calls back while it is
    /// being changed; callers refresh afterwards.
    fn with_state<R>(f: impl FnOnce(&State) -> R) -> Option<R> {
        STATE.with(|state| state.try_borrow().ok()?.as_ref().map(f))
    }

    /// Record whether a Lyra bar can be seen (see `bar_seen`). Appearing
    /// clears what was last applied and polls now, so the bar never waits out
    /// a hidden-surface backoff with stale text.
    fn refresh_visibility(mtm: MainThreadMarker) {
        let active = NSApplication::sharedApplication(mtm).isActive();
        let Some(visible) = with_state(|state| {
            bar_seen(
                state.display.on(),
                active,
                state.app_bar.bar.isVisible(),
                state.strip.as_ref().is_some_and(|s| s.bar.bar.isVisible()),
            )
        }) else {
            return;
        };
        if VISIBLE.swap(visible, Ordering::AcqRel) == visible {
            return;
        }
        log::info!("Touch Bar {}", if visible { "shown" } else { "hidden" });
        if !visible {
            return;
        }
        if let Ok(mut shown) = SHOWN.lock() {
            *shown = None;
        }
        if let Some(state) = APP.get().and_then(|app| app.try_state::<crate::AppState>()) {
            state.poll.request_poll();
        }
    }

    // ── Public interface ────────────────────────────────────────────────────

    /// Whether a Lyra bar is on the Touch Bar, so the poll loop treats it as
    /// a visible surface.
    pub fn is_visible() -> bool {
        VISIBLE.load(Ordering::Acquire)
    }

    pub fn support() -> Support {
        Support {
            present: control_strip_pid().is_some(),
            control_strip: control_strip_api().is_some(),
        }
    }

    /// Give Lyra its Touch Bar, and its Control Strip button when Settings
    /// asks for it. Call once on the main thread.
    pub fn install(app: &AppHandle, control_strip: bool) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let _ = APP.set(app.clone());
        // SAFETY: `init` is NSObject's designated initialiser.
        let target: Retained<Target> = unsafe { msg_send![Target::alloc(mtm), init] };
        let app_bar = build_bar(mtm, &target);
        make_customizable(&app_bar.bar);
        NSApplication::sharedApplication(mtm).setTouchBar(Some(&app_bar.bar));
        observe(mtm, &target, &app_bar.bar);
        STATE.set(Some(State {
            target,
            app_bar,
            strip: None,
            content: None,
            display: Display::default(),
        }));
        if control_strip {
            enable_control_strip(mtm);
        }
        refresh_visibility(mtm);
    }

    /// Add or remove the Control Strip button (Settings → General).
    pub fn set_control_strip(app: &AppHandle, enabled: bool) {
        let _ = app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            if enabled {
                enable_control_strip(mtm);
            } else {
                disable_control_strip();
            }
            refresh_visibility(mtm);
        });
    }

    /// Open or close AppKit's palette for arranging the app bar (View →
    /// Customize Touch Bar…).
    pub fn customize(app: &AppHandle) {
        let _ = app.run_on_main_thread(|| {
            if let Some(mtm) = MainThreadMarker::new() {
                // SAFETY: NSApplication's own action; a nil sender is allowed.
                unsafe {
                    NSApplication::sharedApplication(mtm).toggleTouchBarCustomizationPalette(None)
                };
            }
        });
    }

    /// Take the button out of the Control Strip as Lyra quits.
    pub fn shutdown() {
        disable_control_strip();
    }

    /// Bring the bars up to date with a render. Cheap when nothing they show
    /// changed or none is on screen; called from the poll loop.
    pub fn sync(app: &AppHandle, render: &RenderSnapshot, appearance: &AppearanceSettings) {
        if !is_visible() {
            return;
        }
        let content = Content::new(render, appearance);
        {
            let Ok(mut shown) = SHOWN.lock() else {
                return;
            };
            if shown.as_ref() == Some(&content) {
                return;
            }
            *shown = Some(content.clone());
        }
        let _ = app.run_on_main_thread(move || {
            with_state(|state| {
                apply(&state.app_bar, &content);
                if let Some(strip) = &state.strip {
                    apply(&strip.bar, &content);
                }
            });
            STATE.with_borrow_mut(|state| {
                if let Some(state) = state {
                    state.content = Some(content);
                }
            });
        });
    }

    // ── Building and updating ───────────────────────────────────────────────

    fn enable_control_strip(mtm: MainThreadMarker) {
        let Some(api) = control_strip_api() else {
            return;
        };
        let Some((target, content)) = with_state(|state| {
            state
                .strip
                .is_none()
                .then(|| (state.target.clone(), state.content.clone()))
        })
        .flatten() else {
            return;
        };
        let bar = build_bar(mtm, &target);
        if let Some(content) = &content {
            apply(&bar, content);
        }
        observe_visibility(&bar.bar, &target);
        let strip = Strip {
            api,
            button: control_strip_button(mtm, &target),
            bar,
            host: Cell::new(None),
        };
        strip.assert_presence();
        STATE.with_borrow_mut(|state| {
            if let Some(state) = state {
                state.strip = Some(strip);
            }
        });
    }

    fn disable_control_strip() {
        let removed = STATE.with_borrow_mut(|state| {
            let state = state.as_mut()?;
            Some((state.strip.take()?, state.target.clone()))
        });
        if let Some((strip, target)) = removed {
            strip.remove(&target);
        }
    }

    /// Lyra's glyph (the menu-bar icon) on a Control Strip button.
    fn control_strip_button(
        mtm: MainThreadMarker,
        target: &Target,
    ) -> Retained<NSCustomTouchBarItem> {
        let data = NSData::with_bytes(include_bytes!("../icons/tray-template.png"));
        let image = NSImage::initWithData(NSImage::alloc(), &data).unwrap_or_default();
        image.setTemplate(true);
        // 36 px at 2x: the Touch Bar's ideal size for a custom icon.
        image.setSize(NSSize::new(18.0, 18.0));
        image.setAccessibilityDescription(Some(ns_string!("Lyra lyrics")));
        let target_object: &AnyObject = target;
        // SAFETY: the target implements `toggleLyrics:`.
        let button = unsafe {
            NSButton::buttonWithImage_target_action(
                &image,
                Some(target_object),
                Some(sel!(toggleLyrics:)),
                mtm,
            )
        };
        let item = NSCustomTouchBarItem::initWithIdentifier(
            NSCustomTouchBarItem::alloc(mtm),
            &NSString::from_str(CONTROL_STRIP),
        );
        item.setView(&button);
        item.setCustomizationLabel(Some(ns_string!("Lyra")));
        item
    }

    fn observe(mtm: MainThreadMarker, target: &Target, app_bar: &NSTouchBar) {
        observe_visibility(app_bar, target);
        let observer: &AnyObject = target;
        let application = NSApplication::sharedApplication(mtm);
        let application: &AnyObject = &application;
        // SAFETY: the target implements each selector, taking the
        // notification, and lives for the rest of the process, so it is
        // never removed.
        unsafe {
            let center = NSNotificationCenter::defaultCenter();
            for name in [
                NSApplicationDidBecomeActiveNotification,
                NSApplicationDidResignActiveNotification,
            ] {
                center.addObserver_selector_name_object(
                    observer,
                    sel!(activeChanged:),
                    Some(name),
                    Some(application),
                );
            }
            let workspace = NSWorkspace::sharedWorkspace().notificationCenter();
            for name in [
                NSWorkspaceDidActivateApplicationNotification,
                NSWorkspaceDidWakeNotification,
            ] {
                workspace.addObserver_selector_name_object(
                    observer,
                    sel!(controlStripMayHaveReset:),
                    Some(name),
                    None,
                );
            }
            for name in [
                NSWorkspaceScreensDidSleepNotification,
                NSWorkspaceScreensDidWakeNotification,
                NSWorkspaceSessionDidResignActiveNotification,
                NSWorkspaceSessionDidBecomeActiveNotification,
            ] {
                workspace.addObserver_selector_name_object(
                    observer,
                    sel!(displayChanged:),
                    Some(name),
                    None,
                );
            }
            let distributed = NSDistributedNotificationCenter::defaultCenter();
            let (locked, unlocked) = (
                NSString::from_str(SCREEN_LOCKED),
                NSString::from_str(SCREEN_UNLOCKED),
            );
            for name in [&locked, &unlocked] {
                distributed.addObserver_selector_name_object(
                    observer,
                    sel!(displayChanged:),
                    Some(name),
                    None,
                );
            }
            distributed.addObserver_selector_name_object(
                observer,
                sel!(controlStripMayHaveReset:),
                Some(&unlocked),
                None,
            );
        }
    }

    /// Let people rearrange the app bar or drop items from it. Not the
    /// Control Strip bar: a customizable system-modal bar has been reported
    /// to ignore its default items.
    fn make_customizable(bar: &NSTouchBar) {
        bar.setCustomizationIdentifier(Some(&NSString::from_str(CUSTOMIZATION)));
        // SAFETY: AppKit constants, valid for the life of the process.
        let spaces = unsafe {
            [
                NSTouchBarItemIdentifierFixedSpaceSmall,
                NSTouchBarItemIdentifierFixedSpaceLarge,
                NSTouchBarItemIdentifierFlexibleSpace,
            ]
        };
        let allowed: Vec<Retained<NSString>> = [PREVIOUS, PLAY_PAUSE, NEXT, LYRICS]
            .into_iter()
            .map(NSString::from_str)
            .chain(spaces.into_iter().map(|space| space.copy()))
            .collect();
        bar.setCustomizationAllowedItemIdentifiers(&NSArray::from_retained_slice(&allowed));
    }

    fn observe_visibility(bar: &NSTouchBar, target: &Target) {
        let observer: &NSObject = target;
        // SAFETY: the target implements the observer callback and outlives
        // the bar's observation: the app bar's lasts for the process, and the
        // Control Strip bar's is removed in `Strip::remove`.
        unsafe {
            bar.addObserver_forKeyPath_options_context(
                observer,
                ns_string!("visible"),
                NSKeyValueObservingOptions::New,
                std::ptr::null_mut(),
            );
        }
    }

    fn build_bar(mtm: MainThreadMarker, target: &Target) -> Bar {
        let target_object: &AnyObject = target;
        let button = |id: &str, image: &NSString, label: &str, action: Sel| {
            let image = NSImage::imageNamed(image).unwrap_or_default();
            // SAFETY: the target implements `action`.
            let item = unsafe {
                NSButtonTouchBarItem::buttonTouchBarItemWithIdentifier_image_target_action(
                    &NSString::from_str(id),
                    &image,
                    Some(target_object),
                    Some(action),
                    mtm,
                )
            };
            item.setCustomizationLabel(Some(&NSString::from_str(label)));
            item
        };
        // SAFETY: AppKit image-name constants, valid for the life of the process.
        let (skip_back, play, skip_ahead) = unsafe {
            (
                NSImageNameTouchBarSkipBackTemplate,
                NSImageNameTouchBarPlayTemplate,
                NSImageNameTouchBarSkipAheadTemplate,
            )
        };
        let previous = button(PREVIOUS, skip_back, "Previous Track", sel!(previousTrack:));
        let play_pause = button(PLAY_PAUSE, play, "Play/Pause", sel!(playPause:));
        let next = button(NEXT, skip_ahead, "Next Track", sel!(nextTrack:));

        let label = || {
            let label = NSTextField::labelWithString(ns_string!(""), mtm);
            label.setLineBreakMode(NSLineBreakMode::ByTruncatingTail);
            // Squeeze the letters a little before cutting off the end of a
            // long line.
            label.setAllowsDefaultTighteningForTruncation(true);
            // VoiceOver reads them through the lyrics button.
            label.setAccessibilityElement(false);
            label
        };
        let line = label();
        let after = label();
        // Out of room, the next line gives way first, then the current one;
        // the buttons (750) never do.
        after.setContentCompressionResistancePriority_forOrientation(
            100.0,
            NSLayoutConstraintOrientation::Horizontal,
        );
        line.setContentCompressionResistancePriority_forOrientation(
            200.0,
            NSLayoutConstraintOrientation::Horizontal,
        );
        let views: [&NSView; 2] = [&line, &after];
        let views = NSArray::from_slice(&views);
        // SAFETY: the class method returns an instance of the class it is
        // sent to, here the NSStackView subclass.
        let stack: Retained<LyricsView> =
            unsafe { msg_send![LyricsView::class(), stackViewWithViews: &*views] };
        stack.setSpacing(20.0);
        stack.setAccessibilityElement(true);
        // SAFETY: an AppKit constant, valid for the life of the process.
        stack.setAccessibilityRole(Some(unsafe { NSAccessibilityButtonRole }));
        stack.setAccessibilityHelp(Some(ns_string!("Opens Lyra")));
        // Fill the rest of the bar, so a tap anywhere right of the buttons
        // opens Lyra.
        stack.setHuggingPriority_forOrientation(1.0, NSLayoutConstraintOrientation::Horizontal);
        // SAFETY: the target implements `openLyra:`.
        let tap = unsafe {
            NSClickGestureRecognizer::initWithTarget_action(
                NSClickGestureRecognizer::alloc(mtm),
                Some(target_object),
                Some(sel!(openLyra:)),
            )
        };
        tap.setAllowedTouchTypes(NSTouchTypeMask::Direct);
        let tap: &NSGestureRecognizer = &tap;
        stack.addGestureRecognizer(tap);
        let lyrics = NSCustomTouchBarItem::initWithIdentifier(
            NSCustomTouchBarItem::alloc(mtm),
            &NSString::from_str(LYRICS),
        );
        lyrics.setView(&stack);
        lyrics.setCustomizationLabel(Some(ns_string!("Lyrics")));

        let bar = NSTouchBar::new(mtm);
        let items: [&NSTouchBarItem; 4] = [&previous, &play_pause, &next, &lyrics];
        bar.setTemplateItems(&NSSet::from_slice(&items));
        // SAFETY: AppKit constants, valid for the life of the process.
        let (gap, others) = unsafe {
            (
                NSTouchBarItemIdentifierFixedSpaceLarge,
                NSTouchBarItemIdentifierOtherItemsProxy,
            )
        };
        // The proxy nests bars from closer to the first responder (WebKit's
        // typing suggestions in Settings) instead of letting them replace
        // this one.
        let ids = [
            NSString::from_str(PREVIOUS),
            NSString::from_str(PLAY_PAUSE),
            NSString::from_str(NEXT),
            gap.copy(),
            NSString::from_str(LYRICS),
            others.copy(),
        ];
        bar.setDefaultItemIdentifiers(&NSArray::from_retained_slice(&ids));

        Bar {
            bar,
            previous,
            play_pause,
            next,
            lyrics: stack,
            line,
            after,
        }
    }

    fn apply(bar: &Bar, content: &Content) {
        let font = font(&content.font_family);
        let palette = Palette::new(&content.text_color);
        let [red, green, blue] = palette.line;
        let color = NSColor::colorWithSRGBRed_green_blue_alpha(red, green, blue, 1.0);
        let ([red, green, blue], alpha) = palette.after;
        let dim = NSColor::colorWithSRGBRed_green_blue_alpha(red, green, blue, alpha);

        bar.line.setStringValue(&NSString::from_str(&content.line));
        bar.line.setHidden(content.line.is_empty());
        bar.line.setFont(Some(&font));
        bar.line.setTextColor(Some(&color));
        bar.after
            .setStringValue(&NSString::from_str(&content.after));
        bar.after.setHidden(content.after.is_empty());
        bar.after.setFont(Some(&font));
        bar.after.setTextColor(Some(&dim));
        let spoken = [content.line.as_str(), content.after.as_str()]
            .into_iter()
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
        bar.lyrics
            .setAccessibilityLabel(Some(&NSString::from_str(&spoken)));

        // SAFETY: AppKit image-name constants, valid for the life of the process.
        let image = unsafe {
            if content.playing {
                NSImageNameTouchBarPauseTemplate
            } else {
                NSImageNameTouchBarPlayTemplate
            }
        };
        bar.play_pause
            .setImage(NSImage::imageNamed(image).as_deref());
        bar.play_pause.setEnabled(content.can_play_pause);
        bar.previous.setEnabled(content.can_previous);
        bar.next.setEnabled(content.can_next);
    }

    /// Appearance → Font face at the size AppKit gives Touch Bar labels.
    fn font(css_family: &str) -> Retained<NSFont> {
        let size = NSFont::systemFontSize();
        let system = || NSFont::systemFontOfSize(size);
        match first_family(css_family) {
            "" | "system-ui" | "-apple-system" | "sans-serif" => system(),
            // SAFETY: an AppKit constant, valid for the life of the process.
            "monospace" => {
                NSFont::monospacedSystemFontOfSize_weight(size, unsafe { NSFontWeightRegular })
            }
            "SF Pro Rounded" => {
                // SAFETY: an AppKit constant, valid for the life of the process.
                let design = unsafe { NSFontDescriptorSystemDesignRounded };
                system()
                    .fontDescriptor()
                    .fontDescriptorWithDesign(design)
                    .and_then(|rounded| NSFont::fontWithDescriptor_size(&rounded, size))
                    .unwrap_or_else(system)
            }
            name => {
                NSFont::fontWithName_size(&NSString::from_str(name), size).unwrap_or_else(system)
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub use native::{customize, install, is_visible, set_control_strip, shutdown, support, sync};

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &tauri::AppHandle, _control_strip: bool) {}

#[cfg(not(target_os = "macos"))]
pub fn is_visible() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn support() -> Support {
    Support::default()
}

#[cfg(not(target_os = "macos"))]
pub fn set_control_strip(_app: &tauri::AppHandle, _enabled: bool) {}

#[cfg(not(target_os = "macos"))]
pub fn shutdown() {}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub fn customize(_app: &tauri::AppHandle) {}

#[cfg(not(target_os = "macos"))]
pub fn sync(_app: &tauri::AppHandle, _render: &RenderSnapshot, _appearance: &AppearanceSettings) {}

#[cfg(test)]
mod tests {
    use super::*;
    use lyra_core::domain::{
        MediaKind, PlaybackCaps, PlaybackSnapshot, PlayerApp, TrackRef, Transport, VisibleLine,
    };

    fn track() -> TrackRef {
        TrackRef {
            player: PlayerApp {
                id: "com.spotify.client".into(),
                name: "Spotify".into(),
            },
            transport: Transport::AppleScript,
            uri: "spotify:track:t".into(),
            native_id: None,
            file_path: None,
            from_browser: false,
            platform: None,
            kind: MediaKind::Music,
            page_url: None,
            title: "Blinding Lights".into(),
            artist: "The Weeknd".into(),
            album: None,
            duration_ms: 200_000,
            artwork_url: None,
        }
    }

    fn render(
        state: PlaybackState,
        status: LyricsStatus,
        lines: &[(&str, bool)],
    ) -> RenderSnapshot {
        RenderSnapshot {
            playback: PlaybackSnapshot {
                state,
                track: Some(track()),
                caps: PlaybackCaps::ALL,
                ..PlaybackSnapshot::stopped(0)
            },
            lyrics_status: status,
            active_line_index: lines.iter().position(|(_, active)| *active),
            line_progress: None,
            visible_lines: lines
                .iter()
                .enumerate()
                .map(|(index, (text, is_active))| VisibleLine {
                    index,
                    text: (*text).into(),
                    is_active: *is_active,
                })
                .collect(),
            active_line_words: None,
        }
    }

    fn texts(render: &RenderSnapshot) -> (String, String) {
        lines(render)
    }

    #[test]
    fn shows_the_active_line_then_the_next() {
        let r = render(
            PlaybackState::Playing,
            LyricsStatus::Ready,
            &[("I said, ooh", true), ("I'm blinded by the lights", false)],
        );
        assert_eq!(
            texts(&r),
            ("I said, ooh".into(), "I'm blinded by the lights".into())
        );
    }

    #[test]
    fn shows_the_title_before_the_first_line() {
        let r = render(
            PlaybackState::Playing,
            LyricsStatus::Ready,
            &[("Yeah", false), ("I've been tryna call", false)],
        );
        assert_eq!(texts(&r), ("Blinding Lights".into(), "Yeah".into()));
    }

    #[test]
    fn marks_instrumental_breaks_with_a_note() {
        let r = render(
            PlaybackState::Playing,
            LyricsStatus::Ready,
            &[("", true), ("  ", false)],
        );
        assert_eq!(texts(&r), (NOTE.into(), NOTE.into()));
    }

    #[test]
    fn last_line_has_nothing_after_it() {
        let r = render(
            PlaybackState::Playing,
            LyricsStatus::Ready,
            &[("Bye", true)],
        );
        assert_eq!(texts(&r), ("Bye".into(), String::new()));
    }

    #[test]
    fn names_the_track_and_the_lyric_status() {
        let cases = [
            (LyricsStatus::Loading, "Loading lyrics"),
            (LyricsStatus::Unsynced, "No synced lyrics"),
            (
                LyricsStatus::NotFound {
                    reason: NotFoundReason::Miss,
                },
                "No synced lyrics",
            ),
            (
                LyricsStatus::NotFound {
                    reason: NotFoundReason::RateLimit,
                },
                "Lyrics unavailable",
            ),
            (LyricsStatus::Error("offline".into()), "Lyrics unavailable"),
            (
                LyricsStatus::NotFound {
                    reason: NotFoundReason::ConsentRequired,
                },
                "Open Lyra to allow lyrics for browser media",
            ),
        ];
        for (status, after) in cases {
            let r = render(PlaybackState::Playing, status, &[]);
            assert_eq!(texts(&r), ("Blinding Lights".into(), after.into()));
        }
    }

    #[test]
    fn waits_when_nothing_is_playing() {
        let mut r = render(PlaybackState::Stopped, LyricsStatus::Ready, &[("Hi", true)]);
        assert_eq!(texts(&r), (String::new(), "Waiting for playback".into()));
        r.playback.track = None;
        r.playback.state = PlaybackState::Paused;
        assert_eq!(texts(&r), (String::new(), "Waiting for playback".into()));
    }

    #[test]
    fn controls_follow_the_player_caps() {
        let mut r = render(PlaybackState::Paused, LyricsStatus::Loading, &[]);
        r.playback.caps = PlaybackCaps {
            next: false,
            ..PlaybackCaps::ALL
        };
        let content = Content::new(&r, &AppearanceSettings::default());
        assert!(!content.playing);
        assert!(content.can_play_pause && content.can_previous && !content.can_next);

        r.playback.track = None;
        let content = Content::new(&r, &AppearanceSettings::default());
        assert!(!content.can_play_pause && !content.can_previous && !content.can_next);
    }

    #[test]
    fn keeps_a_lyric_colour_that_reads_on_black() {
        let white = Palette::new("#ffffff");
        assert_eq!(white.line, [1.0, 1.0, 1.0]);
        assert_eq!(white.after, ([1.0, 1.0, 1.0], 0.5));
        // Pure red is legible at full strength but not dimmed.
        let red = Palette::new("#ff0000");
        assert_eq!(red.line, [1.0, 0.0, 0.0]);
        assert_eq!(red.after, ([1.0, 1.0, 1.0], 0.5));
    }

    #[test]
    fn lightens_a_lyric_colour_too_dark_for_black() {
        let navy = Palette::new("#1a237e");
        assert_ne!(navy.line, parse_hex_color("#1a237e").unwrap());
        // Still blue, not replaced by white.
        assert!(navy.line[2] > navy.line[0]);
    }

    #[test]
    fn all_text_stays_legible_on_black() {
        for color in [
            "#ffffff",
            "#000000",
            "#777777",
            "#ff0000",
            "#00ff00",
            "#1a237e",
            "#ffd700",
            "#8b4513",
            "not a colour",
        ] {
            let palette = Palette::new(color);
            assert!(
                contrast_on_black(palette.line) >= MIN_CONTRAST,
                "{color} line"
            );
            let (rgb, alpha) = palette.after;
            assert!(AFTER_ALPHA.contains(&alpha), "{color} alpha {alpha}");
            assert!(
                contrast_on_black(rgb.map(|c| c * alpha)) >= MIN_CONTRAST,
                "{color} after"
            );
        }
    }

    #[test]
    fn bar_counts_only_when_someone_can_see_it() {
        // The app bar needs Lyra in front; the Control Strip bar doesn't.
        assert!(bar_seen(true, true, true, false));
        assert!(!bar_seen(true, false, true, false));
        assert!(bar_seen(true, false, false, true));
        // Asleep, locked or switched out: nothing counts.
        assert!(!bar_seen(false, true, true, true));
    }

    #[test]
    fn reads_the_first_css_font_family() {
        assert_eq!(
            first_family("'SF Pro Rounded', sans-serif"),
            "SF Pro Rounded"
        );
        assert_eq!(first_family("\"Inter\", sans-serif"), "Inter");
        assert_eq!(first_family("system-ui"), "system-ui");
        assert_eq!(first_family(""), "");
    }

    #[test]
    fn parses_hex_lyric_colours() {
        assert_eq!(parse_hex_color("#ffffff"), Some([1.0, 1.0, 1.0]));
        assert_eq!(parse_hex_color("#000"), Some([0.0, 0.0, 0.0]));
        assert_eq!(parse_hex_color("#ff0000"), Some([1.0, 0.0, 0.0]));
        assert_eq!(parse_hex_color("white"), None);
        assert_eq!(parse_hex_color("#12345"), None);
        assert_eq!(parse_hex_color("#gg0000"), None);
    }
}
