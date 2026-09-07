const STORAGE_KEY =
  "enabledTabs";

const WARNING_MINUTES = [
  20,
  15,
  10,
  5
];

const OVERDUE_REPEAT_MINUTES =
  5;


/* ============================================================ */
/* STORAGE                                                       */
/* ============================================================ */

async function getEnabledTabs() {
  const data =
    await browser.storage.session.get(
      STORAGE_KEY
    );

  return (
    data[STORAGE_KEY] || {}
  );
}


async function setEnabledTabs(
  map
) {
  await browser.storage.session.set({
    [STORAGE_KEY]: map
  });
}


async function getTabState(
  tabId
) {
  const map =
    await getEnabledTabs();

  return (
    map[tabId] || null
  );
}


async function setTabState(
  tabId,
  state
) {
  const map =
    await getEnabledTabs();

  map[tabId] = state;

  await setEnabledTabs(map);
}


async function markTabEnabled(
  tabId,
  origin
) {
  const oldState =
    await getTabState(
      tabId
    );


  await setTabState(
    tabId,
    {
      origin,

      initialized:
        oldState?.initialized ||
        false,

      newCount:
        oldState?.newCount ||
        0,

      respCount:
        oldState?.respCount ||
        0,

      totalCount:
        oldState?.totalCount ||
        0,

      newBugs:
        oldState?.newBugs ||
        [],

      respBugs:
        oldState?.respBugs ||
        [],

      deadlines:
        oldState?.deadlines ||
        {},

      lastUpdated:
        oldState?.lastUpdated ||
        null
    }
  );
}


async function markTabDisabled(
  tabId
) {
  const map =
    await getEnabledTabs();

  delete map[tabId];

  await setEnabledTabs(map);
}


/* ============================================================ */
/* PERMISSION                                                    */
/* ============================================================ */

function getPermissionPattern(
  origin
) {
  return origin.endsWith("/*")
    ? origin
    : origin + "/*";
}


/* ============================================================ */
/* URL CHECK                                                     */
/* ============================================================ */

function originMatchesTabUrl(
  origin,
  tabUrl
) {
  try {
    const tabOrigin =
      new URL(tabUrl).origin;

    const storedOrigin =
      origin.replace(
        /\/\*$/,
        ""
      );

    return (
      tabOrigin === storedOrigin
    );
  } catch {
    return false;
  }
}


/* ============================================================ */
/* SCRIPT INJECTION                                              */
/* ============================================================ */

async function injectContentScript(
  tabId
) {
  try {
    await browser.scripting.executeScript({
      target: {
        tabId
      },

      files: [
        "content.js"
      ]
    });
  } catch (error) {
    console.warn(
      "Bugzilla Counter injection failed:",
      error
    );
  }
}


/* ============================================================ */
/* ETA                                                           */
/* ============================================================ */

function parseEtaMinutes(
  eta
) {
  const text =
    String(eta ?? "")
      .trim()
      .toLowerCase();


  if (
    !text ||
    text === "-" ||
    text === "n/a"
  ) {
    return null;
  }


  const sign =
    text.startsWith("-")
      ? -1
      : 1;


  const hourMatch =
    text.match(
      /(\d+(?:\.\d+)?)\s*h/
    );


  const minuteMatch =
    text.match(
      /(\d+(?:\.\d+)?)\s*m/
    );


  const secondMatch =
    text.match(
      /(\d+(?:\.\d+)?)\s*s/
    );


  const hours =
    Number(
      hourMatch
        ? hourMatch[1]
        : 0
    );


  const minutes =
    Number(
      minuteMatch
        ? minuteMatch[1]
        : 0
    );


  const seconds =
    Number(
      secondMatch
        ? secondMatch[1]
        : 0
    );


  const total =
    hours * 60 +
    minutes +
    seconds / 60;


  return sign * total;
}


/* ============================================================ */
/* FORMATTING                                                    */
/* ============================================================ */

