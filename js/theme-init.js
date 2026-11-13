// Sets the saved or system theme. Loaded in <head> before the stylesheets, so
// a saved dark theme doesn't flash light. It is a file of its own (not an
// inline script) so the pages' Content-Security-Policy can refuse every
// inline script.
(function () {
    try {
        var stored = localStorage.getItem('lastfmlists-theme');
        var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        var theme = stored === 'dark' || stored === 'light' ? stored : (prefersDark ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', theme);
    } catch (e) {
        document.documentElement.setAttribute('data-theme', 'light');
    }
})();
