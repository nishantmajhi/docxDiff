"use strict";

// The application as a user meets it: choosing files, being told when one
// cannot be read, and exporting the result.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadApp, makeFile, ROOT } = require("./harness.js");
const d = require("./docx.js");

const v1 = () =>
  fs.readFileSync(path.join(ROOT, "tests", "fixtures", "report_v1.docx"));
const v2 = () =>
  fs.readFileSync(path.join(ROOT, "tests", "fixtures", "report_v2.docx"));

const errorOn = (app, side) =>
  app.dropzone(side).querySelector(".dz-error").textContent;

test("choosing a file through the picker loads it", async () => {
  const app = loadApp();
  await app.chooseFile("left", makeFile("report_v1.docx", v1()));
  assert.ok(app.ctx.state.left, "the document was loaded");
  assert.strictEqual(app.ctx.state.left.fileName, "report_v1.docx");
});

test("choosing both files renders the diff", async () => {
  const app = loadApp();
  await app.chooseFile("left", makeFile("report_v1.docx", v1()));
  await app.chooseFile("right", makeFile("report_v2.docx", v2()));
  assert.ok(app.app.innerHTML.includes("diff-grid"));
  assert.deepStrictEqual(app.counts(), { removed: 10, added: 20, fmt: 3 });
});

test("a file of the wrong type chosen through the picker says so", async () => {
  const app = loadApp();
  await app.chooseFile("left", { name: "notes.txt" });
  assert.strictEqual(errorOn(app, "left"), "Please upload a .docx file.");
  assert.strictEqual(app.ctx.state.left, null);
});

test("a file that is not a Word document says so", async () => {
  const app = loadApp();
  await app.chooseFile(
    "left",
    makeFile("pretend.docx", Buffer.from("Dear Sir")),
  );
  assert.strictEqual(
    errorOn(app, "left"),
    "Could not read that file. Is it a valid Word document?",
  );
  assert.strictEqual(app.ctx.state.left, null);
});

test("a zip that is not a Word document says so", async () => {
  const app = loadApp();
  const notADoc = d.buildDocx({
    omitDocument: true,
    extra: { "readme.txt": "hello" },
  });
  await app.chooseFile("left", makeFile("archive.docx", notADoc));
  assert.strictEqual(
    errorOn(app, "left"),
    "Could not read that file. Is it a valid Word document?",
  );
});

test("the same errors appear when a file is dropped rather than chosen", async () => {
  const app = loadApp();
  const dz = app.dropzone("left");
  app.ctx.handleFile("left", { name: "notes.txt" }, dz);
  assert.strictEqual(
    dz.querySelector(".dz-error").textContent,
    "Please upload a .docx file.",
  );
});

test("a macro-enabled .docm is accepted", async () => {
  const app = loadApp();
  await app.chooseFile("left", makeFile("report.docm", v1()));
  assert.ok(
    app.ctx.state.left,
    "a .docm is the same package and compares perfectly well",
  );
  assert.strictEqual(app.ctx.state.left.fileName, "report.docm");
});

test("an uppercase extension is accepted", async () => {
  const app = loadApp();
  await app.chooseFile("left", makeFile("REPORT.DOCX", v1()));
  assert.ok(app.ctx.state.left);
});

test("an extension that merely contains .docx is refused", async () => {
  const app = loadApp();
  await app.chooseFile("left", makeFile("report.docx.exe", v1()));
  assert.strictEqual(app.ctx.state.left, null);
  assert.strictEqual(errorOn(app, "left"), "Please upload a .docx file.");
});

test("a second attempt after an error clears the message", async () => {
  const app = loadApp();
  await app.chooseFile("left", { name: "notes.txt" });
  assert.strictEqual(errorOn(app, "left"), "Please upload a .docx file.");

  const dz = app.dropzone("left");
  await app.chooseFile("left", makeFile("report_v1.docx", v1()));
  assert.ok(app.ctx.state.left, "the good file loaded");
  assert.strictEqual(dz.querySelector(".dz-error").style.display, "none");
});

test("exporting produces one download of a complete HTML document", async () => {
  const app = loadApp();
  await app.diff(v1(), v2(), ["report_v1.docx", "report_v2.docx"]);
  await app.menu("export");

  assert.strictEqual(app.downloads.length, 1);
  assert.strictEqual(app.downloads[0].download, "docxdiff-export.html");

  const html = app.exportedHtml();
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.includes("<title>docxDiff export</title>"));
  assert.ok(html.includes("report_v1.docx"));
  assert.ok(html.includes("report_v2.docx"));
  assert.ok(html.includes('<div class="diff-grid">'));
  assert.ok(html.trimEnd().endsWith("</html>"));
});

test("the export anchor is put in the document and taken out again", async () => {
  const app = loadApp();
  await app.diff(v1(), v2());
  await app.menu("export");

  const anchor = app.created.filter((e) => e.tagName === "A").pop();
  assert.ok(anchor, "an anchor was created");
  assert.ok(
    app.body._appended.includes(anchor),
    "and appended -- Firefox ignores a detached click",
  );
  assert.strictEqual(anchor._attached, false, "and removed again");
});