function formatEta(
  minutes
) {
  if (
    minutes === null ||
    minutes === undefined
  ) {
    return "unknown";
  }


  const rounded =
    Math.ceil(
      Math.abs(minutes)
    );


  const hours =
    Math.floor(
      rounded / 60
    );


  const mins =
    rounded % 60;


  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }


  return `${mins}m`;
}


/* ============================================================ */
/* ALARM NAMES                                                   */
/* ============================================================ */

function warningAlarmName(
  tabId,
  status,
  bugId,
  warningMinutes
) {
  return [
    "bc",
    "warning",
    tabId,
    status,
    encodeURIComponent(
      String(bugId)
    ),
    warningMinutes
  ].join(":");
}


function overdueAlarmName(
  tabId,
  bugId
) {
  return [
    "bc",
    "overdue",
    tabId,
    "NEW",
    encodeURIComponent(
      String(bugId)
    )
  ].join(":");
}


/* ============================================================ */
/* NOTIFICATIONS                                                  */
/* ============================================================ */

function makeNotificationId(
  type,
  tabId,
  bugId,
  extra = ""
) {
  return [
    "bc",
    type,
    tabId,
    encodeURIComponent(
      String(bugId)
    ),
    extra
  ].join("-");
}


async function notifyBug(
  notificationId,
  title,
  bug,
  extraMessage
) {
  let message =
    `#${bug.id} — ${bug.summary}`;


  if (
    bug.caseNo &&
    bug.caseNo !== "—"
  ) {
    message +=
      `\nCase: ${bug.caseNo}`;
  }


  if (extraMessage) {
    message +=
      `\n${extraMessage}`;
  }


  try {
    await browser.notifications.create(
      notificationId,
      {
        type: "basic",

        title,

        message,

        iconUrl:
          browser.runtime.getURL(
            "icon.svg"
          )
      }
    );
  } catch (error) {
    console.warn(
      "Notification failed:",
      error
    );
  }
}


/* ============================================================ */
/* NEW BUG DETECTION                                             */
/* ============================================================ */

async function notifyNewBugs(
  tabId,
  oldBugs,
  currentBugs
) {
  const oldIds =
    new Set(
      (oldBugs || []).map(
        (bug) =>
          String(bug.id)
      )
    );


  const newBugs =
    (currentBugs || []).filter(
      (bug) =>
        !oldIds.has(
          String(bug.id)
        )
    );


  if (
    newBugs.length === 0
  ) {
    return;
  }


  /*
   * One new bug:
   */

  if (
    newBugs.length === 1
  ) {
    const bug =
      newBugs[0];


    await notifyBug(
      makeNotificationId(
        "new",
        tabId,
        bug.id,
        Date.now()
      ),

      "🔴 New Bugzilla Bug",

      bug,

      "🆕 NEW BUG DETECTED"
    );

    return;
  }


  /*
   * Multiple new bugs:
   * group them into one notification.
   */

  let message =
    `${newBugs.length} new NEW bugs detected.\n`;


  for (
    const bug of
    newBugs.slice(0, 5)
  ) {
    message +=
      `#${bug.id} — ${bug.summary}\n`;
  }


  if (
    newBugs.length > 5
  ) {
    message +=
      `+${newBugs.length - 5} more`;
  }


  try {
    await browser.notifications.create(
      makeNotificationId(
        "new-multiple",
        tabId,
        Date.now()
      ),
      {
        type: "basic",

        title:
          `🔴 ${newBugs.length} New Bugs`,

        message,

        iconUrl:
          browser.runtime.getURL(
            "icon.svg"
          )
      }
    );
  } catch (error) {
    console.warn(
      "Notification failed:",
      error
    );
  }
}


/* ============================================================ */
/* DEADLINE STATE                                                */
/* ============================================================ */

function deadlineKey(
  status,
  bugId
) {
  return (
    `${status}:${String(bugId)}`
  );
}


function getDeadline(
  state,
  status,
  bugId
) {
  if (
    !state.deadlines
  ) {
    state.deadlines = {};
  }


  return (
    state.deadlines[
      deadlineKey(
        status,
        bugId
      )
    ] || null
  );
}


