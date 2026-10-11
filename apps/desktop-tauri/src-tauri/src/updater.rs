//! Background updates. Lyra checks shortly after launch and every few hours,
//! downloads a new version quietly, then offers "Restart to Install" in the
//! tray menu and Settings. Nothing interrupts playback or lyrics; the update
//! is applied only when the user restarts.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Let launch-time work (players, lyrics, windows) settle first.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(20);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// Placeholder in `tauri.conf.json` until the updater signing key exists.
const PUBKEY_PLACEHOLDER: &str = "UPDATER_PUBLIC_KEY_NOT_SET";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum UpdateStatus {
    /// No check has run yet this session.
    Idle,
    Checking,
    UpToDate {
        checked_at_ms: u64,
    },
    Downloading {
        version: String,
    },
    /// Downloaded and verified; installs on restart.
    Ready {
        version: String,
    },
    /// The last check or download failed; Lyra retries at the next interval.
    Failed {
        checked_at_ms: u64,
    },
    /// This build doesn't update itself (development builds).
    Unavailable,
}

#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    current_version: String,
    status: UpdateStatus,
}

pub struct Updates {
    status: Mutex<UpdateStatus>,
    /// The downloaded update and its bytes, installed on restart.
    ready: Mutex<Option<(Update, Vec<u8>)>>,
    /// A check is running, so a manual check doesn't start a second one.
    busy: AtomicBool,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn updates_enabled(app: &AppHandle) -> bool {
    if cfg!(debug_assertions) {
        return false;
    }
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|key| key.as_str())
        .is_some_and(|key| !key.is_empty() && key != PUBKEY_PLACEHOLDER)
}

fn info(app: &AppHandle, status: UpdateStatus) -> UpdateInfo {
    UpdateInfo {
        current_version: app.package_info().version.to_string(),
        status,
    }
}

fn set_status(app: &AppHandle, status: UpdateStatus) {
    let updates = app.state::<Updates>();
    if let Ok(mut current) = updates.status.lock() {
        if *current == status {
            return;
        }
        *current = status.clone();
    }
    if let UpdateStatus::Ready { version } = &status {
        if let Some(tray) = app.try_state::<crate::tray::TrayMenuRefs>() {
            tray.show_update_ready(version);
        }
    }
    let _ = app.emit("update-status", info(app, status));
}

/// Register the updater and start the background schedule.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    app.plugin(tauri_plugin_updater::Builder::new().build())?;
    let enabled = updates_enabled(app);
    app.manage(Updates {
        status: Mutex::new(if enabled {
            UpdateStatus::Idle
        } else {
            UpdateStatus::Unavailable
        }),
        ready: Mutex::new(None),
        busy: AtomicBool::new(false),
    });
    if !enabled {
        return Ok(());
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            check_and_download(&app).await;
            // Once an update is waiting there is nothing more to fetch until
            // the user restarts.
            if is_ready(&app) {
                break;
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
    Ok(())
}

fn is_ready(app: &AppHandle) -> bool {
    app.state::<Updates>()
        .ready
        .lock()
        .map(|ready| ready.is_some())
        .unwrap_or(false)
}

/// Check for a newer version and download it if there is one.
pub async fn check_and_download(app: &AppHandle) {
    let updates = app.state::<Updates>();
    if is_ready(app) || updates.busy.swap(true, Ordering::AcqRel) {
        return;
    }
    run_check(app).await;
    updates.busy.store(false, Ordering::Release);
}

async fn run_check(app: &AppHandle) {
    set_status(app, UpdateStatus::Checking);
    let checked = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    let update = match checked {
        Ok(Some(update)) => update,
        Ok(None) => {
            set_status(
                app,
                UpdateStatus::UpToDate {
                    checked_at_ms: now_ms(),
                },
            );
            return;
        }
        Err(error) => {
            log::warn!("update check failed: {error}");
            set_status(
                app,
                UpdateStatus::Failed {
                    checked_at_ms: now_ms(),
                },
            );
            return;
        }
    };

    let version = update.version.clone();
    set_status(
        app,
        UpdateStatus::Downloading {
            version: version.clone(),
        },
    );
    // `download` verifies the signature against the configured public key.
    match update.download(|_, _| {}, || {}).await {
        Ok(bytes) => {
            if let Ok(mut ready) = app.state::<Updates>().ready.lock() {
                *ready = Some((update, bytes));
            }
            set_status(app, UpdateStatus::Ready { version });
        }
        Err(error) => {
            log::warn!("update download failed: {error}");
            set_status(
                app,
                UpdateStatus::Failed {
                    checked_at_ms: now_ms(),
                },
            );
        }
    }
}

/// Install the downloaded update and restart. On Windows the installer
/// closes Lyra itself.
pub fn install_and_restart(app: &AppHandle) {
    let pending = app
        .state::<Updates>()
        .ready
        .lock()
        .ok()
        .and_then(|mut ready| ready.take());
    let Some((update, bytes)) = pending else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || match update.install(&bytes) {
        Ok(()) => app.restart(),
        Err(error) => {
            log::warn!("update install failed: {error}");
            set_status(
                &app,
                UpdateStatus::Failed {
                    checked_at_ms: now_ms(),
                },
            );
        }
    });
}

#[tauri::command]
pub fn get_update_status(app: AppHandle) -> UpdateInfo {
    let status = app
        .state::<Updates>()
        .status
        .lock()
        .map(|status| status.clone())
        .unwrap_or(UpdateStatus::Idle);
    info(&app, status)
}

#[tauri::command]
pub fn check_for_updates(app: AppHandle) {
    if !updates_enabled(&app) {
        return;
    }
    tauri::async_runtime::spawn(async move { check_and_download(&app).await });
}

#[tauri::command]
pub fn install_update(app: AppHandle) {
    install_and_restart(&app);
}