test("the object URL outlives the click", async () => {
  const app = loadApp();
  await app.diff(v1(), v2());
  await app.menu("export");
  // Revoking on the next line races the download the click has just started.
  assert.strictEqual(
    app.blobs.size,
    1,
    "the blob is still reachable when the click returns",
  );
});

test("exporting before a diff exists does nothing", async () => {
  const app = loadApp();
  await app.menu("export");
  assert.strictEqual(app.downloads.length, 0);
});

test("the export carries the diff that is on screen", async () => {
  const app = loadApp();
  await app.diff(d.simpleDocx(["kept", "old"]), d.simpleDocx(["kept", "new"]));
  await app.menu("export");
  const html = app.exportedHtml();
  assert.ok(html.includes("kept"));
  assert.ok(html.includes("old"));
  assert.ok(html.includes("new"));
});

// The File menu's Export diff item, as rendered for each window.
const exportItems = (html) =>
  html.match(/<button[^>]*data-action="export"[^>]*>/g) || [];

test("the page loads with both dropzones and no diff counts", () => {
  const app = loadApp();
  assert.ok(app.app.innerHTML.includes('data-side="left"'));
  assert.ok(app.app.innerHTML.includes('data-side="right"'));
  assert.ok(
    !app.app.innerHTML.includes("removed-count"),
    "the counts belong to a diff",
  );
  const items = exportItems(app.app.innerHTML);
  assert.strictEqual(items.length, 2, "one Export diff per window");
  for (const item of items)
    assert.ok(
      /\sdisabled[\s>]/.test(item),
      "there is nothing to export yet: " + item,
    );
  assert.strictEqual(
    app.resetBtn.disabled,
    true,
    "and nothing to start over from",
  );
});

test("a diff enables Export diff and Start over", async () => {
  const app = loadApp();
  await app.diff(v1(), v2());
  for (const item of exportItems(app.app.innerHTML))
    assert.ok(!/\sdisabled[\s>]/.test(item), item);
  assert.strictEqual(app.resetBtn.disabled, false);
});

test("a disabled Export diff does nothing when chosen anyway", async () => {
  const app = loadApp();
  await app.menu("export");
  assert.strictEqual(app.downloads.length, 0);
});

test("the window titles name the file, not the side", async () => {
  const app = loadApp();
  assert.strictEqual(
    (app.app.innerHTML.match(/Untitled - DiffPad/g) || []).length,
    2,
  );
  await app.diff(v1(), v2(), ["report_v1.docx", "report_v2.docx"]);
  const html = app.app.innerHTML;
  assert.ok(html.includes("report_v1.docx - DiffPad"));
  assert.ok(html.includes("report_v2.docx - DiffPad"));
  assert.ok(
    !/\((Original|Updated)\)/.test(html),
    "no (Original) or (Updated) in a title",
  );
});

test("Start over is in the Start menu, not in the windows' File menus", async () => {
  const app = loadApp();
  await app.diff(v1(), v2());
  assert.ok(!app.app.innerHTML.includes('data-action="reset"'));
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.ok(/<button[^>]*id="reset-btn"/.test(html));
  assert.ok(
    !/id="export-btn"/.test(html),
    "Export diff is only in the File menus",
  );
  assert.ok(!/id="clock"/.test(html), "and the taskbar has no clock");
});

test("replacing one side returns that side to its dropzone", async () => {
  const app = loadApp();
  await app.chooseFile("left", makeFile("report_v1.docx", v1()));
  await app.chooseFile("right", makeFile("report_v2.docx", v2()));
  assert.ok(app.app.innerHTML.includes("diff-grid"));

  app.ctx.state.left = null;
  app.ctx.renderApp();
  assert.ok(app.app.innerHTML.includes('data-side="left"'));
  assert.ok(
    !app.app.innerHTML.includes('data-side="right"'),
    "the loaded side keeps its preview",
  );
});

// The page is index.html plus its favicon and its own stylesheets and scripts
// -- the diff, the desktop and the games. Every one is checked: a remote font
// in the CSS would leak as surely as a remote script.
function filesUnder(dir) {
  return fs
    .readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? filesUnder(path.join(dir, e.name))
        : [path.join(dir, e.name)],
    );
}
const PAGE_FILES = [
  "index.html",
  "favicon.svg",
  ...filesUnder("css"),
  ...filesUnder("js"),
];

