from shiny import App, ui

# Serve o HTML exportado do Next na pasta www/
# Se seu index está em www/index.html, isso já basta.
app_ui = ui.page_fluid(
    ui.include_html("www/index.html")
)

app = App(app_ui, server=None)