function saveDeadline(
  state,
  status,
  bugId,
  value
) {
  if (
    !state.deadlines
  ) {
    state.deadlines = {};
  }


  state.deadlines[
    deadlineKey(
      status,
      bugId
    )
  ] = value;
}


/* ============================================================ */
/* NORMAL DEADLINE WARNINGS                                      */
/* ============================================================ */

async function scheduleDeadlineWarnings(
  tabId,
  state,
  bug
) {
  const status =
    bug.status === "NEW"
      ? "NEW"
      : "RESP";


  const etaMinutes =
    parseEtaMinutes(
      bug.eta
    );


  if (
    etaMinutes === null
  ) {
    return;
  }


  /*
   * Negative ETA:
   *
   * NEW -> overdue handling
   * RESP -> NOTHING
   */

  if (
    etaMinutes < 0
  ) {
    if (
      status === "NEW"
    ) {
      await scheduleOverdueNew(
        tabId,
        state,
        bug
      );
    }

    return;
  }


  /*
   * Existing deadline is retained.
   *
   * This is important because a page
   * refresh must NOT restart the timer.
   */

  let deadline =
    getDeadline(
      state,
      status,
      bug.id
    );


  if (
    !deadline ||
    !deadline.deadlineAt
  ) {
    deadline = {
      deadlineAt:
        Date.now() +
        etaMinutes *
          60 *
          1000,

      warningsSent: [],

      overdueNotified: false
    };


    saveDeadline(
      state,
      status,
      bug.id,
      deadline
    );
  }


  for (
    const warningMinutes
    of WARNING_MINUTES
  ) {
    const alarmTime =
      deadline.deadlineAt -
      warningMinutes *
        60 *
        1000;


    if (
      alarmTime <=
      Date.now()
    ) {
      continue;
    }


    const alarmName =
      warningAlarmName(
        tabId,
        status,
        bug.id,
        warningMinutes
      );


    const existing =
      await browser.alarms.get(
        alarmName
      );


    if (!existing) {
      await browser.alarms.create(
        alarmName,
        {
          when: alarmTime
        }
      );
    }
  }
}


/* ============================================================ */
/* OVERDUE NEW                                                   */
/* ============================================================ */

async function scheduleOverdueNew(
  tabId,
  state,
  bug
) {
  /*
   * Absolute safety check:
   * only NEW can reach here.
   */

  if (
    bug.status !== "NEW"
  ) {
    return;
  }


  let deadline =
    getDeadline(
      state,
      "NEW",
      bug.id
    );


  if (!deadline) {
    deadline = {
      deadlineAt:
        Date.now(),

      warningsSent: [],

      overdueNotified: false
    };


    saveDeadline(
      state,
      "NEW",
      bug.id,
      deadline
    );
  }


  /*
   * Immediate dramatic notification
   * the first time it becomes overdue.
   */

  if (
    !deadline.overdueNotified
  ) {
    await notifyOverdueNew(
      tabId,
      bug
    );


    deadline.overdueNotified =
      true;


    saveDeadline(
      state,
      "NEW",
      bug.id,
      deadline
    );
  }


  /*
   * Repeat every five minutes.
   */

  const alarmName =
    overdueAlarmName(
      tabId,
      bug.id
    );


  const existing =
    await browser.alarms.get(
      alarmName
    );


  if (!existing) {
    await browser.alarms.create(
      alarmName,
      {
        delayInMinutes:
          OVERDUE_REPEAT_MINUTES,

        periodInMinutes:
          OVERDUE_REPEAT_MINUTES
      }
    );
  }
}


async function notifyOverdueNew(
  tabId,
  bug
) {
  const eta =
    parseEtaMinutes(
      bug.eta
    );


  const overdueText =
    eta !== null
      ? `${formatEta(
          eta
        )} overdue`
      : "deadline exceeded";


  await notifyBug(
    makeNotificationId(
      "overdue",
      tabId,
      bug.id,
      Date.now()
    ),

    "🚨🚨 NEW BUG OVERDUE 🚨🚨",

    bug,

    `⛔ RESPONSE TIME EXCEEDED\n⏱ ${overdueText}`
  );
}


