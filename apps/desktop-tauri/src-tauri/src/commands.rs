use crate::AppState;
use lyra_core::{domain::{RenderSnapshot, SettingsSnapshot}, lyrics::LyricSource};
use tauri::State;

#[tauri::command]
pub fn get_render_snapshot(state: State<'_, AppState>) -> RenderSnapshot {
    state.runtime.lock().unwrap().tick()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> SettingsSnapshot {
    state.runtime.lock().unwrap().settings().clone()
}

#[tauri::command]
pub fn set_click_through(enabled: bool, state: State<'_, AppState>) {
    let mut rt = state.runtime.lock().unwrap();
    let mut s = rt.settings().clone();
    s.window.click_through = enabled;
    rt.update_settings(s);
}

#[tauri::command]
pub async fn refresh_lyrics(state: State<'_, AppState>) -> Result<(), String> {
    // 1. Grab track + cache state without holding the lock across await.
    let (track, is_neg, already_cached) = {
        let rt = state.runtime.lock().map_err(|e| e.to_string())?;
        let track = rt.current_track();
        let (neg, cached) = track.as_ref()
            .map(|t| (rt.is_negative(&t.uri), rt.get_cached(&t.uri).is_some()))
            .unwrap_or((false, false));
        (track, neg, cached)
    };

    let Some(track) = track else { return Ok(()) };
    if is_neg || already_cached { return Ok(()); }

    // 2. Network call — no lock held.
    let result = state.lrclib.fetch(&track).await;

    // 3. Re-lock to persist result.
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    match result {
        Ok(Some(doc)) => rt.store_lyrics(doc),
        Ok(None) => rt.store_negative(&track.uri),
        Err(_) => {}
    }
    Ok(())
}
