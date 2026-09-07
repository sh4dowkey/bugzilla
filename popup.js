let currentTab = null;

const statusEl = document.getElementById("status");
const toggleButton = document.getElementById("toggle");
const errorEl = document.getElementById("error");

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.textContent = "";
  errorEl.hidden = true;
}

function setButton(enabled) {
  toggleButton.disabled = false;
  toggleButton.textContent = enabled ? "Disable" : "Enable";
}

async function loadState() {
  clearError();

  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  currentTab = tabs[0];

  if (!currentTab || !currentTab.id || !currentTab.url) {
    statusEl.textContent = "This page can't be monitored.";
    toggleButton.disabled = true;
    return;
  }

  if (!/^https?:\/\//i.test(currentTab.url)) {
    statusEl.textContent = "This page can't be monitored.";
    toggleButton.disabled = true;
    return;
  }

  try {
    const state = await browser.runtime.sendMessage({
      type: "getState",
      tabId: currentTab.id
    });

    if (state && state.enabled) {
      statusEl.textContent = "Enabled for this tab.";
      setButton(true);
    } else {
      statusEl.textContent = "Off for this tab (default).";
      setButton(false);
    }
  } catch (error) {
    showError(error.message || String(error));
    toggleButton.disabled = true;
  }
}


/*
 * IMPORTANT:
 * The permissions.request() call must happen directly
 * inside the click handler, before any await.
 */
toggleButton.addEventListener("click", function () {
  clearError();

  if (!currentTab || !currentTab.id || !currentTab.url) {
    showError("Unable to determine the current tab.");
    return;
  }

  const currentlyEnabled =
    toggleButton.textContent.trim().toLowerCase() === "disable";

  if (currentlyEnabled) {
    browser.runtime.sendMessage({
      type: "disableTab",
      tabId: currentTab.id
    }).then(() => {
      statusEl.textContent = "Off for this tab.";
      setButton(false);
    }).catch((error) => {
      showError(error.message || String(error));
    });

    return;
  }

  let origin;

  try {
    origin = new URL(currentTab.url).origin;
  } catch (error) {
    showError("Invalid tab URL.");
    return;
  }

  const permissionOrigin = origin + "/*";

  /*
   * This is intentionally NOT awaited.
   * Firefox requires permissions.request() to be
   * called directly from the user click handler.
   */
  browser.permissions.request({
    origins: [permissionOrigin]
  }).then((granted) => {
    if (!granted) {
      showError("Permission was not granted.");
      return;
    }

    return browser.runtime.sendMessage({
      type: "enableTab",
      tabId: currentTab.id,
      origin: origin
    });
  }).then((result) => {
    if (!result) {
      return;
    }

    statusEl.textContent = "Enabled for this tab.";
    setButton(true);
  }).catch((error) => {
    showError(error.message || String(error));
  });
});


loadState().catch((error) => {
  showError(error.message || String(error));
  toggleButton.disabled = true;
});
