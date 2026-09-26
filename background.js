const STORAGE_KEY = "enabledTabs";
const AWAY_STORAGE_KEY = "awayPairing";
const API_URL = "https://bugzilla-notify-api.anant-pandey017.workers.dev";
const EXTENSION_ID = "bugzilla-new-counter@inhouse.net";

const WARNING_MINUTES = [20, 15, 10, 5];
const OVERDUE_REPEAT_MINUTES = 5;

/* ============================================================ */
/* STORAGE                                                       */
/* ============================================================ */

async function getEnabledTabs() {
  const data = await browser.storage.session.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

async function setEnabledTabs(map) {
  await browser.storage.session.set({ [STORAGE_KEY]: map });
}

async function getTabState(tabId) {
  const map = await getEnabledTabs();
  return map[tabId] || null;
}

async function setTabState(tabId, state) {
  const map = await getEnabledTabs();
  map[tabId] = state;
  await setEnabledTabs(map);
}

async function markTabEnabled(tabId, origin) {
  const oldState = await getTabState(tabId);
  await setTabState(tabId, {
    origin,
    initialized: oldState?.initialized || false,
    newCount: oldState?.newCount || 0,
    respCount: oldState?.respCount || 0,
    totalCount: oldState?.totalCount || 0,
    newBugs: oldState?.newBugs || [],
    respBugs: oldState?.respBugs || [],
    deadlines: oldState?.deadlines || {},
    lastUpdated: oldState?.lastUpdated || null
  });
}

async function markTabDisabled(tabId) {
  const map = await getEnabledTabs();
  delete map[tabId];
  await setEnabledTabs(map);
}

/* ============================================================ */
/* AWAY MODE / PAIRING                                           */
/* ============================================================ */

async function getAwayPairing() {
  const data = await browser.storage.local.get(AWAY_STORAGE_KEY);
  return data[AWAY_STORAGE_KEY] || null;
}

async function setAwayPairing(value) {
  await browser.storage.local.set({ [AWAY_STORAGE_KEY]: value });
}

async function clearAwayPairing() {
  await browser.storage.local.remove(AWAY_STORAGE_KEY);
}

async function workerRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      data?.message ||
      `Worker request failed (${response.status})`
    );
  }

  return data;
}

async function completePairing(code) {
  const cleanCode = String(code || "").trim();

  if (!/^\d{6}$/.test(cleanCode)) {
    throw new Error("Enter a valid 6-digit pairing code.");
  }

  const data = await workerRequest("/api/pairing/complete", {
    method: "POST",
    body: JSON.stringify({
      code: cleanCode,
      extension_id: EXTENSION_ID
    })
  });

  if (!data?.authToken) {
    throw new Error("Pairing succeeded but no auth token was returned.");
  }

  const pairing = {
    deviceId: data.deviceId || null,
    authToken: data.authToken,
    pairedAt: Date.now(),
    awayEnabled: false
  };

  // Pairing automatically starts Away Mode.
  await workerRequest("/api/away/enable", {
    method: "POST",
    headers: {
      "X-Auth-Token": pairing.authToken
    },
    body: JSON.stringify({ enabled: true })
  });

  pairing.awayEnabled = true;
  await setAwayPairing(pairing);

  return {
    ok: true,
    deviceId: pairing.deviceId,
    awayEnabled: true
  };
}

async function setAwayEnabled(enabled) {
  const pairing = await getAwayPairing();

  if (!pairing?.authToken) {
    throw new Error("Pair your phone first.");
  }

  const data = await workerRequest("/api/away/" + (enabled ? "enable" : "disable"), {
    method: "POST",
    headers: {
      "X-Auth-Token": pairing.authToken
    },
    body: JSON.stringify({ enabled: Boolean(enabled) })
  });

  pairing.awayEnabled = Boolean(enabled);
  await setAwayPairing(pairing);

  return {
    ok: true,
    enabled: Boolean(enabled),
    server: data
  };
}

async function getAwayStatus() {
  const pairing = await getAwayPairing();

  if (!pairing?.authToken) {
    return {
      paired: false,
      awayEnabled: false
    };
  }

  try {
    const data = await workerRequest("/api/away/status", {
      method: "GET",
      headers: {
        "X-Auth-Token": pairing.authToken
      }
    });

    let enabled = Boolean(
      data?.enabled ??
      data?.awayEnabled ??
      pairing.awayEnabled
    );

    // Away Mode is automatic while the phone is paired.
    if (!enabled) {
      await workerRequest("/api/away/enable", {
        method: "POST",
        headers: {
          "X-Auth-Token": pairing.authToken
        },
        body: JSON.stringify({ enabled: true })
      });
      enabled = true;
    }

    pairing.awayEnabled = enabled;
    await setAwayPairing(pairing);

    return {
      paired: true,
      awayEnabled: enabled,
      deviceId: pairing.deviceId || data?.deviceId || null
    };
  } catch (error) {
    return {
      paired: true,
      awayEnabled: Boolean(pairing.awayEnabled),
      deviceId: pairing.deviceId || null,
      error: error.message || String(error)
    };
  }
}

