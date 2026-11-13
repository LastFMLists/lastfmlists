// The icons come from Font Awesome on a CDN. If its stylesheet is blocked or
// fails to load, icon-only buttons would be empty circles, so this marks the
// page and style.css shows each button's label as text instead.
(function () {
    function check() {
        var probe = document.createElement("i");
        probe.className = "fas fa-check";
        probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
        document.body.appendChild(probe);
        var family = getComputedStyle(probe).fontFamily || "";
        probe.remove();
        document.documentElement.classList.toggle("icons-missing", !/Font Awesome/i.test(family));
    }
    if (document.readyState === "complete") check();
    else window.addEventListener("load", check);
})();
