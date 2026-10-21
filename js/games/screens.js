// Shows one panel of the Games tab (the menu or one game) and hides the rest.

export function showGamePanel(id) {
    for (const panel of document.querySelectorAll("#games-section > div")) panel.hidden = panel.id !== id;
}
