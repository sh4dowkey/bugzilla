// popup.js
//
// Runs when the user clicks the toolbar icon. Everything here is scoped
// to the currently active tab -- there is no "enable globally" path.

const statusEl = document.getElementById("status");
const buttonEl = document.getElementById("toggle");
const errorEl = document.getElementById("error");

let currentTab = null;

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function tabOriginPattern(url) {
  const origin = new URL(url).origin; // e.g. https://bugzilla.example.com
  return origin + "/*";
}

async function render() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];

  if (!currentTab || !currentTab.url || !/^https?:/.test(currentTab.url)) {
    statusEl.textContent = "This page can't be monitored.";
    buttonEl.hidden = true;
    return;
  }

  const { enabled } = await browser.runtime.sendMessage({
    type: "getState",
    tabId: currentTab.id,
  });

  if (enabled) {
    statusEl.textContent = "Enabled for this tab.";
    buttonEl.textContent = "Disable";
    buttonEl.className = "disable";
  } else {
    statusEl.textContent = "Off for this tab (default).";
    buttonEl.textContent = "Enable";
    buttonEl.className = "";
  }
  buttonEl.disabled = false;
}

async function onToggleClick() {
  clearError();
  buttonEl.disabled = true;

  const { enabled } = await browser.runtime.sendMessage({
    type: "getState",
    tabId: currentTab.id,
  });

  if (enabled) {
    await browser.runtime.sendMessage({ type: "disableTab", tabId: currentTab.id });
    await render();
    return;
  }

  // Enabling: request host permission scoped to just this tab's origin.
  // This call happens directly inside the click handler so it counts as
  // a user gesture, which Firefox requires for permissions.request.
  const origin = tabOriginPattern(currentTab.url);
  let granted = false;
  try {
    granted = await browser.permissions.request({ origins: [origin] });
  } catch (err) {
    showError("Permission request failed: " + err.message);
    buttonEl.disabled = false;
    return;
  }

  if (!granted) {
    showError("Permission was not granted, so the counter can't run here.");
    buttonEl.disabled = false;
    return;
  }

  await browser.runtime.sendMessage({
    type: "enableTab",
    tabId: currentTab.id,
    origin,
  });

  await render();
}

buttonEl.addEventListener("click", onToggleClick);
render();