test("nothing in the page fetches anything over the network", () => {
  for (const name of PAGE_FILES) {
    const text = fs.readFileSync(path.join(ROOT, name), "utf8");
    // The privacy claim in the header is only true if the page has no remote
    // dependency at all -- not a script, not a font, not an analytics beacon.
    const remote =
      text.match(/(?:src|href|action)\s*=\s*"(https?:)?\/\/[^"]*"/gi) || [];
    assert.deepStrictEqual(
      remote,
      [],
      name + ": found a remote reference: " + remote.join(", "),
    );
    // In CSS the reference is url(...) or @import; an inline data: URL is fine.
    const cssRemote =
      text.match(/url\(\s*["']?(?:https?:)?\/\/[^)]*\)|@import/gi) || [];
    assert.deepStrictEqual(
      cssRemote,
      [],
      name + ": found a remote reference: " + cssRemote.join(", "),
    );
    assert.ok(
      !/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/.test(text),
      name + ": and no request is made",
    );
  }
});

test("the page's stylesheets and scripts are local files that exist", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const refs = [
    ...[...html.matchAll(/<link[^>]*href="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]),
  ];
  for (const ref of [
    "css/style.css",
    "css/games.css",
    "js/app.js",
    "js/desktop.js",
  ]) {
    assert.ok(refs.includes(ref), "index.html should load " + ref);
  }
  for (const ref of refs)
    assert.ok(fs.existsSync(path.join(ROOT, ref)), ref + " is missing");
  // Every script in js/ is loaded, so none is left out of the page by mistake.
  for (const f of filesUnder("js"))
    assert.ok(refs.includes(f.split(path.sep).join("/")), f + " is not loaded");
  // The application needs JSZip defined before it runs, the games need the
  // desktop to register with, and the card games need the cards.
  const at = (ref) => html.indexOf('src="' + ref + '"');
  assert.ok(at("vendor/jszip.min.js") < at("js/app.js"));
  assert.ok(at("js/desktop.js") < at("js/games/cards.js"));
  for (const g of ["minesweeper", "solitaire", "freecell", "hearts"]) {
    assert.ok(at("js/games/cards.js") < at("js/games/" + g + ".js"), g);
  }
});

test("the file picker offers both extensions it accepts", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const accepts = html.match(/accept="[^"]*"/g) || [];
  assert.strictEqual(accepts.length, 2, "one per side");
  // The validation and the picker's filter have to agree, or the tool refuses
  // a file it would have compared perfectly well.
  for (const a of accepts) assert.strictEqual(a, 'accept=".docx,.docm"');
});

// The page's favicon -- the browser tab's icon -- is its own file.
function faviconHref() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const link = /<link[^>]*rel="icon"[^>]*>/.exec(html);
  assert.ok(link, "index.html declares a favicon");
  const href = /href="([^"]+)"/.exec(link[0]);
  assert.ok(href, "and the favicon has an href");
  return href[1];
}

test("the page has a favicon, and it is a local file", () => {
  const href = faviconHref();
  assert.ok(!/^(https?:)?\/\//.test(href), href + " must not be remote");
  assert.ok(fs.existsSync(path.join(ROOT, href)), href + " is missing");
});

// A DiffPad window's own icon, in its title bar and on its taskbar button, is
// the DiffPad document, drawn inline. The flag is for the browser tab only:
// the author asked for the windows to keep the document.
const DOCUMENT_ICON = '<path d="M2.5 1.5h8l3 3v10h-11z" fill="#fff" stroke="#000"/>';

test("each DiffPad title bar shows the document icon, not the favicon", async () => {
  const app = loadApp();
  const check = () => {
    const bars = app.app.innerHTML.split('<div class="titlebar">').slice(1);
    assert.strictEqual(bars.length, 2, "one title bar per window");
    for (const bar of bars) {
      assert.ok(bar.startsWith('<svg class="icon16"'), bar.slice(0, 80));
      assert.ok(bar.includes(DOCUMENT_ICON), "and it is the document");
      assert.ok(!bar.includes(faviconHref()), "not the favicon");
    }
  };
  check();
  await app.diff(v1(), v2());
  check();
});

test("each DiffPad taskbar button shows the document icon too", async () => {
  const app = loadApp();
  await app.diff(v1(), v2());
  const buttons = app.el("tasks").innerHTML.split('<button class="task').slice(1);
  assert.strictEqual(buttons.length, 2);
  for (const b of buttons) {
    assert.ok(b.includes(DOCUMENT_ICON), b);
    assert.ok(!b.includes(faviconHref()), "not the favicon");
  }
});

// The favicon is the Start button's logo, the four-colour flag: the author
// chose it. Compared shape by shape, so neither can be redrawn without the
// other.
test("the favicon is the Start button's logo", () => {
  const paths = (svg) =>
    [...svg.matchAll(/<path\b([^>]*?)\/?>/g)].map((m) =>
      ["d", "fill", "stroke"]
        .map((a) => {
          const v = new RegExp("\b" + a + '="([^"]*)"').exec(m[1]);
          return a + "=" + (v ? v[1] : "");
        })
        .join(" "),
    );
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const start = /<button[^>]*id="start-btn"[^>]*>\s*(<svg[\s\S]*?<\/svg>)/.exec(
    html,
  );
  assert.ok(start, "the Start button has an inline logo");
  const favicon = fs.readFileSync(path.join(ROOT, faviconHref()), "utf8");
  assert.ok(paths(start[1]).length > 0);
  assert.deepStrictEqual(paths(favicon), paths(start[1]));
});
