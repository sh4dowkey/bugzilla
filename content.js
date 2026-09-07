// content.js
//
// Only ever runs in a tab after the user explicitly clicked "Enable" in
// the popup for THAT tab. Never auto-injected by manifest content_scripts.
//
// What it does:
//   1. Finds the Bugzilla bug table and locates the "Status" column by
//      reading the actual header text (not a hardcoded index), so it
//      keeps working if the site's column order changes.
//   2. Counts rows whose Status cell normalizes to exactly "NEW".
//   3. Renders that count as a small badge drawn onto the tab's favicon
//      (via a <link rel="icon"> data: URL) -- this is the closest a
//      Firefox WebExtension can get to a counter that lives visually
//      inside the tab itself, without touching document.title and
//      without overlaying the webpage.
//   4. Watches the table with a MutationObserver so in-page updates
//      (not just full reloads) refresh the count.
//   5. Listens for a "disable" message from the background script to
//      tear everything down and restore the original favicon.

(function () {
  if (window.__bugzillaNewCounterActive) {
    // Already running in this page (e.g. injected twice). Don't double up.
    return;
  }
  window.__bugzillaNewCounterActive = true;

  const TARGET_STATUS = "NEW";
  let observer = null;
  let originalFaviconLink = null;
  let originalFaviconHref = null;
  let badgeLink = null;

  function findBugTable() {
    return (
      document.getElementById("buglist_table") ||
      document.querySelector("table.bz_buglist")
    );
  }

  function findStatusColumnIndex(table) {
    const headerRow = table.querySelector("thead tr");
    if (!headerRow) return -1;
    const headers = Array.from(headerRow.children).filter((el) =>
      /^(TH|TD)$/.test(el.tagName)
    );
    for (let i = 0; i < headers.length; i++) {
      const text = headers[i].textContent.replace(/\s+/g, " ").trim().toLowerCase();
      if (text === "status") return i;
    }
    return -1;
  }

  function countNewBugs() {
    const table = findBugTable();
    if (!table) return null;

    const statusIdx = findStatusColumnIndex(table);
    if (statusIdx === -1) return null;

    const tbody = table.querySelector("tbody") || table;
    const rows = Array.from(tbody.querySelectorAll(":scope > tr")).filter((tr) =>
      tr.className.includes("bz_bugitem")
    );

    let count = 0;
    for (const row of rows) {
      const cells = Array.from(row.children).filter((el) => el.tagName === "TD");
      const statusCell = cells[statusIdx];
      if (!statusCell) continue;
      const value = statusCell.textContent.replace(/\s+/g, " ").trim().toUpperCase();
      if (value === TARGET_STATUS) count++;
    }
    return count;
  }

  function drawBadgeDataUrl(count) {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    // Base circle (bug-tracker red so it reads at a glance, even tiny/pinned).
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = count > 0 ? "#c62828" : "#607d8b";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    // Count text, shrinking font for multi-digit counts so it still fits.
    const label = count > 99 ? "99+" : String(count);
    let fontSize = label.length > 2 ? 12 : label.length > 1 ? 15 : 18;
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, size / 2, size / 2 + 1);

    return canvas.toDataURL("image/png");
  }

  function ensureBadgeLinkElement() {
    if (badgeLink && badgeLink.isConnected) return badgeLink;

    // Remember the page's original favicon link (if any) so we can restore
    // it later, then either reuse or create our own <link rel="icon">.
    if (!originalFaviconLink) {
      originalFaviconLink = document.querySelector("link[rel~='icon']");
      originalFaviconHref = originalFaviconLink ? originalFaviconLink.href : null;
    }

    badgeLink =
      document.querySelector("link[data-bugzilla-new-counter]") ||
      document.createElement("link");
    badgeLink.setAttribute("rel", "icon");
    badgeLink.setAttribute("data-bugzilla-new-counter", "1");
    if (!badgeLink.isConnected) {
      document.head.appendChild(badgeLink);
    }
    return badgeLink;
  }

  function updateBadge(count) {
    const link = ensureBadgeLinkElement();
    link.href = drawBadgeDataUrl(count);

    browser.runtime
      .sendMessage({ type: "countUpdate", count })
      .catch(() => {
        /* background may not be listening yet; harmless */
      });
  }

  function recompute() {
    const count = countNewBugs();
    if (count === null) return; // table not found yet; leave badge as-is
    updateBadge(count);
  }

  function startObserving() {
    const table = findBugTable();
    const target = table || document.body;
    observer = new MutationObserver(() => {
      recompute();
    });
    observer.observe(target, { childList: true, subtree: true, characterData: true });
  }

  function teardown() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (badgeLink) {
      if (originalFaviconHref) {
        badgeLink.href = originalFaviconHref;
        badgeLink.removeAttribute("data-bugzilla-new-counter");
      } else if (badgeLink.parentNode) {
        badgeLink.parentNode.removeChild(badgeLink);
      }
      badgeLink = null;
    }
    window.__bugzillaNewCounterActive = false;
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === "disable") {
      teardown();
      return Promise.resolve({ ok: true });
    }
  });

  recompute();
  startObserving();
})();
