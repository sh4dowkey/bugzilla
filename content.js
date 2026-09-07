(function () {
  if (
    window.__bugzillaNewCounterActive
  ) {
    return;
  }

  window.__bugzillaNewCounterActive =
    true;


  const NEW_STATUS = "NEW";

  const RESP_STATUSES =
    new Set([
      "RESP",
      "RESPONDED"
    ]);


  let observer = null;

  let rotationTimer = null;

  let overdueTimer = null;


  let originalFaviconLink = null;

  let originalFaviconHref = null;

  let badgeLink = null;


  let currentCounts = {
    newCount: 0,
    respCount: 0,
    totalCount: 0
  };


  let currentBugLists = {
    newBugs: [],
    respBugs: []
  };


  let rotationIndex = 0;


  /* ========================================================= */
  /* TABLE                                                      */
  /* ========================================================= */

  function findBugTable() {
    return (
      document.getElementById(
        "buglist_table"
      ) ||
      document.querySelector(
        "table.bz_buglist"
      )
    );
  }


  function getHeaderCells(table) {
    const headerRow =
      table.querySelector(
        "thead tr"
      ) ||
      table.querySelector(
        "tr"
      );

    if (!headerRow) {
      return [];
    }

    return Array.from(
      headerRow.children
    ).filter(
      (el) =>
        el.tagName === "TH" ||
        el.tagName === "TD"
    );
  }


  function normalizeHeader(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/:$/, "");
  }


  function findColumnIndex(
    table,
    names
  ) {
    const headers =
      getHeaderCells(table);

    for (
      let i = 0;
      i < headers.length;
      i++
    ) {
      const text =
        normalizeHeader(
          headers[i].textContent
        );

      if (
        names.includes(text)
      ) {
        return i;
      }
    }

    return -1;
  }


  function findStatusColumnIndex(
    table
  ) {
    return findColumnIndex(
      table,
      ["status"]
    );
  }


  function findIdColumnIndex(
    table
  ) {
    return findColumnIndex(
      table,
      [
        "id",
        "bug id",
        "bug"
      ]
    );
  }


  function findSummaryColumnIndex(
    table
  ) {
    return findColumnIndex(
      table,
      ["summary"]
    );
  }


  function findCaseColumnIndex(
    table
  ) {
    return findColumnIndex(
      table,
      [
        "case no",
        "case number",
        "case"
      ]
    );
  }


  function findEtaColumnIndex(
    table
  ) {
    return findColumnIndex(
      table,
      [
        "eta",
        "time remaining",
        "time"
      ]
    );
  }


  /* ========================================================= */
  /* ROWS                                                        */
  /* ========================================================= */

  function getBugRows(table) {
    const tbody =
      table.querySelector(
        "tbody"
      );

    if (!tbody) {
      return [];
    }

    return Array.from(
      tbody.querySelectorAll(
        ":scope > tr"
      )
    ).filter(
      (tr) =>
        tr.className.includes(
          "bz_bugitem"
        )
    );
  }


  function getCellText(
    cells,
    index
  ) {
    if (
      index < 0 ||
      !cells[index]
    ) {
      return "";
    }

    return cells[index]
      .textContent
      .replace(/\s+/g, " ")
      .trim();
  }


  function extractBugId(
    row,
    cells,
    idIndex
  ) {
    let bugId =
      getCellText(
        cells,
        idIndex
      );

    if (!bugId) {
      const link =
        row.querySelector(
          'a[href*="show_bug.cgi?id="]'
        );

      if (link) {
        const match =
          link.href.match(
            /[?&]id=([^&]+)/
          );

        if (match) {
          bugId =
            decodeURIComponent(
              match[1]
            );
        }
      }
    }

    return bugId;
  }


  function extractBugUrl(
    row,
    bugId
  ) {
    const link =
      row.querySelector(
        'a[href*="show_bug.cgi?id="]'
      );

    if (
      link &&
      link.href
    ) {
      return link.href;
    }

    if (bugId) {
      return new URL(
        `show_bug.cgi?id=${encodeURIComponent(
          bugId
        )}`,
        window.location.href
      ).href;
    }

    return window.location.href;
  }


  /* ========================================================= */
  /* READ BUG DATA                                               */
  /* ========================================================= */

  function readBugData() {
    const table =
      findBugTable();

    if (!table) {
      return null;
    }

    const statusIndex =
      findStatusColumnIndex(
        table
      );

    if (
      statusIndex === -1
    ) {
      return null;
    }

    const idIndex =
      findIdColumnIndex(
        table
      );

    const summaryIndex =
      findSummaryColumnIndex(
        table
      );

    const caseIndex =
      findCaseColumnIndex(
        table
      );

    const etaIndex =
      findEtaColumnIndex(
        table
      );

    const rows =
      getBugRows(table);


    let newCount = 0;

    let respCount = 0;


    const newBugs = [];

    const respBugs = [];


    for (
      const row of rows
    ) {
      const cells =
        Array.from(
          row.children
        ).filter(
          (el) =>
            el.tagName === "TD"
        );


      const status =
        getCellText(
          cells,
          statusIndex
        ).toUpperCase();


      const bugId =
        extractBugId(
          row,
          cells,
          idIndex
        );


      const summary =
        getCellText(
          cells,
          summaryIndex
        ) ||
        "(No summary)";


      const caseNo =
        getCellText(
          cells,
          caseIndex
        ) ||
        "—";


      const eta =
        getCellText(
          cells,
          etaIndex
        ) ||
        "";


      const bugUrl =
        extractBugUrl(
          row,
          bugId
        );


      const bug = {
        id:
          bugId ||
          "unknown",

        url:
          bugUrl,

        summary,

        caseNo,

        eta,

        status:
          status === NEW_STATUS
            ? "NEW"
            : "RESP"
      };


      if (
        status === NEW_STATUS
      ) {
        newCount++;

        newBugs.push(
          bug
        );
      } else if (
        RESP_STATUSES.has(
          status
        )
      ) {
        respCount++;

        respBugs.push(
          bug
        );
      }
    }


    return {
      found: true,

      newCount,

      respCount,

      totalCount:
        rows.length,

      newBugs,

      respBugs
    };
  }


  /* ========================================================= */
  /* FAVICON                                                     */
  /* ========================================================= */

  function drawBadgeDataUrl(
    count,
    type = "NEW"
  ) {
    const size = 32;


    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = size;
    canvas.height = size;


    const ctx =
      canvas.getContext(
        "2d"
      );


    ctx.clearRect(
      0,
      0,
      size,
      size
    );


    let background;


    if (
      type === "NEW"
    ) {
      background = "#c62828";
    } else if (
      type === "RESP"
    ) {
      background = "#1565c0";
    } else if (
      type === "OVERDUE"
    ) {
      background = "#8b0000";
    } else {
      background = "#607d8b";
    }


    /*
     * Nearly the entire 32x32 favicon
     * is used for the counter.
     */

    ctx.beginPath();

    ctx.arc(
      size / 2,
      size / 2,
      15.5,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      background;

    ctx.fill();


    ctx.lineWidth = 1;

    ctx.strokeStyle =
      "#ffffff";

    ctx.stroke();


    let label;


    if (
      type === "OVERDUE"
    ) {
      label = "!!";
    } else {
      label =
        count > 99
          ? "99+"
          : String(count);
    }


    /*
     * Large favicon numbers.
     */

    let fontSize;


    if (
      type === "OVERDUE"
    ) {
      fontSize = 21;
    } else if (
      label.length >= 3
    ) {
      fontSize = 15;
    } else if (
      label.length === 2
    ) {
      fontSize = 22;
    } else {
      fontSize = 25;
    }


    ctx.fillStyle =
      "#ffffff";


    ctx.font =
      `900 ${fontSize}px Arial, sans-serif`;


    ctx.textAlign =
      "center";

    ctx.textBaseline =
      "middle";


    ctx.fillText(
      label,
      size / 2,
      size / 2 + 1
    );


    return canvas.toDataURL(
      "image/png"
    );
  }


  function ensureBadgeLinkElement() {
    if (
      badgeLink &&
      badgeLink.isConnected
    ) {
      return badgeLink;
    }


    if (
      !originalFaviconLink
    ) {
      originalFaviconLink =
        document.querySelector(
          "link[rel~='icon']"
        );

      originalFaviconHref =
        originalFaviconLink
          ? originalFaviconLink.href
          : null;
    }


    badgeLink =
      document.querySelector(
        "link[data-bugzilla-new-counter]"
      ) ||
      document.createElement(
        "link"
      );


    badgeLink.setAttribute(
      "rel",
      "icon"
    );


    badgeLink.setAttribute(
      "data-bugzilla-new-counter",
      "1"
    );


    if (
      !badgeLink.isConnected
    ) {
      document.head.appendChild(
        badgeLink
      );
    }


    return badgeLink;
  }


  function setFavicon(
    count,
    type
  ) {
    const link =
      ensureBadgeLinkElement();

    link.href =
      drawBadgeDataUrl(
        count,
        type
      );
  }


  /* ========================================================= */
  /* ETA                                                        */
  /* ========================================================= */

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


  /* ========================================================= */
  /* OVERDUE VISUAL                                              */
  /* ========================================================= */

  function hasOverdueNewBug() {
    return currentBugLists.newBugs.some(
      (bug) => {
        const eta =
          parseEtaMinutes(
            bug.eta
          );

        return (
          eta !== null &&
          eta < 0
        );
      }
    );
  }


  function startOverdueVisual() {
    clearInterval(
      overdueTimer
    );

    overdueTimer = null;


    let flash = false;


    setFavicon(
      currentCounts.newCount,
      "OVERDUE"
    );


    overdueTimer =
      setInterval(() => {
        flash = !flash;


        if (flash) {
          setFavicon(
            currentCounts.newCount,
            "OVERDUE"
          );
        } else {
          setFavicon(
            currentCounts.newCount,
            "NEW"
          );
        }
      }, 1200);
  }


  function stopOverdueVisual() {
    clearInterval(
      overdueTimer
    );

    overdueTimer = null;
  }


  /* ========================================================= */
  /* ROTATION                                                    */
  /* ========================================================= */

  function getRotationItems() {
    const items = [];


    if (
      currentCounts.newCount > 0
    ) {
      items.push({
        count:
          currentCounts.newCount,

        type: "NEW"
      });
    }


    if (
      currentCounts.respCount > 0
    ) {
      items.push({
        count:
          currentCounts.respCount,

        type: "RESP"
      });
    }


    if (
      items.length === 0
    ) {
      items.push({
        count: 0,
        type: "ZERO"
      });
    }


    return items;
  }


  function updateFaviconRotation() {
    if (
      hasOverdueNewBug()
    ) {
      startOverdueVisual();

      return;
    }


    stopOverdueVisual();


    const items =
      getRotationItems();


    if (
      rotationIndex >=
      items.length
    ) {
      rotationIndex = 0;
    }


    const item =
      items[rotationIndex];


    setFavicon(
      item.count,
      item.type
    );
  }


  function restartRotation() {
    clearInterval(
      rotationTimer
    );


    rotationIndex = 0;


    updateFaviconRotation();


    rotationTimer =
      setInterval(() => {
        if (
          hasOverdueNewBug()
        ) {
          return;
        }


        const items =
          getRotationItems();


        if (
          items.length <= 1
        ) {
          updateFaviconRotation();

          return;
        }


        rotationIndex =
          (
            rotationIndex + 1
          ) %
          items.length;


        updateFaviconRotation();
      }, 3000);
  }


  /* ========================================================= */
  /* SEND UPDATE                                                 */
  /* ========================================================= */

  function sendUpdate(
    result
  ) {
    currentCounts = {
      newCount:
        result.newCount,

      respCount:
        result.respCount,

      totalCount:
        result.totalCount
    };


    currentBugLists = {
      newBugs:
        result.newBugs || [],

      respBugs:
        result.respBugs || []
    };


    browser.runtime
      .sendMessage({
        type:
          "countUpdate",

        newCount:
          result.newCount,

        respCount:
          result.respCount,

        totalCount:
          result.totalCount,

        newBugs:
          result.newBugs || [],

        respBugs:
          result.respBugs || [],

        lastUpdated:
          Date.now()
      })
      .catch(() => {});


    restartRotation();
  }


  function recompute() {
    const result =
      readBugData();


    if (!result) {
      return;
    }


    sendUpdate(result);
  }


  /* ========================================================= */
  /* OBSERVER                                                    */
  /* ========================================================= */

  function startObserving() {
    const table =
      findBugTable();


    const target =
      table ||
      document.body;


    observer =
      new MutationObserver(
        () => {
          recompute();
        }
      );


    observer.observe(
      target,
      {
        childList: true,
        subtree: true,
        characterData: true
      }
    );
  }


  /* ========================================================= */
  /* DISABLE                                                      */
  /* ========================================================= */

  function teardown() {
    if (observer) {
      observer.disconnect();

      observer = null;
    }


    clearInterval(
      rotationTimer
    );

    rotationTimer = null;


    stopOverdueVisual();


    if (badgeLink) {
      if (
        originalFaviconHref
      ) {
        badgeLink.href =
          originalFaviconHref;

        badgeLink.removeAttribute(
          "data-bugzilla-new-counter"
        );
      } else if (
        badgeLink.parentNode
      ) {
        badgeLink.parentNode.removeChild(
          badgeLink
        );
      }


      badgeLink = null;
    }


    window.__bugzillaNewCounterActive =
      false;
  }


  /* ========================================================= */
  /* BACKGROUND MESSAGE                                          */
  /* ========================================================= */

  browser.runtime.onMessage.addListener(
    (message) => {
      if (
        message &&
        message.type === "disable"
      ) {
        teardown();

        return Promise.resolve({
          ok: true
        });
      }
    }
  );


  /* ========================================================= */
  /* START                                                       */
  /* ========================================================= */

  recompute();

  startObserving();
})();
