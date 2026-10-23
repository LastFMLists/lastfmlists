// Toolbar menus: a button that shows a short list of related buttons (Load
// Details and Load ALL Details, the two exports). The buttons inside keep
// their own ids and click handlers; this only opens and closes the list.

const menus = Array.from(document.querySelectorAll("[data-menu]")).map(root => ({
    root,
    trigger: root.querySelector(".menu-trigger"),
    list: root.querySelector(".menu-list")
})).filter(menu => menu.trigger && menu.list);

function setOpen(menu, open) {
    menu.list.hidden = !open;
    menu.trigger.setAttribute("aria-expanded", String(open));
}

function closeAll(except = null) {
    menus.forEach(menu => {
        if (menu !== except && !menu.list.hidden) setOpen(menu, false);
    });
}

menus.forEach(menu => {
    const items = Array.from(menu.list.querySelectorAll("button"));

    menu.trigger.addEventListener("click", () => {
        const open = menu.list.hidden;
        closeAll(menu);
        setOpen(menu, open);
        if (open) items.find(item => !item.disabled)?.focus({ preventScroll: true });
    });

    // Close before the item's own handler runs, so a confirm() it opens
    // doesn't sit on top of an open menu.
    menu.list.addEventListener("click", event => {
        if (event.target.closest("button")) setOpen(menu, false);
    }, true);

    // The trigger is usable while at least one item is: the load flow
    // enables and disables the items themselves.
    const syncDisabled = () => {
        menu.trigger.disabled = items.every(item => item.disabled);
        if (menu.trigger.disabled) setOpen(menu, false);
    };
    syncDisabled();
    const observer = new MutationObserver(syncDisabled);
    items.forEach(item => observer.observe(item, { attributes: true, attributeFilter: ["disabled"] }));
});

document.addEventListener("click", event => {
    if (!event.target.closest("[data-menu]")) closeAll();
});

document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const open = menus.find(menu => !menu.list.hidden);
    if (!open) return;
    setOpen(open, false);
    open.trigger.focus();
});