/* ============================================================ */
/* CLEAR ALARMS                                                  */
/* ============================================================ */

async function clearBugAlarms(
  tabId,
  status,
  bugId
) {
  for (
    const minutes
    of WARNING_MINUTES
  ) {
    await browser.alarms.clear(
      warningAlarmName(
        tabId,
        status,
        bugId,
        minutes
      )
    );
  }


  if (
    status === "NEW"
  ) {
    await browser.alarms.clear(
      overdueAlarmName(
        tabId,
        bugId
      )
    );
  }
}


/* ============================================================ */
/* UPDATE DEADLINE TRACKING                                      */
/* ============================================================ */

async function updateDeadlineTracking(
  tabId,
  state,
  newBugs,
  respBugs
) {
  const currentKeys =
    new Set();


  /*
   * NEW
   */

  for (
    const bug of newBugs
  ) {
    currentKeys.add(
      deadlineKey(
        "NEW",
        bug.id
      )
    );


    await scheduleDeadlineWarnings(
      tabId,
      state,
      bug
    );
  }


  /*
   * RESP
   */

  for (
    const bug of respBugs
  ) {
    currentKeys.add(
      deadlineKey(
        "RESP",
        bug.id
      )
    );


    await scheduleDeadlineWarnings(
      tabId,
      state,
      bug
    );
  }


  /*
   * Remove bugs that disappeared
   * from the table.
   */

  if (
    state.deadlines
  ) {
    for (
      const key of
      Object.keys(
        state.deadlines
      )
    ) {
      if (
        currentKeys.has(key)
      ) {
        continue;
      }


      const separator =
        key.indexOf(":");


      const status =
        key.slice(
          0,
          separator
        );


      const bugId =
        key.slice(
          separator + 1
        );


      await clearBugAlarms(
        tabId,
        status,
        bugId
      );


      delete state.deadlines[
        key
      ];
    }
  }
}


/* ============================================================ */
/* MESSAGES                                                      */
/* ============================================================ */

