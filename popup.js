let currentTab = null;

const statusEl = document.getElementById("status");
const statusDetailEl = document.getElementById("status-detail");
const statusDot = document.getElementById("status-dot");
const newCountEl = document.getElementById("new-count");
const respCountEl = document.getElementById("resp-count");
const totalCountEl = document.getElementById("total-count");
const lastUpdatedEl = document.getElementById("last-updated");
const toggleButton = document.getElementById("toggle");
const errorEl = document.getElementById("error");

const pairingStatusEl = document.getElementById("pairing-status");
const pairingSection = document.getElementById("pairing-section");
const awayHeader = document.getElementById("away-header");
const awayContent = document.getElementById("away-content");
const awayChevron = document.getElementById("away-chevron");
const pairingCodeInput = document.getElementById("pairing-code");
const pairButton = document.getElementById("pair-button");
const unpairButton = document.getElementById("unpair-button");

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  statusDot.className = "status-dot error";
}

function clearError() {
  errorEl.textContent = "";
  errorEl.hidden = true;
}

function formatLastUpdated(timestamp) {
  if (!timestamp) return "—";

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  return `${Math.floor(minutes / 60)}h ago`;
}

function renderEnabled(state) {
  statusDot.className = "status-dot on";
  statusEl.textContent = "Monitoring ON";
  statusDetailEl.textContent = "This tab is being monitored";

  newCountEl.textContent = state.newCount ?? 0;
  respCountEl.textContent = state.respCount ?? 0;
  totalCountEl.textContent = state.totalCount ?? 0;
  lastUpdatedEl.textContent = formatLastUpdated(state.lastUpdated);

  toggleButton.disabled = false;
  toggleButton.classList.add("on");
  toggleButton.setAttribute("aria-pressed", "true");
}

function renderDisabled() {
  statusDot.className = "status-dot off";
  statusEl.textContent = "Monitoring OFF";
  statusDetailEl.textContent = "This tab is not being monitored";

  newCountEl.textContent = "—";
  respCountEl.textContent = "—";
  totalCountEl.textContent = "—";
  lastUpdatedEl.textContent = "—";

  toggleButton.disabled = false;
  toggleButton.classList.remove("on");
  toggleButton.setAttribute("aria-pressed", "false");
}

async function loadState() {
  clearError();

  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  currentTab = tabs[0];

  if (!currentTab || currentTab.id == null || !currentTab.url) {
    statusEl.textContent = "This page can't be monitored.";
    toggleButton.disabled = true;
    return;
  }

  if (!/^https?:\/\//i.test(currentTab.url)) {
    statusEl.textContent = "This page can't be monitored.";
    statusDetailEl.textContent = "Only HTTP/HTTPS pages are supported.";
    toggleButton.disabled = true;
    return;
  }

  const state = await browser.runtime.sendMessage({
    type: "getState",
    tabId: currentTab.id
  });

  if (state && state.enabled) renderEnabled(state);
  else renderDisabled();
}

async function loadAwayStatus() {
  try {
    const state = await browser.runtime.sendMessage({
      type: "getAwayStatus"
    });

    if (state.paired) {
      pairingStatusEl.textContent = state.awayEnabled
        ? "✓ Phone paired • Away Mode is active"
        : "Phone paired • Away Mode is off";

      pairingSection.hidden = true;
      unpairButton.hidden = false;
    } else {
      pairingStatusEl.textContent = "Phone not paired";
      pairingSection.hidden = false;
      unpairButton.hidden = true;
    }

    if (state.error && state.paired) {
      pairingStatusEl.textContent = `Phone paired • ${state.error}`;
    }
  } catch (error) {
    pairingStatusEl.textContent = error.message || String(error);
  }
}

toggleButton.addEventListener("click", async () => {
  clearError();

  if (!currentTab || currentTab.id == null || !currentTab.url) {
    showError("Unable to determine the current tab.");
    return;
  }

  const currentlyEnabled = toggleButton.classList.contains("on");

  if (currentlyEnabled) {
    try {
      await browser.runtime.sendMessage({
        type: "disableTab",
        tabId: currentTab.id
      });
      renderDisabled();
    } catch (error) {
      showError(error.message || String(error));
    }
    return;
  }

  let origin;
  try {
    origin = new URL(currentTab.url).origin;
  } catch {
    showError("Invalid tab URL.");
    return;
  }

  try {
    const granted = await browser.permissions.request({
      origins: [origin + "/*"]
    });

    if (!granted) {
      showError("Permission was not granted.");
      return;
    }

    await browser.runtime.sendMessage({
      type: "enableTab",
      tabId: currentTab.id,
      origin
    });

    const state = await browser.runtime.sendMessage({
      type: "getState",
      tabId: currentTab.id
    });

    if (state) renderEnabled(state);
  } catch (error) {
    showError(error.message || String(error));
  }
});

pairingCodeInput.addEventListener("input", () => {
  pairingCodeInput.value = pairingCodeInput.value
    .replace(/\D/g, "")
    .slice(0, 6);
});

pairButton.addEventListener("click", async () => {
  clearError();

  const code = pairingCodeInput.value.trim();

  if (!/^\d{6}$/.test(code)) {
    showError("Enter the 6-digit pairing code generated by your phone.");
    pairingCodeInput.focus();
    return;
  }

  pairButton.disabled = true;
  pairButton.textContent = "Pairing…";

  try {
    await browser.runtime.sendMessage({
      type: "pairPhone",
      code
    });

    pairingCodeInput.value = "";
    await loadAwayStatus();
    setAwayExpanded(true);
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    pairButton.disabled = false;
    pairButton.textContent = "Pair";
  }
});

unpairButton.addEventListener("click", async () => {
  clearError();
  unpairButton.disabled = true;
  unpairButton.textContent = "Unpairing…";

  try {
    await browser.runtime.sendMessage({
      type: "unpairPhone"
    });

    await loadAwayStatus();
    setAwayExpanded(false);
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    unpairButton.disabled = false;
    unpairButton.textContent = "Unpair phone";
  }
});

function setAwayExpanded(expanded) {
  awayContent.hidden = !expanded;
  awayHeader.setAttribute("aria-expanded", String(expanded));
  awayHeader.classList.toggle("expanded", expanded);
  awayChevron.classList.toggle("expanded", expanded);
}

awayHeader.addEventListener("click", () => {
  setAwayExpanded(awayContent.hidden);
});

Promise.all([
  loadState(),
  loadAwayStatus()
]).catch((error) => {
  showError(error.message || String(error));
});