function buildAwayMessage(bug) {
  const lines = [];

  const summary = String(bug?.summary || "").trim();
  lines.push(`#${bug?.id ?? "?"}${summary ? ` — ${summary}` : ""}`);

  if (bug?.caseNo && bug.caseNo !== "—") {
    lines.push(`Case: ${bug.caseNo}`);
  }

  if (bug?.eta !== null && bug?.eta !== undefined && String(bug.eta).trim() !== "") {
    lines.push(`ETA: ${bug.eta}`);
  }

  if (bug?.status) {
    lines.push(`Status: ${bug.status}`);
  }

  return lines.join("\n");
}

async function sendAwayEvent(eventType, bug) {
  const pairing = await getAwayPairing();

  if (!pairing?.authToken || !pairing.awayEnabled) {
    return;
  }

  try {
    await workerRequest("/api/away/event", {
      method: "POST",
      headers: {
        "X-Auth-Token": pairing.authToken
      },
      body: JSON.stringify({
        eventId: [
          eventType,
          String(bug.id),
          Math.floor(Date.now() / 60000)
        ].join(":"),
        eventType,
        bugId: String(bug.id),
        message: buildAwayMessage(bug),
        bug: {
          id: bug.id,
          summary: bug.summary || "",
          caseNo: bug.caseNo || "—",
          eta: bug.eta ?? null,
          status: bug.status || ""
        }
      })
    });
  } catch (error) {
    console.warn("Away Mode event failed:", error);
  }
}

/* ============================================================ */
/* PERMISSION                                                    */
/* ============================================================ */

function getPermissionPattern(origin) {
  return origin.endsWith("/*") ? origin : origin + "/*";
}

/* ============================================================ */
/* URL CHECK                                                     */
/* ============================================================ */

function originMatchesTabUrl(origin, tabUrl) {
  try {
    const tabOrigin = new URL(tabUrl).origin;
    const storedOrigin = origin.replace(/\/\*$/, "");
    return tabOrigin === storedOrigin;
  } catch {
    return false;
  }
}

/* ============================================================ */
/* SCRIPT INJECTION                                              */
/* ============================================================ */

async function injectContentScript(tabId) {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (error) {
    console.warn("Bugzilla Counter injection failed:", error);
  }
}

/* ============================================================ */
/* ETA                                                           */
/* ============================================================ */

function parseEtaMinutes(eta) {
  const text = String(eta ?? "").trim().toLowerCase();

  if (!text || text === "-" || text === "n/a") {
    return null;
  }

  const sign = text.startsWith("-") ? -1 : 1;
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*m/);
  const secondMatch = text.match(/(\d+(?:\.\d+)?)\s*s/);

  const hours = Number(hourMatch ? hourMatch[1] : 0);
  const minutes = Number(minuteMatch ? minuteMatch[1] : 0);
  const seconds = Number(secondMatch ? secondMatch[1] : 0);

  return sign * (hours * 60 + minutes + seconds / 60);
}

