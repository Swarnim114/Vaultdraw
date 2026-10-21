//! macOS app menu. It reproduces Tauri's default menu, except that Cmd+W is
//! "Close Tab" (the frontend closes the active tab; the window never closes
//! from it) and "Close Window" moves to Cmd+Shift+W. Close Window goes through
//! the normal close request, so the renderer's save barrier still runs.
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const CLOSE_TAB_ID: &str = "vault-menu-close-tab";
pub const CLOSE_WINDOW_ID: &str = "vault-menu-close-window";
/// Frontend contract: empty payload, delivered to the focused window.
pub const CLOSE_TAB_EVENT: &str = "vault-close-tab";

#[derive(Debug, PartialEq, Eq)]
enum MenuAction {
    CloseTab,
    CloseWindow,
}

fn action_for(id: &str) -> Option<MenuAction> {
    match id {
        CLOSE_TAB_ID => Some(MenuAction::CloseTab),
        CLOSE_WINDOW_ID => Some(MenuAction::CloseWindow),
        _ => None,
    }
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let name = app.package_info().name.clone();
    let close_tab = MenuItem::with_id(app, CLOSE_TAB_ID, "Close Tab", true, Some("CmdOrCtrl+W"))?;
    let close_window = MenuItem::with_id(
        app,
        CLOSE_WINDOW_ID,
        "Close Window",
        true,
        Some("CmdOrCtrl+Shift+W"),
    )?;
    let sep = || PredefinedMenuItem::separator(app);
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &sep()?,
                    &PredefinedMenuItem::services(app, None)?,
                    &sep()?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &sep()?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "File", true, &[&close_tab, &close_window])?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &sep()?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                ],
            )?,
        ],
    )
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let Some(action) = action_for(event.id().as_ref()) else {
        return;
    };
    let focused = app
        .webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false));
    let Some(window) = focused else { return };
    match action {
        MenuAction::CloseTab => {
            let _ = app.emit_to(window.label(), CLOSE_TAB_EVENT, ());
        }
        // `close` raises CloseRequested (renderer flush barrier); never `destroy`.
        MenuAction::CloseWindow => {
            let _ = window.close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_item_ids_to_actions() {
        assert_eq!(action_for(CLOSE_TAB_ID), Some(MenuAction::CloseTab));
        assert_eq!(action_for(CLOSE_WINDOW_ID), Some(MenuAction::CloseWindow));
        assert_eq!(action_for("other"), None);
    }

    #[test]
    fn event_name_is_the_frontend_contract() {
        assert_eq!(CLOSE_TAB_EVENT, "vault-close-tab");
    }
}