browser.runtime.onMessage.addListener(
  async (
    message,
    sender
  ) => {
    if (
      !message ||
      typeof message !== "object"
    ) {
      return;
    }


    /* -------------------------------------------------------- */
    /* GET STATE                                                  */
    /* -------------------------------------------------------- */

    if (
      message.type ===
      "getState"
    ) {
      const state =
        await getTabState(
          message.tabId
        );


      if (!state) {
        return {
          enabled: false
        };
      }


      return {
        enabled: true,

        newCount:
          state.newCount || 0,

        respCount:
          state.respCount || 0,

        totalCount:
          state.totalCount || 0,

        lastUpdated:
          state.lastUpdated ||
          null
      };
    }


    /* -------------------------------------------------------- */
    /* ENABLE                                                      */
    /* -------------------------------------------------------- */

    if (
      message.type ===
      "enableTab"
    ) {
      await markTabEnabled(
        message.tabId,
        message.origin
      );


      await injectContentScript(
        message.tabId
      );


      return {
        ok: true
      };
    }


    /* -------------------------------------------------------- */
    /* DISABLE                                                     */
    /* -------------------------------------------------------- */

    if (
      message.type ===
      "disableTab"
    ) {
      const tabId =
        message.tabId;


      const state =
        await getTabState(
          tabId
        );


      if (
        state?.deadlines
      ) {
        for (
          const key of
          Object.keys(
            state.deadlines
          )
        ) {
          const separator =
            key.indexOf(":");


          const status =
            key.slice(
              0,
              separator
            );


          const bugId =
            key.slice(
              separator + 1
            );


          await clearBugAlarms(
            tabId,
            status,
            bugId
          );
        }
      }


      await markTabDisabled(
        tabId
      );


      try {
        await browser.tabs.sendMessage(
          tabId,
          {
            type: "disable"
          }
        );
      } catch {}


      try {
        await browser.action.setBadgeText(
          {
            text: "",
            tabId
          }
        );
      } catch {}


      return {
        ok: true
      };
    }


    /* -------------------------------------------------------- */
    /* COUNT UPDATE                                                */
    /* -------------------------------------------------------- */

    if (
      message.type ===
      "countUpdate"
    ) {
      if (
        !sender.tab ||
        sender.tab.id == null
      ) {
        return {
          ok: false
        };
      }


      const tabId =
        sender.tab.id;


      const state =
        await getTabState(
          tabId
        );


      /*
       * Ignore updates from tabs
       * that aren't enabled.
       */

      if (!state) {
        return {
          ok: false
        };
      }


      const newBugs =
        message.newBugs || [];


      const respBugs =
        message.respBugs || [];


      /*
       * FIRST UPDATE:
       *
       * Establish baseline.
       *
       * Existing NEW bugs do not
       * generate "new bug" notifications.
       */

      if (
        !state.initialized
      ) {
        state.initialized =
          true;

        state.newBugs =
          newBugs;

        state.respBugs =
          respBugs;
      } else {
        /*
         * Detect genuinely new NEW bugs.
         */

        await notifyNewBugs(
          tabId,
          state.newBugs || [],
          newBugs
        );


        state.newBugs =
          newBugs;

        state.respBugs =
          respBugs;
      }


      state.newCount =
        message.newCount || 0;


      state.respCount =
        message.respCount || 0;


      state.totalCount =
        message.totalCount || 0;


      state.lastUpdated =
        message.lastUpdated ||
        Date.now();


      /*
       * Schedule / maintain deadline
       * alarms.
       */

      await updateDeadlineTracking(
        tabId,
        state,
        newBugs,
        respBugs
      );


      await setTabState(
        tabId,
        state
      );


      /*
       * Toolbar badge = NEW count.
       */

      try {
        await browser.action.setBadgeText(
          {
            text:
              String(
                message.newCount || 0
              ),

            tabId
          }
        );


        await browser.action.setBadgeBackgroundColor(
          {
            color:
              "#c62828",

            tabId
          }
        );
      } catch {}


      return {
        ok: true
      };
    }
  }
);


/* ============================================================ */
/* ALARMS                                                        */
/* ============================================================ */

browser.alarms.onAlarm.addListener(
  async (alarm) => {
    const name =
      alarm.name || "";


    const parts =
      name.split(":");


    /* -------------------------------------------------------- */
    /* NORMAL WARNING                                             */
    /* -------------------------------------------------------- */

    if (
      parts[0] === "bc" &&
      parts[1] === "warning"
    ) {
      const tabId =
        Number(parts[2]);


      const status =
        parts[3];


      const bugId =
        decodeURIComponent(
          parts[4]
        );


      const warningMinutes =
        Number(parts[5]);


      if (
        !Number.isInteger(
          tabId
        )
      ) {
        return;
      }


      const state =
        await getTabState(
          tabId
        );


      if (!state) {
        return;
      }


      const bugs =
        status === "NEW"
          ? state.newBugs || []
          : state.respBugs || [];


      const bug =
        bugs.find(
          (item) =>
            String(item.id) ===
            String(bugId)
        );


      if (!bug) {
        return;
      }


      const eta =
        parseEtaMinutes(
          bug.eta
        );


      /*
       * If it is already overdue,
       * don't show normal warning.
       */

      if (
        eta === null ||
        eta < 0
      ) {
        return;
      }


      let title;


      if (
        warningMinutes === 20
      ) {
        title =
          "⚠️ 20 Minutes Remaining";
      } else if (
        warningMinutes === 15
      ) {
        title =
          "⚠️ 15 Minutes Remaining";
      } else if (
        warningMinutes === 10
      ) {
        title =
          "🟠 10 Minutes Remaining";
      } else {
        title =
          "🚨 5 Minutes Remaining";
      }


      await notifyBug(
        makeNotificationId(
          "warning",
          tabId,
          bug.id,
          warningMinutes
        ),

        title,

        bug,

        `⏱ ${warningMinutes} minutes remaining`
      );


      return;
    }


    /* -------------------------------------------------------- */
    /* OVERDUE                                                    */
    /* -------------------------------------------------------- */

    if (
      parts[0] === "bc" &&
      parts[1] === "overdue"
    ) {
      const tabId =
        Number(parts[2]);


      const status =
        parts[3];


      const bugId =
        decodeURIComponent(
          parts[4]
        );


      /*
       * ABSOLUTE RULE:
       *
       * Only NEW is allowed here.
       */

      if (
        status !== "NEW"
      ) {
        return;
      }


      const state =
        await getTabState(
          tabId
        );


      if (!state) {
        return;
      }


      const bug =
        (
          state.newBugs || []
        ).find(
          (item) =>
            String(item.id) ===
            String(bugId)
        );


      if (!bug) {
        return;
      }


      const eta =
        parseEtaMinutes(
          bug.eta
        );


      /*
       * It is no longer overdue.
       * Stop repeating.
       */

      if (
        eta === null ||
        eta >= 0
      ) {
        await browser.alarms.clear(
          alarm.name
        );

        return;
      }


      /*
       * Still overdue:
       * notify again.
       */

      await notifyOverdueNew(
        tabId,
        bug
      );
    }
  }
);