function formatEta(minutes) {
  if (minutes === null || minutes === undefined) return "unknown";

  const rounded = Math.ceil(Math.abs(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;

  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/* ============================================================ */
/* ALARM NAMES                                                   */
/* ============================================================ */

function warningAlarmName(tabId, status, bugId, warningMinutes) {
  return [
    "bc", "warning", tabId, status,
    encodeURIComponent(String(bugId)), warningMinutes
  ].join(":");
}

function overdueAlarmName(tabId, bugId) {
  return [
    "bc", "overdue", tabId, "NEW",
    encodeURIComponent(String(bugId))
  ].join(":");
}

/* ============================================================ */
/* NOTIFICATIONS                                                  */
/* ============================================================ */

function makeNotificationId(type, tabId, bugId, extra = "") {
  return [
    "bc", type, tabId,
    encodeURIComponent(String(bugId)), extra
  ].join("-");
}

async function notifyBug(notificationId, title, bug, extraMessage) {
  let message = `#${bug.id} — ${bug.summary}`;

  if (bug.caseNo && bug.caseNo !== "—") {
    message += `\nCase: ${bug.caseNo}`;
  }

  if (extraMessage) message += `\n${extraMessage}`;

  try {
    await browser.notifications.create(notificationId, {
      type: "basic",
      title,
      message,
      iconUrl: browser.runtime.getURL("icon.svg")
    });
  } catch (error) {
    console.warn("Notification failed:", error);
  }
}

/* ============================================================ */
/* NEW BUG DETECTION                                             */
/* ============================================================ */

async function notifyNewBugs(tabId, oldBugs, currentBugs) {
  const oldIds = new Set((oldBugs || []).map((bug) => String(bug.id)));
  const newBugs = (currentBugs || []).filter(
    (bug) => !oldIds.has(String(bug.id))
  );

  if (newBugs.length === 0) return;

  if (newBugs.length === 1) {
    const bug = newBugs[0];

    await notifyBug(
      makeNotificationId("new", tabId, bug.id, Date.now()),
      "🔴 New Bugzilla Bug",
      bug,
      "🆕 NEW BUG DETECTED"
    );

    await sendAwayEvent("NEW_BUG", bug);
    return;
  }

  let message = `${newBugs.length} new NEW bugs detected.\n`;

  for (const bug of newBugs.slice(0, 5)) {
    message += `#${bug.id} — ${bug.summary}\n`;
  }

  if (newBugs.length > 5) {
    message += `+${newBugs.length - 5} more`;
  }

  try {
    await browser.notifications.create(
      makeNotificationId("new-multiple", tabId, Date.now()),
      {
        type: "basic",
        title: `🔴 ${newBugs.length} New Bugs`,
        message,
        iconUrl: browser.runtime.getURL("icon.svg")
      }
    );
  } catch (error) {
    console.warn("Notification failed:", error);
  }

  for (const bug of newBugs) {
    await sendAwayEvent("NEW_BUG", bug);
  }
}

/* ============================================================ */
/* DEADLINE STATE                                                */
/* ============================================================ */

function deadlineKey(status, bugId) {
  return `${status}:${String(bugId)}`;
}

function getDeadline(state, status, bugId) {
  if (!state.deadlines) state.deadlines = {};
  return state.deadlines[deadlineKey(status, bugId)] || null;
}

function saveDeadline(state, status, bugId, value) {
  if (!state.deadlines) state.deadlines = {};
  state.deadlines[deadlineKey(status, bugId)] = value;
}

/* ============================================================ */
/* NORMAL DEADLINE WARNINGS                                      */
/* ============================================================ */

async function scheduleDeadlineWarnings(tabId, state, bug) {
  const status = bug.status === "NEW" ? "NEW" : "RESP";
  const etaMinutes = parseEtaMinutes(bug.eta);

  if (etaMinutes === null) return;

  if (etaMinutes < 0) {
    if (status === "NEW") {
      await scheduleOverdueNew(tabId, state, bug);
    }
    return;
  }

  let deadline = getDeadline(state, status, bug.id);

  if (!deadline || !deadline.deadlineAt) {
    deadline = {
      deadlineAt: Date.now() + etaMinutes * 60 * 1000,
      warningsSent: [],
      overdueNotified: false
    };
    saveDeadline(state, status, bug.id, deadline);
  }

  for (const warningMinutes of WARNING_MINUTES) {
    const alarmTime = deadline.deadlineAt - warningMinutes * 60 * 1000;
    if (alarmTime <= Date.now()) continue;

    const alarmName = warningAlarmName(
      tabId, status, bug.id, warningMinutes
    );

    const existing = await browser.alarms.get(alarmName);
    if (!existing) {
      await browser.alarms.create(alarmName, { when: alarmTime });
    }
  }
}

/* ============================================================ */
/* OVERDUE NEW                                                   */
/* ============================================================ */

async function scheduleOverdueNew(tabId, state, bug) {
  if (bug.status !== "NEW") return;

  let deadline = getDeadline(state, "NEW", bug.id);

  if (!deadline) {
    deadline = {
      deadlineAt: Date.now(),
      warningsSent: [],
      overdueNotified: false
    };
    saveDeadline(state, "NEW", bug.id, deadline);
  }

  if (!deadline.overdueNotified) {
    await notifyOverdueNew(tabId, bug);
    deadline.overdueNotified = true;
    saveDeadline(state, "NEW", bug.id, deadline);
  }

  const alarmName = overdueAlarmName(tabId, bug.id);
  const existing = await browser.alarms.get(alarmName);

  if (!existing) {
    await browser.alarms.create(alarmName, {
      delayInMinutes: OVERDUE_REPEAT_MINUTES,
      periodInMinutes: OVERDUE_REPEAT_MINUTES
    });
  }
}

async function notifyOverdueNew(tabId, bug) {
  const eta = parseEtaMinutes(bug.eta);
  const overdueText = eta !== null
    ? `${formatEta(eta)} overdue`
    : "deadline exceeded";

  await notifyBug(
    makeNotificationId("overdue", tabId, bug.id, Date.now()),
    "🚨🚨 NEW BUG OVERDUE 🚨🚨",
    bug,
    `⛔ RESPONSE TIME EXCEEDED\n⏱ ${overdueText}`
  );

  await sendAwayEvent("OVERDUE_NEW", bug);
}

/* ============================================================ */
/* CLEAR ALARMS                                                  */
/* ============================================================ */

async function clearBugAlarms(tabId, status, bugId) {
  for (const minutes of WARNING_MINUTES) {
    await browser.alarms.clear(
      warningAlarmName(tabId, status, bugId, minutes)
    );
  }

  if (status === "NEW") {
    await browser.alarms.clear(overdueAlarmName(tabId, bugId));
  }
}

/* ============================================================ */
/* UPDATE DEADLINE TRACKING                                      */
/* ============================================================ */

async function updateDeadlineTracking(tabId, state, newBugs, respBugs) {
  const currentKeys = new Set();

  for (const bug of newBugs) {
    currentKeys.add(deadlineKey("NEW", bug.id));
    await scheduleDeadlineWarnings(tabId, state, bug);
  }

  for (const bug of respBugs) {
    currentKeys.add(deadlineKey("RESP", bug.id));
    await scheduleDeadlineWarnings(tabId, state, bug);
  }

  if (state.deadlines) {
    for (const key of Object.keys(state.deadlines)) {
      if (currentKeys.has(key)) continue;

      const separator = key.indexOf(":");
      const status = key.slice(0, separator);
      const bugId = key.slice(separator + 1);

      await clearBugAlarms(tabId, status, bugId);
      delete state.deadlines[key];
    }
  }
}

/* ============================================================ */
/* MESSAGES                                                      */
/* ============================================================ */

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "getState") {
    const state = await getTabState(message.tabId);

    if (!state) return { enabled: false };

    return {
      enabled: true,
      newCount: state.newCount || 0,
      respCount: state.respCount || 0,
      totalCount: state.totalCount || 0,
      lastUpdated: state.lastUpdated || null
    };
  }

  if (message.type === "enableTab") {
    await markTabEnabled(message.tabId, message.origin);
    await injectContentScript(message.tabId);
    return { ok: true };
  }

  if (message.type === "disableTab") {
    const tabId = message.tabId;
    const state = await getTabState(tabId);

    if (state?.deadlines) {
      for (const key of Object.keys(state.deadlines)) {
        const separator = key.indexOf(":");
        const status = key.slice(0, separator);
        const bugId = key.slice(separator + 1);
        await clearBugAlarms(tabId, status, bugId);
      }
    }

    await markTabDisabled(tabId);

    try {
      await browser.tabs.sendMessage(tabId, { type: "disable" });
    } catch {}

    try {
      await browser.action.setBadgeText({ text: "", tabId });
    } catch {}

    return { ok: true };
  }

  if (message.type === "pairPhone") {
    return completePairing(message.code);
  }

  if (message.type === "getAwayStatus") {
    return getAwayStatus();
  }

  if (message.type === "setAwayEnabled") {
    return setAwayEnabled(Boolean(message.enabled));
  }

  if (message.type === "unpairPhone") {
    const pairing = await getAwayPairing();

    if (pairing?.authToken) {
      try {
        await workerRequest("/api/away/disable", {
          method: "POST",
          headers: { "X-Auth-Token": pairing.authToken },
          body: JSON.stringify({ enabled: false })
        });
      } catch (error) {
        console.warn("Could not disable Away Mode before unpairing:", error);
      }
    }

    await clearAwayPairing();
    return { ok: true };
  }

  if (message.type === "countUpdate") {
    if (!sender.tab || sender.tab.id == null) return { ok: false };

    const tabId = sender.tab.id;
    const state = await getTabState(tabId);
    if (!state) return { ok: false };

    const newBugs = message.newBugs || [];
    const respBugs = message.respBugs || [];

    if (!state.initialized) {
      state.initialized = true;
      state.newBugs = newBugs;
      state.respBugs = respBugs;
    } else {
      await notifyNewBugs(tabId, state.newBugs || [], newBugs);
      state.newBugs = newBugs;
      state.respBugs = respBugs;
    }

    state.newCount = message.newCount || 0;
    state.respCount = message.respCount || 0;
    state.totalCount = message.totalCount || 0;
    state.lastUpdated = message.lastUpdated || Date.now();

    await updateDeadlineTracking(tabId, state, newBugs, respBugs);
    await setTabState(tabId, state);

    try {
      await browser.action.setBadgeText({
        text: String(message.newCount || 0),
        tabId
      });

      await browser.action.setBadgeBackgroundColor({
        color: "#c62828",
        tabId
      });
    } catch {}

    return { ok: true };
  }
});

