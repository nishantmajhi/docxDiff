/*
 * Runs inside the real page, in a real browser.
 *
 * `tests/browser/run.js` copies `index.html`, `css/`, `js/` and `vendor/` into a scratch
 * directory, appends two script tags -- the fixtures, then this file -- and
 * opens the result from a `file://` URL in headless Chrome.
 *
 * The Node suite already drives the whole application against the real
 * vendored JSZip, in a `node:vm` context, and asserts the page references no
 * CDN. Three things it cannot reach, and they are the reason this exists:
 *
 *   1. Whether `vendor/jszip.min.js` -- a *relative* reference -- resolves
 *      when the page is opened as a file. The Node tests read that library by
 *      absolute path and never resolve the reference the browser resolves. A
 *      wrong relative path there means a page that silently does nothing, and
 *      it is the one change from that pass that would be embarrassing to have
 *      got wrong.
 *   2. Real `File` objects arriving through a real `<input type="file">`. The
 *      Node harness fakes a file as `{ name, arrayBuffer() }`.
 *   3. A real download: the anchor handling and the revoke timing, which no
 *      one has watched.
 *
 * Results go into a <div id="test-results"> as JSON, which the runner reads out
 * of the dumped DOM.
 */

(function () {
  "use strict";

  const results = [];
  /* The detail goes in first: a check that reports a `name` of its own must
   * not end up renaming itself in the output. */
  const record = (name, ok, detail) =>
    results.push(Object.assign({}, detail || {}, { name: name, ok: ok }));

  const check = (name, fn) => {
    try {
      const detail = fn();
      record(name, true, detail);
    } catch (err) {
      record(name, false, { error: String((err && err.stack) || err) });
    }
  };

  const publish = () => {
    const el = document.createElement("div");
    el.id = "test-results";
    el.textContent = JSON.stringify(results);
    document.body.appendChild(el);
  };

  const $ = (id) => document.getElementById(id);

  function waitFor(predicate, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      (function poll() {
        if (predicate()) return resolve(true);
        if (Date.now() - started > timeoutMs) return resolve(false);
        setTimeout(poll, 10);
      })();
    });
  }

  function bytesFrom(base64) {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  const DOCX_TYPE =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  /*
   * Anything that would leave the machine. The page promises "entirely in your
   * browser, nothing is uploaded anywhere", and it is opened here from a
   * file:// URL with no server, so a request that slipped back in would fail
   * in the console and look like nothing at all.
   */
  const networkCalls = [];
  const realFetch = window.fetch;
  window.fetch = function (input) {
    networkCalls.push("fetch " + String((input && input.url) || input));
    return realFetch.apply(this, arguments);
  };
  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    networkCalls.push("xhr " + method + " " + url);
    return realOpen.apply(this, arguments);
  };

  /*
   * The download. `URL.createObjectURL` is what the export hands the finished
   * HTML to, and the anchor click is what would actually save it, so both are
   * intercepted: the blob is kept, and the click is recorded rather than
   * performed. The order of click and revoke is recorded too -- revoking on
   * the line after the click races the download, which is what the comment in
   * `index.html` says the fix was for.
   */
  const objectUrls = [];
  const events = [];
  const realCreate = URL.createObjectURL.bind(URL);
  const realRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function (blob) {
    const url = realCreate(blob);
    objectUrls.push({ url: url, blob: blob });
    events.push("create");
    return url;
  };
  URL.revokeObjectURL = function (url) {
    events.push("revoke");
    return realRevoke(url);
  };

  const downloads = [];
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) {
      downloads.push({
        name: this.download,
        href: this.href,
        inDocument: document.body.contains(this),
      });
      events.push("click");
      return; /* do not actually navigate in a headless run */
    }
    return realClick.apply(this, arguments);
  };

  function chooseFile(inputId, name, base64) {
    const input = $(inputId);
    if (!input) throw new Error("no input " + inputId);
    const file = new File([bytesFrom(base64)], name, { type: DOCX_TYPE });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function main() {
    /*
     * The headline check. If the relative path were wrong the tag would have
     * 404'd and this would be undefined -- and every other check below would
     * fail in a way that did not say why.
     */
    check("the vendored JSZip loaded from its relative path", () => {
      if (typeof JSZip === "undefined") {
        throw new Error(
          "JSZip is undefined: vendor/jszip.min.js did not load from a file:// URL",
        );
      }
      return { version: JSZip.version || null };
    });

    check("the page is running from a file:// URL, with no server", () => {
      if (location.protocol !== "file:") {
        throw new Error("expected file:, got " + location.protocol);
      }
      return { href: location.href };
    });

    try {
      chooseFile("file-input-left", "report_v1.docx", window.__fixtures.v1);
      chooseFile("file-input-right", "report_v2.docx", window.__fixtures.v2);
    } catch (err) {
      record(
        "both documents are accepted through the real file inputs",
        false,
        {
          error: String((err && err.stack) || err),
        },
      );
      publish();
      return;
    }

    const rendered = await waitFor(
      () => $("app") && $("app").innerHTML.indexOf("diff-grid") !== -1,
      15000,
    );

    check("both documents are accepted through the real file inputs", () => {
      if (!rendered) {
        throw new Error(
          "no diff-grid appeared. app innerHTML begins: " +
            JSON.stringify(($("app") || {}).innerHTML || "").slice(0, 300),
        );
      }
      return null;
    });

    /*
     * The same numbers `tests/app.test.js` asserts against the fake file and
     * the shim zip reader. Getting them here means the real library, real File
     * objects and the real DOM agree with the model the Node suite is built
     * on.
     */
    check("the diff counts match what the Node suite expects", () => {
      const got = {
        removed: ($("removed-count") || {}).textContent,
        added: ($("added-count") || {}).textContent,
        fmt: ($("fmt-count") || {}).textContent,
      };
      const want = { removed: "10", added: "20", fmt: "3" };
      for (const key of Object.keys(want)) {
        if (String(got[key]) !== want[key]) {
          throw new Error(
            "expected " + JSON.stringify(want) + ", got " + JSON.stringify(got),
          );
        }
      }
      return got;
    });

    /*
     * The favicon is a relative file beside index.html. The Node suite checks
     * that it exists; this checks that the link resolves from a file:// page
     * and that the picture loads. The browser fetches a favicon itself and
     * reports nothing back, so the same URL is loaded as an image instead.
     */
    const faviconLink = document.querySelector('link[rel="icon"]');
    const favicon = await new Promise((resolve) => {
      if (!faviconLink) return resolve(null);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img);
      img.src = faviconLink.href;
      setTimeout(() => resolve(img), 5000);
    });
    check("the favicon loads from its relative path", () => {
      if (!faviconLink) throw new Error("the page declares no favicon");
      if (!favicon.naturalWidth) {
        throw new Error(faviconLink.href + " did not load");
      }
      return { href: faviconLink.href, size: favicon.naturalWidth };
    });

    /*
     * The diff is one grid in one scroller, which is what keeps a row's two
     * sides level. That scroller's only scrollbar sat at the right edge of the
     * Updated column, so the Original column showed none. It must have its own,
     * beside it, and moving either must move the whole diff.
     *
     * Layout has settled by the time a timer runs; animation frames do not run
     * at all under --dump-dom.
     */
    await new Promise((r) => setTimeout(r, 50));
    const app = $("app");
    const main = app.querySelector(".diff-scroll");
    /* One DiffPad window per document; the diff lies over both pages. */
    const wins = app.querySelectorAll(".window");
    const scrollbarOf = (el) => {
      const r = el.getBoundingClientRect();
      const left = r.left + el.clientLeft + el.clientWidth;
      return {
        left: left,
        right: r.right - el.clientLeft,
        top: r.top,
        bottom: r.bottom,
      };
    };
    const leftBar = [...app.querySelectorAll("*")].find((el) => {
      if (el === main || el.scrollHeight <= el.clientHeight) return false;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== "auto" && oy !== "scroll") return false;
      const sb = scrollbarOf(el);
      return (
        sb.right > sb.left &&
        sb.left >= wins[0].getBoundingClientRect().left &&
        sb.right <= wins[0].getBoundingClientRect().right
      );
    });

    check("the Original column has a scrollbar of its own", () => {
      if (main.scrollHeight <= main.clientHeight) {
        throw new Error(
          "the diff does not overflow here, so there is nothing to scroll",
        );
      }
      if (!leftBar) {
        const sb = scrollbarOf(main);
        throw new Error(
          "no scrollbar beside the Original column; the diff's only one runs from x=" +
            Math.round(sb.left) +
            " to " +
            Math.round(sb.right) +
            ", and the Original window ends at x=" +
            Math.round(wins[0].getBoundingClientRect().right),
        );
      }
      const mainRange = main.scrollHeight - main.clientHeight;
      const barRange = leftBar.scrollHeight - leftBar.clientHeight;
      if (Math.abs(mainRange - barRange) > 1) {
        throw new Error(
          "its range is " + barRange + "px, the diff's is " + mainRange + "px",
        );
      }
      const a = scrollbarOf(leftBar),
        b = scrollbarOf(main);
      if (Math.abs(a.top - b.top) > 1 || Math.abs(a.bottom - b.bottom) > 1) {
        throw new Error(
          "it is not as tall as the diff's: " + JSON.stringify({ a: a, b: b }),
        );
      }
      return { range: barRange };
    });

    /*
     * --dump-dom delivers the first scroll event of a run and none after it,
     * so each move is followed by the event a browser would raise for it. The
     * same moves with real wheel and drag input, in a browser drawing frames,
     * are recorded in review.md.
     */
    const moveTo = (el, top) => {
      el.scrollTop = top;
      el.dispatchEvent(new Event("scroll"));
      return { bar: leftBar.scrollTop, main: main.scrollTop };
    };
    let movedByBar = null,
      movedByMain = null;
    if (leftBar) {
      movedByBar = moveTo(leftBar, 300);
      movedByMain = moveTo(main, 120);
      moveTo(main, 0);
    }

    check("the Original column's scrollbar and the diff move together", () => {
      if (!leftBar) throw new Error("there is no Original scrollbar to move");
      if (movedByBar.bar !== 300 || movedByBar.main !== 300) {
        throw new Error(
          "dragging it left the diff behind: " + JSON.stringify(movedByBar),
        );
      }
      if (movedByMain.bar !== 120 || movedByMain.main !== 120) {
        throw new Error(
          "scrolling the diff left it behind: " + JSON.stringify(movedByMain),
        );
      }
      return { movedByBar: movedByBar, movedByMain: movedByMain };
    });

    check("both columns still scroll as one", () => {
      const grid = main.querySelector(".diff-grid");
      const columns = grid
        ? getComputedStyle(grid).gridTemplateColumns.split(" ").length
        : 0;
      if (!grid || columns !== 2 || grid.querySelectorAll(".cell").length < 2) {
        throw new Error("the two columns are no longer in the one scroller");
      }
      return null;
    });

    /*
     * The two columns have to sit on the two windows' pages: the Original
     * column inside the Original window, the Updated column inside the
     * Updated one, and the diff's own scrollbar inside the Updated page.
     */
    check("each column lies on its own window's page", () => {
      if (wins.length !== 2)
        throw new Error("expected two windows, found " + wins.length);
      const cells = main.querySelectorAll(".diff-grid > .cell");
      const l = cells[0].getBoundingClientRect(),
        r = cells[1].getBoundingClientRect();
      const wl = wins[0].getBoundingClientRect(),
        wr = wins[1].getBoundingClientRect();
      const inside = (c, w) => c.left >= w.left && c.right <= w.right;
      if (!inside(l, wl) || !inside(r, wr)) {
        throw new Error(
          "columns " +
            JSON.stringify([l.left, l.right, r.left, r.right]) +
            " windows " +
            JSON.stringify([wl.left, wl.right, wr.left, wr.right]),
        );
      }
      const sb = scrollbarOf(main);
      if (sb.left < wr.left || sb.right > wr.right) {
        throw new Error("the diff's scrollbar is outside the Updated window");
      }
      return null;
    });

    /* Export diff is in each DiffPad window's File menu. */
    const exportItem = app.querySelector(
      '.window[data-win="right"] .menu-item[data-action="export"]',
    );
    if (exportItem) exportItem.click();

    await waitFor(() => downloads.length > 0, 10000);

    check("Export diff produces a download", () => {
      if (!downloads.length) throw new Error("no download was started");
      const d = downloads[0];
      if (d.name !== "docxdiff-export.html") {
        throw new Error("the file was named " + JSON.stringify(d.name));
      }
      if (!d.inDocument) {
        throw new Error(
          "the anchor was not in the document when it was clicked; Firefox " +
            "ignores a click on a detached anchor",
        );
      }
      return { name: d.name };
    });

    const exported = objectUrls.length
      ? await objectUrls[objectUrls.length - 1].blob.text()
      : null;

    check("the exported file holds the diff and both file names", () => {
      if (!exported) throw new Error("nothing was handed to createObjectURL");
      for (const needle of ["report_v1.docx", "report_v2.docx", "diff-grid"]) {
        if (exported.indexOf(needle) === -1) {
          throw new Error(
            "the export does not contain " +
              JSON.stringify(needle) +
              ". It begins: " +
              JSON.stringify(exported.slice(0, 200)),
          );
        }
      }
      return { bytes: exported.length };
    });

    /*
     * Revoking the object URL on the line after the click races the download.
     * The click must come first and the revoke must be later, not adjacent.
     */
    check("the object URL outlives the click", () => {
      const click = events.indexOf("click");
      const revoke = events.indexOf("revoke");
      if (click === -1) throw new Error("no click was recorded");
      if (revoke !== -1 && revoke < click) {
        throw new Error(
          "the URL was revoked before the click: " + events.join(" -> "),
        );
      }
      return { order: events.join(" -> ") };
    });

    /*
     * The games in the Start menu. Each opens in a window of its own, above
     * the two DiffPad windows, with a taskbar button and working minimize,
     * maximize and close buttons.
     */
    const layer = $("game-layer");
    const games = ["freecell", "hearts", "minesweeper", "solitaire"];
    const gameWins = {};
    for (const id of games) {
      $("start-btn").click();
      const item = document.querySelector(
        '#start-menu [data-game="' + id + '"]',
      );
      if (item) item.click();
      gameWins[id] = layer.querySelector(
        '.game-window[data-game="' + id + '"]',
      );
    }
    await new Promise((r) => setTimeout(r, 50));

    check("every game in the Start menu opens in a window of its own", () => {
      for (const id of games) {
        const w = gameWins[id];
        if (!w) throw new Error(id + " did not open");
        if (!w.querySelector(".card, .ms-cell"))
          throw new Error(id + " drew nothing");
        const btns = [...w.querySelectorAll(".titlebar [data-wm]")].map((b) =>
          b.getAttribute("data-wm"),
        );
        if (btns.join() !== "min,max,close")
          throw new Error(id + "'s title bar has " + btns.join());
      }
      const tasks = $("game-tasks").querySelectorAll(".task").length;
      if (tasks !== games.length)
        throw new Error(
          tasks + " taskbar buttons for " + games.length + " games",
        );
      return {
        title: gameWins.freecell.querySelector(".title-text").textContent,
      };
    });

    check("a game window lies above the DiffPad windows", () => {
      const r = gameWins.solitaire.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      if (!hit || hit.closest(".game-window") !== gameWins.solitaire) {
        throw new Error(
          "the middle of the Solitaire window shows " +
            (hit ? hit.className : "nothing"),
        );
      }
      if (!document.body.classList.contains("game-focus"))
        throw new Error("the DiffPad windows still look active");
      return null;
    });

    const sol = gameWins.solitaire;
    const solTask = $("game-tasks").querySelector('[data-game="solitaire"]');
    sol.querySelector('[data-wm="min"]').click();
    const wasHidden = getComputedStyle(sol).display === "none";
    solTask.click();
    const cameBack = getComputedStyle(sol).display !== "none";
    sol.querySelector('[data-wm="max"]').click();
    const lr = layer.getBoundingClientRect();
    const mr = sol.getBoundingClientRect();
    const filled =
      Math.abs(mr.width - lr.width) < 1 && Math.abs(mr.height - lr.height) < 1;
    sol.querySelector('[data-wm="max"]').click();
    const shrank = sol.getBoundingClientRect().width < lr.width - 1;

    check("a game window minimizes, restores, maximizes and restores", () => {
      const got = { wasHidden, cameBack, filled, shrank };
      if (!wasHidden || !cameBack || !filled || !shrank)
        throw new Error(JSON.stringify(got));
      return got;
    });

    /* A real click on Minesweeper: the first square opened is never a mine. */
    $("game-tasks").querySelector('[data-game="minesweeper"]').click();
    const cell = gameWins.minesweeper.querySelectorAll(".ms-cell")[40];
    const cr = cell.getBoundingClientRect();
    const at = {
      bubbles: true,
      clientX: cr.left + 8,
      clientY: cr.top + 8,
      button: 0,
    };
    cell.dispatchEvent(new MouseEvent("mousedown", at));
    cell.dispatchEvent(new MouseEvent("mouseup", at));

    check("Minesweeper opens the square clicked, safely", () => {
      const open = gameWins.minesweeper.querySelectorAll(".ms-cell.o").length;
      const mine =
        gameWins.minesweeper.querySelectorAll(".ms-cell.mine").length;
      if (!open || mine)
        throw new Error(open + " squares open, " + mine + " mines showing");
      return { open: open };
    });

    /* And a click on Solitaire's deck turns cards over. */
    const stock = sol.querySelector('[data-hit="stock"]');
    const sr = stock.getBoundingClientRect();
    const down = {
      bubbles: true,
      clientX: sr.left + 30,
      clientY: sr.top + 40,
      button: 0,
      pointerType: "mouse",
    };
    stock.dispatchEvent(new PointerEvent("pointerdown", down));
    document.dispatchEvent(new PointerEvent("pointerup", down));

    check("Solitaire turns cards from the deck", () => {
      const waste = sol.querySelectorAll('[data-hit="waste"]').length;
      if (!waste) throw new Error("no card was turned over");
      return null;
    });

    for (const id of games)
      gameWins[id].querySelector('[data-wm="close"]').click();

    check("closing a game removes its window and its taskbar button", () => {
      const left = layer.querySelectorAll(".game-window").length;
      const tasks = $("game-tasks").querySelectorAll(".task").length;
      if (left || tasks)
        throw new Error(left + " windows and " + tasks + " buttons left");
      if (document.body.classList.contains("game-focus"))
        throw new Error("the DiffPad windows did not get focus back");
      return null;
    });

    check("nothing was requested over the network", () => {
      if (networkCalls.length) {
        throw new Error("the page made requests: " + networkCalls.join(", "));
      }
      return null;
    });

    publish();
  }

  main().catch((err) => {
    record("driver", false, { error: String((err && err.stack) || err) });
    publish();
  });
})();