/* ============================================================ */
/* NOTIFICATION CLICK                                            */
/* ============================================================ */

browser.notifications.onClicked.addListener(
  async (
    notificationId
  ) => {
    const tabs =
      await getEnabledTabs();


    /*
     * Find the bug associated with
     * the notification.
     */

    for (
      const [
        tabId,
        state
      ] of Object.entries(
        tabs
      )
    ) {
      const bugs = [
        ...(state.newBugs || []),
        ...(state.respBugs || [])
      ];


      for (
        const bug of bugs
      ) {
        const encodedId =
          encodeURIComponent(
            String(bug.id)
          );


        if (
          notificationId.includes(
            encodedId
          ) &&
          bug.url
        ) {
          try {
            await browser.tabs.create({
              url: bug.url
            });
          } catch {}


          return;
        }
      }
    }
  }
);


/* ============================================================ */
/* PAGE RELOAD                                                   */
/* ============================================================ */

browser.webNavigation.onCompleted.addListener(
  async (details) => {
    /*
     * Main frame only.
     */

    if (
      details.frameId !== 0
    ) {
      return;
    }


    const map =
      await getEnabledTabs();


    const entry =
      map[details.tabId];


    if (!entry) {
      return;
    }


    const tab =
      await browser.tabs
        .get(
          details.tabId
        )
        .catch(
          () => null
        );


    if (
      !tab ||
      !tab.url
    ) {
      return;
    }


    /*
     * Navigated to another origin:
     * disable monitoring.
     */

    if (
      !originMatchesTabUrl(
        entry.origin,
        tab.url
      )
    ) {
      await markTabDisabled(
        details.tabId
      );


      try {
        await browser.action.setBadgeText({
          text: "",
          tabId:
            details.tabId
        });
      } catch {}


      return;
    }


    /*
     * Verify permission.
     */

    const granted =
      await browser.permissions.contains({
        origins: [
          getPermissionPattern(
            entry.origin
          )
        ]
      });


    if (!granted) {
      await markTabDisabled(
        details.tabId
      );

      return;
    }


    /*
     * Reinject after reload.
     */

    await injectContentScript(
      details.tabId
    );
  }
);


/* ============================================================ */
/* TAB CLOSED                                                    */
/* ============================================================ */

browser.tabs.onRemoved.addListener(
  async (tabId) => {
    const state =
      await getTabState(
        tabId
      );


    /*
     * Clean up alarms.
     */

    if (
      state?.deadlines
    ) {
      for (
        const key of
        Object.keys(
          state.deadlines
        )
      ) {
        const separator =
          key.indexOf(":");


        const status =
          key.slice(
            0,
            separator
          );


        const bugId =
          key.slice(
            separator + 1
          );


        await clearBugAlarms(
          tabId,
          status,
          bugId
        );
      }
    }


    await markTabDisabled(
      tabId
    );
  }
);
