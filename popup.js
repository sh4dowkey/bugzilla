let currentTab = null;

let pollTimer = null;

let tickTimer = null;

let lastKnownState = null;


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


/*
 * Re-render just the "last updated"
 * relative time without touching
 * anything else, so it stays fresh
 * while the popup is open.
 */

function tickLastUpdated() {
  if (
    lastKnownState &&
    lastKnownState.enabled
  ) {
    lastUpdatedEl.textContent =
      formatLastUpdated(
        lastKnownState.lastUpdated
      );
  }
}


function setSwitch(checked) {
  toggleButton.setAttribute(
    "aria-checked",
    checked ? "true" : "false"
  );
}


function renderEnabled(state) {
  lastKnownState = state;

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

  toggleButton.classList.remove(
    "pending"
  );

  setSwitch(true);

  startPolling();
}


function renderDisabled() {
  lastKnownState = {
    enabled: false
  };

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

  toggleButton.classList.remove(
    "pending"
  );

  setSwitch(false);

  stopPolling();
}


/*
 * While monitoring is on and the
 * popup stays open, keep the counts
 * and "last updated" text fresh
 * instead of only reflecting a
 * single snapshot from load time.
 */

function startPolling() {
  stopPolling();

  pollTimer = setInterval(
    async () => {
      if (
        !currentTab ||
        currentTab.id == null
      ) {
        return;
      }

      try {
        const state =
          await browser.runtime.sendMessage({
            type: "getState",
            tabId: currentTab.id
          });

        if (state && state.enabled) {
          renderCountsOnly(state);
        } else if (state) {
          renderDisabled();
        }
      } catch {
        /* popup may be closing */
      }
    },
    3000
  );
}


function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}


/*
 * Lighter-weight refresh used by
 * polling: updates numbers without
 * re-touching the switch/animations.
 */

function renderCountsOnly(state) {
  lastKnownState = state;

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
      toggleButton.getAttribute(
        "aria-checked"
      ) === "true";

    /*
     * DISABLE
     */

    if (currentlyEnabled) {
      toggleButton.disabled = true;
      toggleButton.classList.add("pending");

      browser.runtime
        .sendMessage({
          type: "disableTab",
          tabId: currentTab.id
        })
        .then(() => {
          renderDisabled();
        })
        .catch((error) => {
          toggleButton.disabled = false;
          toggleButton.classList.remove("pending");

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
     * directly from this click handler,
     * synchronously in response to the
     * user gesture. Do not move this
     * behind an await/async boundary.
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

    toggleButton.classList.add("pending");

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

          toggleButton.classList.remove("pending");

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
        } else {
          toggleButton.classList.remove("pending");
        }
      })
      .catch((error) => {
        toggleButton.classList.remove("pending");

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


tickTimer = setInterval(
  tickLastUpdated,
  5000
);

window.addEventListener(
  "unload",
  () => {
    stopPolling();

    clearInterval(tickTimer);
  }
);
