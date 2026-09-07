// background.js
//
// Keeps the NEW counter enabled on a specific tab across page reloads.
// The counter is still disabled by default and only starts after the
// user explicitly enables the current tab.

const STORAGE_KEY = "enabledTabs"; // { [tabId]: { origin: string } }


async function getEnabledTabs() {
  const data = await browser.storage.session.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}


async function setEnabledTabs(map) {
  await browser.storage.session.set({
    [STORAGE_KEY]: map
  });
}


async function markTabEnabled(tabId, origin) {
  const map = await getEnabledTabs();

  map[tabId] = {
    origin: origin
  };

  await setEnabledTabs(map);
}


async function markTabDisabled(tabId) {
  const map = await getEnabledTabs();

  delete map[tabId];

  await setEnabledTabs(map);
}


async function isTabEnabled(tabId) {
  const map = await getEnabledTabs();

  return Object.prototype.hasOwnProperty.call(map, tabId);
}


async function injectContentScript(tabId) {
  try {
    await browser.scripting.executeScript({
      target: {
        tabId: tabId
      },
      files: [
        "content.js"
      ]
    });
  } catch (err) {
    console.warn(
      "Bugzilla Counter: injection failed for tab",
      tabId,
      err
    );
  }
}


/*
 * Compare the saved origin with the current tab URL.
 */
function originMatchesTabUrl(origin, tabUrl) {
  try {
    const tabOrigin = new URL(tabUrl).origin;

    return tabOrigin === origin;
  } catch {
    return false;
  }
}


/*
 * Convert:
 *
 *   http://cb.inhouse.net
 *
 * into:
 *
 *   http://cb.inhouse.net/*
 *
 * because Firefox host permissions use match patterns.
 */
function getPermissionPattern(origin) {
  if (origin.endsWith("/*")) {
    return origin;
  }

  return origin + "/*";
}


// ------------------------------------------------------------
// Messages from popup.js and content.js
// ------------------------------------------------------------

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (!message || typeof message !== "object") {
    return;
  }

  switch (message.type) {

    case "getState": {
      const enabled = await isTabEnabled(message.tabId);

      return {
        enabled: enabled
      };
    }


    case "enableTab": {
      const tabId = message.tabId;
      const origin = message.origin;

      await markTabEnabled(tabId, origin);

      await injectContentScript(tabId);

      return {
        ok: true
      };
    }


    case "disableTab": {
      const tabId = message.tabId;

      await markTabDisabled(tabId);

      try {
        await browser.tabs.sendMessage(tabId, {
          type: "disable"
        });
      } catch {
        // Content script may already be gone.
      }

      try {
        await browser.action.setBadgeText({
          text: "",
          tabId: tabId
        });
      } catch {
        // Ignore.
      }

      return {
        ok: true
      };
    }


    case "countUpdate": {
      if (sender.tab && sender.tab.id != null) {

        try {
          await browser.action.setBadgeText({
            text: String(message.count),
            tabId: sender.tab.id
          });

          await browser.action.setBadgeBackgroundColor({
            color: "#c62828",
            tabId: sender.tab.id
          });

        } catch {
          // Ignore.
        }
      }

      return {
        ok: true
      };
    }


    default:
      return;
  }
});


// ------------------------------------------------------------
// Re-inject after page reload/navigation
// ------------------------------------------------------------

browser.webNavigation.onCompleted.addListener(async (details) => {

  // Only care about the main page.
  if (details.frameId !== 0) {
    return;
  }

  const map = await getEnabledTabs();

  const entry = map[details.tabId];

  // This tab wasn't enabled.
  if (!entry) {
    return;
  }

  const tab = await browser.tabs
    .get(details.tabId)
    .catch(() => null);

  if (!tab || !tab.url) {
    return;
  }


  // If the tab moved to another origin, automatically disable it.
  if (!originMatchesTabUrl(entry.origin, tab.url)) {

    await markTabDisabled(details.tabId);

    try {
      await browser.action.setBadgeText({
        text: "",
        tabId: details.tabId
      });
    } catch {
      // Ignore.
    }

    return;
  }


  /*
   * IMPORTANT FIX:
   *
   * The permission was granted as:
   *
   *   http://cb.inhouse.net/*
   *
   * while the stored origin is:
   *
   *   http://cb.inhouse.net
   *
   * Therefore we must add /* before checking the permission.
   */
  const permissionPattern = getPermissionPattern(entry.origin);

  const granted = await browser.permissions.contains({
    origins: [
      permissionPattern
    ]
  });

  if (!granted) {

    await markTabDisabled(details.tabId);

    try {
      await browser.action.setBadgeText({
        text: "",
        tabId: details.tabId
      });
    } catch {
      // Ignore.
    }

    return;
  }


  // Page finished loading and permission is still valid.
  // Re-inject the counter.
  await injectContentScript(details.tabId);
});


// ------------------------------------------------------------
// Cleanup when a tab is closed
// ------------------------------------------------------------

browser.tabs.onRemoved.addListener(async (tabId) => {
  await markTabDisabled(tabId);
});
