//! Launch at login.
//!
//! On macOS 13 and later Lyra registers itself with `SMAppService.mainApp`.
//! It then shows as "Lyra" under Open at Login in System Settings, and its
//! status says whether macOS will actually launch it — including when the
//! user has blocked it there. Earlier releases wrote a legacy LaunchAgent
//! (`~/Library/LaunchAgents/Lyra.plist`), which System Settings lists under
//! the signing team's name and whose blocked state the app could not see;
//! startup removes it and carries the user's choice over.
//!
//! Older macOS, Windows and Linux keep using tauri-plugin-autostart
//! (LaunchAgent, registry Run key, XDG autostart).

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// What the OS will do at the next login. Sent to the settings window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AutostartStatus {
    Enabled,
    Disabled,
    /// Lyra is registered but macOS blocks it until the user allows it in
    /// System Settings › General › Login Items.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    RequiresApproval,
    /// This build cannot register itself: a development binary running
    /// outside `Lyra.app`. Kept away from the installed app's login item.
    Unavailable,
}

impl AutostartStatus {
    /// Whether the user's choice is "launch at login", allowed or not.
    pub fn is_on(self) -> bool {
        matches!(self, Self::Enabled | Self::RequiresApproval)
    }
}

/// Current launch-at-login status, as the OS reports it.
pub fn status(app: &AppHandle) -> AutostartStatus {
    #[cfg(target_os = "macos")]
    {
        if !mac::is_bundled() {
            return AutostartStatus::Unavailable;
        }
        if mac::app_service_available() {
            return mac::status();
        }
    }
    plugin_status(app)
}

/// Turn launch at login on or off and return the resulting status.
pub fn set(app: &AppHandle, enabled: bool) -> Result<AutostartStatus, String> {
    #[cfg(target_os = "macos")]
    {
        if !mac::is_bundled() {
            return Err("Launch at login works in the installed Lyra app.".into());
        }
        if mac::app_service_available() {
            return mac::set(enabled);
        }
    }
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable().map_err(|e| e.to_string())?;
    } else {
        launcher.disable().map_err(|e| e.to_string())?;
    }
    Ok(plugin_status(app))
}

/// Open System Settings at Login Items, where a blocked login item is allowed.
pub fn open_login_items_settings() {
    #[cfg(target_os = "macos")]
    if mac::app_service_available() {
        mac::open_login_items_settings();
    }
}

/// Reconcile the OS with the saved preference at launch; returns the status
/// to mirror back into the saved preference.
pub fn sync_on_startup(app: &AppHandle, saved_enabled: bool) -> AutostartStatus {
    #[cfg(target_os = "macos")]
    {
        if !mac::is_bundled() {
            // A dev build must not rewrite or remove the installed app's item.
            return AutostartStatus::Unavailable;
        }
        if mac::app_service_available() {
            let launcher = app.autolaunch();
            let had_legacy_agent = launcher.is_enabled().unwrap_or(false);
            if had_legacy_agent {
                if let Err(e) = launcher.disable() {
                    log::warn!("autostart: could not remove legacy LaunchAgent: {e}");
                }
            }
            // Carry the choice over from the LaunchAgent once. After that the
            // OS is the source of truth: removing Lyra from Open at Login in
            // System Settings is a choice, not something to undo.
            if had_legacy_agent && saved_enabled {
                return match mac::set(true) {
                    Ok(status) => status,
                    Err(e) => {
                        log::warn!("autostart: could not register login item: {e}");
                        mac::status()
                    }
                };
            }
            return mac::status();
        }
    }
    // Plugin platforms: the saved preference wins, so an entry removed by a
    // cleanup tool or a reinstall comes back.
    let launcher = app.autolaunch();
    let os_enabled = launcher.is_enabled().unwrap_or(false);
    if saved_enabled != os_enabled {
        let result = if saved_enabled {
            launcher.enable()
        } else {
            launcher.disable()
        };
        if let Err(e) = result {
            log::warn!("autostart: could not apply saved preference: {e}");
        }
    }
    plugin_status(app)
}

fn plugin_status(app: &AppHandle) -> AutostartStatus {
    if app.autolaunch().is_enabled().unwrap_or(false) {
        AutostartStatus::Enabled
    } else {
        AutostartStatus::Disabled
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::AutostartStatus;
    use objc2::runtime::AnyClass;
    use objc2_service_management::{SMAppService, SMAppServiceStatus};

    /// `SMAppService` exists from macOS 13. Calling it earlier would abort.
    pub fn app_service_available() -> bool {
        AnyClass::get(c"SMAppService").is_some()
    }

    /// Running from inside an app bundle, not `target/debug/lyra-desktop`.
    pub fn is_bundled() -> bool {
        std::env::current_exe()
            .map(|p| p.to_string_lossy().contains(".app/Contents/MacOS/"))
            .unwrap_or(false)
    }

    pub fn status() -> AutostartStatus {
        // SAFETY: guarded by `app_service_available`; plain class/instance calls.
        let status = unsafe { SMAppService::mainAppService().status() };
        match status {
            SMAppServiceStatus::Enabled => AutostartStatus::Enabled,
            SMAppServiceStatus::RequiresApproval => AutostartStatus::RequiresApproval,
            _ => AutostartStatus::Disabled,
        }
    }

    pub fn set(enabled: bool) -> Result<AutostartStatus, String> {
        let current = status();
        if current.is_on() == enabled {
            return Ok(current);
        }
        // SAFETY: as above.
        let result = unsafe {
            let service = SMAppService::mainAppService();
            if enabled {
                service.registerAndReturnError()
            } else {
                service.unregisterAndReturnError()
            }
        };
        let after = status();
        match result {
            Ok(()) => Ok(after),
            // Registering a blocked item reports an error but leaves it
            // registered and waiting for approval: that is the answer.
            Err(_) if after.is_on() == enabled => Ok(after),
            Err(e) => Err(e.localizedDescription().to_string()),
        }
    }

    pub fn open_login_items_settings() {
        // SAFETY: as above.
        unsafe { SMAppService::openSystemSettingsLoginItems() };
    }
}

#[cfg(test)]
mod tests {
    use super::AutostartStatus;

    #[test]
    fn status_serializes_to_the_frontend_union() {
        // Must match `AutostartStatus` in src/types/tauri-contracts.ts.
        let cases = [
            (AutostartStatus::Enabled, "\"enabled\""),
            (AutostartStatus::Disabled, "\"disabled\""),
            (AutostartStatus::RequiresApproval, "\"requires_approval\""),
            (AutostartStatus::Unavailable, "\"unavailable\""),
        ];
        for (status, json) in cases {
            assert_eq!(serde_json::to_string(&status).unwrap(), json);
        }
    }

    #[test]
    fn blocked_login_item_still_counts_as_the_users_choice() {
        assert!(AutostartStatus::Enabled.is_on());
        assert!(AutostartStatus::RequiresApproval.is_on());
        assert!(!AutostartStatus::Disabled.is_on());
        assert!(!AutostartStatus::Unavailable.is_on());
    }
}
