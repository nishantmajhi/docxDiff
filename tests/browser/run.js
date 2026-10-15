/*
 * Opens the real page in a real browser, from a file:// URL, with no network.
 *
 * `review.md` has carried a manual check for this since 2026-09-19: open
 * `index.html` from a file:// URL with the network disconnected, compare the
 * two documents in `tests/fixtures/`, and press Export diff. It was open
 * because nothing here could open a page. `Web/Frontend/With
 * Libraries/MDview/tests/browser/run.js` established that Chrome will run one
 * under `--headless=new --dump-dom` with no driver and no dependency, and this
 * is that technique applied here.
 *
 * What it adds over `npm test`, which already drives the whole application
 * against the real vendored JSZip in a `node:vm` context:
 *
 *   - It resolves `vendor/jszip.min.js` the way a browser resolves it. The
 *     Node tests read that file by absolute path, so a wrong *relative*
 *     reference in the page would pass every one of them and still ship a page
 *     that does nothing at all. That is the single change from the vendoring
 *     pass most worth confirming.
 *   - It uses real `File` objects through the real `<input type="file">`. The
 *     Node harness fakes a file as `{ name, arrayBuffer() }`.
 *   - It watches a real download: the anchor handling and the revoke timing.
 *
 * The fixtures are handed to the page as base64 in a generated script rather
 * than fetched, because a file:// page cannot read sibling files without
 * loosening Chrome's file access -- and loosening it would make the run less
 * like the one a user gets, not more.
 *
 * With no browser installed this exits 0 and says SKIP.
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");

const CANDIDATES = [
  process.env.DOCXDIFF_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

function findBrowser() {
  for (const candidate of CANDIDATES) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* not there */
    }
  }
  return null;
}

const APPENDED =
  '\n<script src="fixtures.js"></script>\n<script src="driver.js"></script>\n';

function stage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docxdiff-browser-"));

  /*
   * `vendor/` is copied with its real name and shape. Flattening it would
   * defeat the point: the reference under test is the relative one.
   */
  fs.mkdirSync(path.join(dir, "vendor"));
  for (const name of fs.readdirSync(path.join(ROOT, "vendor"))) {
    fs.copyFileSync(
      path.join(ROOT, "vendor", name),
      path.join(dir, "vendor", name),
    );
  }

  /* The page's own stylesheets and scripts, by the relative paths it uses. */
  for (const sub of ["css", "js"]) {
    fs.cpSync(path.join(ROOT, sub), path.join(dir, sub), { recursive: true });
  }
  fs.copyFileSync(
    path.join(ROOT, "favicon.svg"),
    path.join(dir, "favicon.svg"),
  );

  fs.copyFileSync(path.join(__dirname, "driver.js"), path.join(dir, "driver.js"));

  const fixtures = {
    v1: fs
      .readFileSync(path.join(ROOT, "tests", "fixtures", "report_v1.docx"))
      .toString("base64"),
    v2: fs
      .readFileSync(path.join(ROOT, "tests", "fixtures", "report_v2.docx"))
      .toString("base64"),
  };
  fs.writeFileSync(
    path.join(dir, "fixtures.js"),
    "window.__fixtures = " + JSON.stringify(fixtures) + ";\n",
    "utf8",
  );

  const original = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  fs.writeFileSync(path.join(dir, "index.html"), original + APPENDED, "utf8");

  /* The page under test must be the page it claims to be. */
  const staged = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  if (
    staged.slice(0, original.length) !== original ||
    staged.slice(original.length) !== APPENDED
  ) {
    throw new Error("the staged copy is not the page plus exactly two script tags");
  }
  return dir;
}

function run(browser, dir) {
  const profile = path.join(dir, "profile");
  const result = spawnSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      "--disable-extensions",
      "--user-data-dir=" + profile,
      "--virtual-time-budget=60000",
      "--dump-dom",
      "file:///" + path.join(dir, "index.html").replace(/\\/g, "/"),
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180000 },
  );

  if (result.error) throw result.error;
  const dom = result.stdout || "";
  const match = dom.match(/<div id="test-results">([\s\S]*?)<\/div>/);
  if (!match) {
    throw new Error(
      "the page produced no results. Last of the dumped DOM:\n" +
        dom.slice(-1500) +
        "\n--- stderr ---\n" +
        (result.stderr || "").slice(-1500),
    );
  }
  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return JSON.parse(decoded);
}

function main() {
  const browser = findBrowser();
  if (!browser) {
    console.log("SKIP: no Chrome or Edge found. Set DOCXDIFF_BROWSER to one.");
    return 0;
  }
  console.log("browser: " + browser);

  const results = run(browser, stage());

  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log("  ok   " + r.name);
    } else {
      failed++;
      console.log("  FAIL " + r.name + "\n       " + (r.error || JSON.stringify(r)));
    }
  }

  console.log(
    failed === 0
      ? "\nbrowser: all " + results.length + " checks passed"
      : "\nbrowser: " + failed + " of " + results.length + " failed",
  );
  return failed === 0 ? 0 : 1;
}

process.exit(main());
