use tauri::{
    menu::{Menu, MenuItem, Submenu},
    Manager,
};
#[cfg(target_os = "macos")]
use tauri::menu::PredefinedMenuItem;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let menu = build_menu(app.app_handle())?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                if event.id() == "licenses" {
                    if let Some(win) = app.get_webview_window("licenses") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    } else {
                        let _ = tauri::WebviewWindowBuilder::new(
                            app,
                            "licenses",
                            tauri::WebviewUrl::App("licenses.html".into()),
                        )
                        .title("Licenses")
                        .inner_size(780.0, 640.0)
                        .resizable(true)
                        .build();
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let licenses = MenuItem::with_id(app, "licenses", "Licenses", true, None::<&str>)?;
    let help = Submenu::with_items(app, "Help", true, &[&licenses])?;

    // Windows / Linux: just a Help menu.
    #[cfg(not(target_os = "macos"))]
    return Menu::with_items(app, &[&help]);

    // macOS: standard app + edit + window menus, plus Help.
    #[cfg(target_os = "macos")]
    {
        let about = PredefinedMenuItem::about(app, None, None)?;
        let sep1 = PredefinedMenuItem::separator(app)?;
        let services = PredefinedMenuItem::services(app, None)?;
        let sep2 = PredefinedMenuItem::separator(app)?;
        let hide = PredefinedMenuItem::hide(app, None)?;
        let hide_others = PredefinedMenuItem::hide_others(app, None)?;
        let show_all = PredefinedMenuItem::show_all(app, None)?;
        let sep3 = PredefinedMenuItem::separator(app)?;
        let quit = PredefinedMenuItem::quit(app, None)?;
        let app_menu = Submenu::with_items(
            app,
            "BlurWeb",
            true,
            &[
                &about, &sep1, &services, &sep2, &hide, &hide_others, &show_all, &sep3, &quit,
            ],
        )?;

        let undo = PredefinedMenuItem::undo(app, None)?;
        let redo = PredefinedMenuItem::redo(app, None)?;
        let sep4 = PredefinedMenuItem::separator(app)?;
        let cut = PredefinedMenuItem::cut(app, None)?;
        let copy = PredefinedMenuItem::copy(app, None)?;
        let paste = PredefinedMenuItem::paste(app, None)?;
        let select_all = PredefinedMenuItem::select_all(app, None)?;
        let edit_menu = Submenu::with_items(
            app,
            "Edit",
            true,
            &[&undo, &redo, &sep4, &cut, &copy, &paste, &select_all],
        )?;

        let minimize = PredefinedMenuItem::minimize(app, None)?;
        let maximize = PredefinedMenuItem::maximize(app, None)?;
        let fullscreen = PredefinedMenuItem::fullscreen(app, None)?;
        let sep5 = PredefinedMenuItem::separator(app)?;
        let bring_all = PredefinedMenuItem::bring_all_to_front(app, None)?;
        let close = PredefinedMenuItem::close_window(app, None)?;
        let window_menu = Submenu::with_items(
            app,
            "Window",
            true,
            &[&minimize, &maximize, &fullscreen, &sep5, &bring_all, &close],
        )?;

        Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu, &help])
    }
}
