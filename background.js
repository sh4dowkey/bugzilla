// background.js
//
// Responsibilities:
//   - Track which tabs have the counter ENABLED (per-tab, never global).
//   - Only after the user explicitly enables a tab, hold a *scoped* host
//     permission for that tab's origin (requested via permissions.request
//     in popup.js, which runs in direct response to the Enable click).
//   - Re-inject content.js into an enabled tab whenever that tab finishes
//     loading again (covers Bugzilla's own periodic full-page reload, and
//     normal manual refreshes), so the user never has to re-click Enable.
//   - Never inject into any tab that wasn't explicitly enabled.

const STORAGE_KEY = "enabledTabs"; // { [tabId]: { origin: string } }

async function getEnabledTabs() {
  const data = await browser.storage.session.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

async function setEnabledTabs(map) {
  await browser.storage.session.set({ [STORAGE_KEY]: map });
}

async function markTabEnabled(tabId, origin) {
  const map = await getEnabledTabs();
  map[tabId] = { origin };
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
      target: { tabId },
      files: ["content.js"],
    });
  } catch (err) {
    // Tab may have navigated away / closed / be a privileged page. Not fatal.
    console.warn("Bugzilla NEW Counter: injection failed for tab", tabId, err);
  }
}

function originMatchesTabUrl(origin, tabUrl) {
  try {
    const tabOrigin = new URL(tabUrl).origin;
    // origin is stored as "https://host/*" style pattern; compare the host part.
    const originHost = origin.replace(/\/\*$/, "");
    return tabOrigin === originHost;
  } catch {
    return false;
  }
}

// ---- Message handling from popup.js and content.js ----
browser.runtime.onMessage.addListener(async (message, sender) => {
  if (!message || typeof message !== "object") return;

  switch (message.type) {
    case "getState": {
      const enabled = await isTabEnabled(message.tabId);
      return { enabled };
    }

    case "enableTab": {
      const { tabId, origin } = message;
      await markTabEnabled(tabId, origin);
      await injectContentScript(tabId);
      return { ok: true };
    }

    case "disableTab": {
      const { tabId } = message;
      await markTabDisabled(tabId);
      try {
        await browser.tabs.sendMessage(tabId, { type: "disable" });
      } catch {
        // Content script may already be gone (e.g. tab navigated); fine.
      }
      try {
        await browser.action.setBadgeText({ text: "", tabId });
      } catch {
        // ignore
      }
      return { ok: true };
    }

    // content.js reports counts so we can mirror the number on the
    // toolbar-icon badge as a secondary confirmation (the primary
    // indicator is the favicon overlay drawn by content.js itself).
    case "countUpdate": {
      if (sender.tab && sender.tab.id != null) {
        try {
          await browser.action.setBadgeText({
            text: String(message.count),
            tabId: sender.tab.id,
          });
          await browser.action.setBadgeBackgroundColor({
            color: "#c62828",
            tabId: sender.tab.id,
          });
        } catch {
          // ignore
        }
      }
      return { ok: true };
    }

    default:
      return;
  }
});

// ---- Re-establish the counter after a page reload/navigation ----
// Bugzilla's own page JS periodically calls window.location.reload(true),
// and the user may also hit refresh manually. Either way, any previously
// injected content script instance is destroyed. If the tab is still
// marked enabled AND still points at the same origin we were granted
// permission for, re-inject automatically.
browser.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return; // top frame only

  const map = await getEnabledTabs();
  const entry = map[details.tabId];
  if (!entry) return;

  const tab = await browser.tabs.get(details.tabId).catch(() => null);
  if (!tab || !tab.url) return;

  if (!originMatchesTabUrl(entry.origin, tab.url)) {
    // Navigated to a different site than the one that was enabled.
    // Auto-disable rather than silently operating without permission
    // or (worse) failing silently forever.
    await markTabDisabled(details.tabId);
    try {
      await browser.action.setBadgeText({ text: "", tabId: details.tabId });
    } catch {
      // ignore
    }
    return;
  }

  const granted = await browser.permissions.contains({ origins: [entry.origin] });
  if (!granted) {
    await markTabDisabled(details.tabId);
    return;
  }

  await injectContentScript(details.tabId);
});

// ---- Cleanup ----
browser.tabs.onRemoved.addListener(async (tabId) => {
  await markTabDisabled(tabId);
});
