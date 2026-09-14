mod device;
mod tailscale;
mod terminal;
mod vscode;

use tauri::Manager;

#[tauri::command]
async fn get_lab_status() -> tailscale::LabOverview {
    tauri::async_runtime::spawn_blocking(tailscale::read_lab_overview)
        .await
        .unwrap_or_else(|error| tailscale::LabOverview::unavailable(true, Some(error.to_string())))
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::WebviewWindow) -> Result<bool, String> {
    let next = !window
        .is_fullscreen()
        .map_err(|error| format!("Unable to read fullscreen state: {error}"))?;
    window
        .set_fullscreen(next)
        .map_err(|error| format!("Unable to change fullscreen state: {error}"))?;
    Ok(next)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(terminal::TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            get_lab_status,
            toggle_fullscreen,
            terminal::connect_ssh,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::disconnect_ssh,
            vscode::open_in_vscode
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.app_handle().state::<terminal::TerminalState>();
                let _ = terminal::close_window_sessions(&state, window.label());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