/* ============================================================ */
/* ALARMS                                                        */
/* ============================================================ */

browser.alarms.onAlarm.addListener(async (alarm) => {
  const name = alarm.name || "";
  const parts = name.split(":");

  if (parts[0] === "bc" && parts[1] === "warning") {
    const tabId = Number(parts[2]);
    const status = parts[3];
    const bugId = decodeURIComponent(parts[4]);
    const warningMinutes = Number(parts[5]);

    if (!Number.isInteger(tabId)) return;

    const state = await getTabState(tabId);
    if (!state) return;

    const bugs = status === "NEW"
      ? state.newBugs || []
      : state.respBugs || [];

    const bug = bugs.find(
      (item) => String(item.id) === String(bugId)
    );

    if (!bug) return;

    const eta = parseEtaMinutes(bug.eta);
    if (eta === null || eta < 0) return;

    let title;
    if (warningMinutes === 20) {
      title = "⚠️ 20 Minutes Remaining";
    } else if (warningMinutes === 15) {
      title = "⚠️ 15 Minutes Remaining";
    } else if (warningMinutes === 10) {
      title = "🟠 10 Minutes Remaining";
    } else {
      title = "🚨 5 Minutes Remaining";
    }

    await notifyBug(
      makeNotificationId("warning", tabId, bug.id, warningMinutes),
      title,
      bug,
      `⏱ ${warningMinutes} minutes remaining`
    );

    /* Phone gets ONLY the 10-minute warning. */
    if (warningMinutes === 10) {
      await sendAwayEvent(
        status === "NEW" ? "NEW_10" : "RESP_10",
        bug
      );
    }

    return;
  }

  if (parts[0] === "bc" && parts[1] === "overdue") {
    const tabId = Number(parts[2]);
    const status = parts[3];
    const bugId = decodeURIComponent(parts[4]);

    if (status !== "NEW") return;

    const state = await getTabState(tabId);
    if (!state) return;

    const bug = (state.newBugs || []).find(
      (item) => String(item.id) === String(bugId)
    );

    if (!bug) return;

    const eta = parseEtaMinutes(bug.eta);

    if (eta === null || eta >= 0) {
      await browser.alarms.clear(alarm.name);
      return;
    }

    await notifyOverdueNew(tabId, bug);
  }
});

