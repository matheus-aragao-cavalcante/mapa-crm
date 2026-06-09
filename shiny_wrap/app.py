# shiny_wrap/app.py
from shiny import App, ui
from pathlib import Path

APP_DIR = Path(__file__).parent
WWW_DIR = APP_DIR / "www"

app_ui = ui.page_fixed(
    ui.tags.iframe(
        src="index.html",   # <-- RELATIVO ao app (/mapa-crm/index.html)
        style="position:fixed;inset:0;border:0;width:100%;height:100vh;",
    )
)

app = App(
    app_ui,
    server=None,
    static_assets={"": WWW_DIR},   # serve shiny_wrap/www na raiz do app
)
