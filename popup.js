let currentTab = null;

const statusEl =
  document.getElementById("status");

const statusDetailEl =
  document.getElementById("status-detail");

const statusDot =
  document.getElementById("status-dot");

const newCountEl =
  document.getElementById("new-count");

const respCountEl =
  document.getElementById("resp-count");

const totalCountEl =
  document.getElementById("total-count");

const lastUpdatedEl =
  document.getElementById("last-updated");

const toggleButton =
  document.getElementById("toggle");

const errorEl =
  document.getElementById("error");


function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;

  statusDot.className =
    "status-dot error";
}


function clearError() {
  errorEl.textContent = "";
  errorEl.hidden = true;
}


function formatLastUpdated(timestamp) {
  if (!timestamp) {
    return "—";
  }

  const seconds =
    Math.max(
      0,
      Math.floor(
        (Date.now() - timestamp) /
          1000
      )
    );

  if (seconds < 5) {
    return "Just now";
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes =
    Math.floor(
      seconds / 60
    );

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  return `${hours}h ago`;
}


function renderEnabled(state) {
  statusDot.className =
    "status-dot on";

  statusEl.textContent =
    "Monitoring ON";

  statusDetailEl.textContent =
    "This tab is being monitored";

  newCountEl.textContent =
    state.newCount ?? 0;

  respCountEl.textContent =
    state.respCount ?? 0;

  totalCountEl.textContent =
    state.totalCount ?? 0;

  lastUpdatedEl.textContent =
    formatLastUpdated(
      state.lastUpdated
    );

  toggleButton.disabled = false;

  toggleButton.textContent =
    "Disable monitoring";

  toggleButton.classList.add(
    "disable"
  );
}


function renderDisabled() {
  statusDot.className =
    "status-dot off";

  statusEl.textContent =
    "Monitoring OFF";

  statusDetailEl.textContent =
    "This tab is not being monitored";

  newCountEl.textContent = "—";
  respCountEl.textContent = "—";
  totalCountEl.textContent = "—";

  lastUpdatedEl.textContent = "—";

  toggleButton.disabled = false;

  toggleButton.textContent =
    "Enable monitoring";

  toggleButton.classList.remove(
    "disable"
  );
}


async function loadState() {
  clearError();

  const tabs =
    await browser.tabs.query({
      active: true,
      currentWindow: true
    });

  currentTab = tabs[0];

  if (
    !currentTab ||
    currentTab.id == null ||
    !currentTab.url
  ) {
    statusEl.textContent =
      "This page can't be monitored.";

    toggleButton.disabled = true;

    return;
  }

  if (
    !/^https?:\/\//i.test(
      currentTab.url
    )
  ) {
    statusEl.textContent =
      "This page can't be monitored.";

    statusDetailEl.textContent =
      "Only HTTP/HTTPS pages are supported.";

    toggleButton.disabled = true;

    return;
  }

  const state =
    await browser.runtime.sendMessage({
      type: "getState",
      tabId: currentTab.id
    });

  if (
    state &&
    state.enabled
  ) {
    renderEnabled(state);
  } else {
    renderDisabled();
  }
}


toggleButton.addEventListener(
  "click",
  function () {
    clearError();

    if (
      !currentTab ||
      currentTab.id == null ||
      !currentTab.url
    ) {
      showError(
        "Unable to determine the current tab."
      );

      return;
    }

    const currentlyEnabled =
      toggleButton.classList.contains(
        "disable"
      );

    /*
     * DISABLE
     */

    if (currentlyEnabled) {
      browser.runtime
        .sendMessage({
          type: "disableTab",
          tabId: currentTab.id
        })
        .then(() => {
          renderDisabled();
        })
        .catch((error) => {
          showError(
            error.message ||
            String(error)
          );
        });

      return;
    }

    /*
     * ENABLE
     *
     * IMPORTANT:
     *
     * permissions.request() is called
     * directly from this click handler.
     */

    let origin;

    try {
      origin =
        new URL(
          currentTab.url
        ).origin;
    } catch {
      showError(
        "Invalid tab URL."
      );

      return;
    }

    browser.permissions
      .request({
        origins: [
          origin + "/*"
        ]
      })
      .then((granted) => {
        if (!granted) {
          showError(
            "Permission was not granted."
          );

          return null;
        }

        return browser.runtime.sendMessage({
          type: "enableTab",

          tabId:
            currentTab.id,

          origin
        });
      })
      .then((result) => {
        if (!result) {
          return null;
        }

        return browser.runtime.sendMessage({
          type: "getState",

          tabId:
            currentTab.id
        });
      })
      .then((state) => {
        if (state) {
          renderEnabled(state);
        }
      })
      .catch((error) => {
        showError(
          error.message ||
          String(error)
        );
      });
  }
);


loadState().catch((error) => {
  showError(
    error.message ||
    String(error)
  );

  toggleButton.disabled = true;
});
