// Shows one panel of the Games tab (the menu or one game) and hides the rest.
// While a game is open the page is in game mode (body.in-game): the header,
// tabs and footer step aside and the game fills the screen. The menu brings
// them back.

export function showGamePanel(id) {
    for (const panel of document.querySelectorAll("#games-section > div")) panel.hidden = panel.id !== id;
    const inGame = id !== "games-home";
    const wasInGame = document.body.classList.contains("in-game");
    document.body.classList.toggle("in-game", inGame);
    if (inGame !== wasInGame) window.scrollTo(0, 0);
}
