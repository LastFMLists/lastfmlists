// Page views count the path only. The address bar holds the username and
// list settings, which must never reach the counter. Loaded before count.js.
window.goatcounter = { path: function () { return location.pathname || "/"; } };
