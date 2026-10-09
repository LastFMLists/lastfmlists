// The green confirmation that pops up in the middle of the screen after a
// right answer. Calling it again while it is showing starts it over, so
// quick answers in Fill the List each get their own.

let celebrationEl = null;
let hideTimer = null;

export function showCelebration(text = "Correct!") {
    if (!celebrationEl) {
        celebrationEl = document.createElement("div");
        celebrationEl.className = "game-celebration";
        celebrationEl.setAttribute("role", "status");
        celebrationEl.innerHTML = '<i class="fas fa-circle-check" aria-hidden="true"></i><span></span>';
        document.body.appendChild(celebrationEl);
    }
    celebrationEl.querySelector("span").textContent = text;
    celebrationEl.classList.remove("is-showing");
    // Reading the size forces a reflow, which lets the animation restart.
    void celebrationEl.offsetWidth;
    celebrationEl.classList.add("is-showing");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => celebrationEl.classList.remove("is-showing"), 900);
}
