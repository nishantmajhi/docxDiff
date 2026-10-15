"use strict";

// Loads the real application script into a node:vm context so its internals
// can be called directly.
//
// The whole application is one script, js/app.js, wrapped in an IIFE that
// exposes nothing, so there is no seam to import. The harness removes just the
// IIFE wrapper, which promotes every top-level `function` and `var` onto the vm
// context object, and supplies the handful of browser globals the code touches:
// document, DOMParser, JSZip, Blob and URL.
//
// `loadApp()` reads js/app.js from the working tree. `loadOriginal()` reads
// index.html out of the baseline commit, where the same code was still one
// inline <script>, so a regression test can assert that a bug is present
// before the fix and absent after it, against the two real files rather than a
// transcription.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const { DOMParser } = require("./xml.js");
const { JSZipShim, writeZip } = require("./zip.js");

const ROOT = path.join(__dirname, "..");
const INDEX = path.join(ROOT, "index.html");
const APP_JS = path.join(ROOT, "js", "app.js");

// The commit that holds the code exactly as it was found, before this cleanup
// pass touched it. Looked up by subject line rather than by hash so the
// harness keeps working if the branch is ever rebuilt, and so a missing
// baseline fails loudly instead of silently testing the fixed code twice.
const BASELINE_SUBJECT = "Initial commit";

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function baselineCommit() {
  const line = git(["log", "--all", "--format=%H %s"])
    .split("\n")
    .find((l) => l.slice(41).trim() === BASELINE_SUBJECT);
  if (!line) {
    throw new Error(
      `baseline commit "${BASELINE_SUBJECT}" not found in this repository`,
    );
  }
  return line.slice(0, 40);
}

const OPEN_WRAPPER = "(function () {";
const CLOSE_WRAPPER = "})();";

const INLINE_SCRIPT_RE = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script\s*>/g;

/** Strip the IIFE the application is wrapped in, exposing its internals. */
function unwrapScript(source, where) {
  const trimmed = source.trim();
  if (!trimmed.startsWith(OPEN_WRAPPER) || !trimmed.endsWith(CLOSE_WRAPPER)) {
    throw new Error(
      where +
        " is no longer wrapped in the expected IIFE; " +
        "the harness unwraps it to reach the internals and must be updated with it",
    );
  }
  return trimmed.slice(
    OPEN_WRAPPER.length,
    trimmed.length - CLOSE_WRAPPER.length,
  );
}

/**
 * Pull the inline application script out of an index.html and unwrap its IIFE.
 * Only the baseline page has one; the current page loads js/app.js instead.
 */
function extractScript(html) {
  // The CDN tag comes first and has no body; the application is the one
  // inline script.
  const blocks = [...html.matchAll(INLINE_SCRIPT_RE)];
  if (blocks.length !== 1) {
    throw new Error(
      `expected exactly one inline script block, found ${blocks.length}`,
    );
  }
  return unwrapScript(blocks[0][1], "index.html's inline script");
}

function makeStubElement(id) {
  const el = {
    id,
    innerHTML: "",
    textContent: "",
    value: "",
    style: {},
    _listeners: {},
    _classes: new Set(),
    classList: {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      contains: (c) => el._classes.has(c),
      toggle: (c, on) => (on ? el._classes.add(c) : el._classes.delete(c)),
    },
    addEventListener(type, fn) {
      (el._listeners[type] || (el._listeners[type] = [])).push(fn);
    },
    /** Fire every listener registered for `type`, as a real click would. */
    fire(type, ev) {
      return Promise.all(
        (el._listeners[type] || []).map((fn) => fn.call(el, ev || {})),
      );
    },
    click() {
      el._clicked = (el._clicked || 0) + 1;
      return el.fire("click");
    },
    getAttribute: (name) => (name === "data-side" ? el._side || null : null),
    setAttribute() {},
    querySelector(sel) {
      if (!el._children) el._children = {};
      if (!el._children[sel]) el._children[sel] = makeStubElement(sel);
      return el._children[sel];
    },
    querySelectorAll: () => [],
  };
  return el;
}

/** A stand-in for the File the browser hands to handleFile(). */
function makeFile(name, buffer) {
  return {
    name,
    async arrayBuffer() {
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    },
  };
}

function loadFromSource(html, opts) {
  return loadFromCode(extractScript(html), opts, "index.html (inline script)");
}

