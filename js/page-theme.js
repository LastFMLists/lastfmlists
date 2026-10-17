// Theme toggle for the text pages (guide, FAQ). The app wires its own toggle
// in index.html; both use the same storage key, so the choice carries over.
(function () {
    const toggle = document.getElementById("theme-toggle");
    if (!toggle) return;
    const THEME_STORAGE_KEY = "lastfmlists-theme";

    const paint = (theme) => {
        toggle.innerHTML = theme === "dark" ? '<i class="fas fa-sun" aria-hidden="true"></i>' : '<i class="fas fa-moon" aria-hidden="true"></i>';
        toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    };

    paint(document.documentElement.getAttribute("data-theme"));

    toggle.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        paint(next);
        try {
            localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch (e) {
            // Private browsing with storage blocked: the toggle still works for this visit.
        }
    });
})();