/* ============================================================ */
/* NOTIFICATION CLICK                                            */
/* ============================================================ */

browser.notifications.onClicked.addListener(async (notificationId) => {
  const tabs = await getEnabledTabs();

  for (const [tabId, state] of Object.entries(tabs)) {
    const bugs = [
      ...(state.newBugs || []),
      ...(state.respBugs || [])
    ];

    for (const bug of bugs) {
      const encodedId = encodeURIComponent(String(bug.id));

      if (notificationId.includes(encodedId) && bug.url) {
        try {
          await browser.tabs.create({ url: bug.url });
        } catch {}
        return;
      }
    }
  }
});

/* ============================================================ */
/* PAGE RELOAD                                                   */
/* ============================================================ */

browser.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const map = await getEnabledTabs();
  const entry = map[details.tabId];
  if (!entry) return;

  const tab = await browser.tabs.get(details.tabId).catch(() => null);
  if (!tab || !tab.url) return;

  if (!originMatchesTabUrl(entry.origin, tab.url)) {
    await markTabDisabled(details.tabId);

    try {
      await browser.action.setBadgeText({
        text: "",
        tabId: details.tabId
      });
    } catch {}

    return;
  }

  const granted = await browser.permissions.contains({
    origins: [getPermissionPattern(entry.origin)]
  });

  if (!granted) {
    await markTabDisabled(details.tabId);
    return;
  }

  await injectContentScript(details.tabId);
});

/* ============================================================ */
/* TAB CLOSED                                                    */
/* ============================================================ */

browser.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getTabState(tabId);

  if (state?.deadlines) {
    for (const key of Object.keys(state.deadlines)) {
      const separator = key.indexOf(":");
      const status = key.slice(0, separator);
      const bugId = key.slice(separator + 1);
      await clearBugAlarms(tabId, status, bugId);
    }
  }

  await markTabDisabled(tabId);
});