function loadFromCode(code, opts, filename) {
  const options = opts || {};

  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, makeStubElement(id));
    return elements.get(id);
  };
  for (const id of [
    "app",
    "reset-btn",
    // The taskbar's DiffPad buttons.
    "tasks",
    // The baseline page had one status bar and one Export button for the
    // whole diff; the current one keeps its counts in the windows' status
    // bars and Export in their File menus.
    "status-bar",
    "export-btn",
    "file-input-left",
    "file-input-right",
    "removed-count",
    "added-count",
    "fmt-count",
  ]) {
    element(id);
  }

  const created = [];
  const downloads = [];
  // Kept even after the app revokes the object URL, so a test can read what
  // the export actually contained.
  const lastBlob = { value: null };
  const blobs = new Map();
  const consoleErrors = [];

  // The app finds its dropzones with querySelector/querySelectorAll after
  // writing them into app.innerHTML, so the stub answers for a side only while
  // that side's dropzone is actually on screen. That is enough to exercise the
  // wiring and the error path without parsing the markup.
  const dropzones = new Map();
  const dropzoneFor = (side) => {
    if (!element("app").innerHTML.includes('data-side="' + side + '"'))
      return null;
    if (!dropzones.has(side)) {
      const dz = makeStubElement("dropzone-" + side);
      dz._side = side;
      dropzones.set(side, dz);
    }
    return dropzones.get(side);
  };
  const DROPZONE_SIDE_RE = /^\.dropzone\[data-side="(left|right)"\]$/;

  const body = makeStubElement("body");
  body._appended = [];
  body.appendChild = (el) => {
    body._appended.push(el);
    el._attached = true;
    return el;
  };
  body.removeChild = (el) => {
    el._attached = false;
    return el;
  };

  const document = {
    body,
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: (sel) =>
      sel === ".dropzone"
        ? ["left", "right"].map(dropzoneFor).filter(Boolean)
        : [],
    querySelector: (sel) => {
      const m = DROPZONE_SIDE_RE.exec(sel);
      return m ? dropzoneFor(m[1]) : null;
    },
    createElement(tag) {
      const el = makeStubElement(tag);
      el.tagName = tag.toUpperCase();
      el.click = () => {
        if (tag === "a")
          downloads.push({ href: el.href, download: el.download });
      };
      created.push(el);
      return el;
    },
  };

  const sandbox = {
    document,
    DOMParser,
    JSZip: options.JSZip || JSZipShim,
    console: {
      log: () => {},
      warn: () => {},
      error: (...args) => consoleErrors.push(args),
    },
    Blob: class Blob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = (opts && opts.type) || "";
      }
      text() {
        return this.parts.join("");
      }
    },
    URL: {
      createObjectURL(blob) {
        const url = "blob:stub/" + blobs.size;
        blobs.set(url, blob);
        lastBlob.value = blob;
        return url;
      },
      revokeObjectURL(url) {
        blobs.delete(url);
      },
    },
    // Timers the page schedules must not hold the test process open. The
    // export's deferred revokeObjectURL is the one that matters: node waits
    // for a pending timer, so without unref every test file that exports once
    // sat for the length of that delay before exiting.
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    },
    clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: filename || "js/app.js" });

  const api = {
    ctx,
    el: element,
    app: element("app"),
    resetBtn: element("reset-btn"),
    /**
     * Choose a command from a DiffPad window's File or Help menu, as a click
     * on it would: the click goes to #app's own handler, the way it bubbles
     * up from the menu item in the page.
     */
    menu(action, side) {
      const item = {
        disabled: false,
        getAttribute: (n) =>
          n === "data-action"
            ? action
            : n === "data-for"
              ? side || "right"
              : null,
        closest: (sel) => (sel === ".menu-item" ? item : null),
      };
      return element("app").fire("click", { target: item });
    },
    counts: () => ({
      removed: element("removed-count").textContent,
      added: element("added-count").textContent,
      fmt: element("fmt-count").textContent,
    }),
    downloads,
    blobs,
    consoleErrors,
    created,
    makeStubElement,
    dropzone: dropzoneFor,
    body,
    /** The HTML of the most recent export, as the downloaded file would hold it. */
    exportedHtml: () => (lastBlob.value ? lastBlob.value.text() : null),
    /**
     * Drive the file picker for one side, as choosing a file in it would.
     *
     * handleFile does not return its promise chain, so there is nothing to
     * await. Poll for the outcome instead -- the side is loaded, or a message
     * has appeared on its dropzone -- rather than guessing at a number of
     * ticks: the real JSZip settles several turns later than the test shim.
     */
    async chooseFile(side, file) {
      const input = element("file-input-" + side);
      // A message left over from a previous attempt would look like this
      // attempt's outcome, so clear it first -- which is what the app does to
      // the visible one when a new file arrives.
      const dz = dropzoneFor(side);
      if (dz) dz.querySelector(".dz-error").textContent = "";
      const settled = () =>
        ctx.state[side] !== null ||
        (dropzoneFor(side) &&
          dropzoneFor(side).querySelector(".dz-error").textContent !== "");
      input.files = [file];
      if (typeof input.onchange === "function") await input.onchange();
      for (let i = 0; i < 500 && !settled(); i++) {
        await new Promise((r) => setTimeout(r, 1));
      }
    },
    /** Run both documents through the real entry point and return the diff HTML. */
    async diff(leftBuf, rightBuf, names) {
      const n = names || ["left.docx", "right.docx"];
      ctx.state.left = {
        fileName: n[0],
        blocks: await ctx.extractDocxStructured(makeFile(n[0], leftBuf)),
      };
      ctx.state.right = {
        fileName: n[1],
        blocks: await ctx.extractDocxStructured(makeFile(n[1], rightBuf)),
      };
      ctx.renderApp();
      return element("app").innerHTML;
    },
    async blocks(buf, name) {
      return ctx.extractDocxStructured(makeFile(name || "doc.docx", buf));
    },
  };
  return api;
}

function loadApp(opts) {
  return loadFromCode(
    unwrapScript(fs.readFileSync(APP_JS, "utf8"), "js/app.js"),
    opts,
    "js/app.js",
  );
}

function loadOriginal() {
  return loadFromSource(git(["show", baselineCommit() + ":index.html"]));
}

module.exports = {
  loadApp,
  loadOriginal,
  loadFromSource,
  loadFromCode,
  makeFile,
  extractScript,
  unwrapScript,
  baselineCommit,
  git,
  writeZip,
  ROOT,
  INDEX,
  APP_JS,
};
