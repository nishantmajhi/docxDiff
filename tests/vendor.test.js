"use strict";

// The vendored copy of JSZip.
//
// The page used to pull this file from a CDN on every load, which made the
// promise in its About box -- "Compare two Word documents, entirely in your
// browser. Nothing is uploaded anywhere." -- depend on a third party, and made
// the tool useless offline. It is now served from vendor/.
//
// The rest of the suite runs against tests/zip.js, a small stand-in for the
// slice of JSZip the app calls. That is fast and dependency-free but it is not
// the code the browser runs, so these tests load the real vendored library the
// way a <script> tag would and drive the whole application through it.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { loadApp, makeFile, ROOT } = require("./harness.js");
const d = require("./docx.js");

const VENDOR = path.join(ROOT, "vendor", "jszip.min.js");

/** Evaluate the vendored file exactly as a classic script tag would. */
function loadVendoredJSZip() {
  const source = fs.readFileSync(VENDOR, "utf8");
  // The UMD preamble prefers CommonJS when `module` is defined, so a context
  // with neither `module` nor `define` takes the browser branch and assigns
  // window.JSZip -- which is the branch the page actually uses.
  const sandbox = { setTimeout, clearTimeout, console };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(source, ctx, { filename: "vendor/jszip.min.js" });
  return sandbox.JSZip;
}

test("the vendored file is present and is the library it claims to be", () => {
  assert.ok(fs.existsSync(VENDOR), "vendor/jszip.min.js is missing");
  const head = fs.readFileSync(VENDOR, "utf8").slice(0, 400);
  assert.match(head, /JSZip v3\.\d+\.\d+/);
  assert.match(head, /Dual licenced under the MIT license or GPLv3/);
});

test("its licence is kept beside it", () => {
  const licence = path.join(ROOT, "vendor", "jszip-LICENSE.markdown");
  assert.ok(fs.existsSync(licence), "vendor/jszip-LICENSE.markdown is missing");
  assert.match(fs.readFileSync(licence, "utf8"), /The MIT License/);
});

test("the page loads it from disk, not from a CDN", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const tag = /<script[^>]*jszip[^>]*>/i.exec(html);
  assert.ok(tag, "no jszip script tag found");
  assert.ok(tag[0].includes('src="vendor/jszip.min.js"'), tag[0]);
  assert.ok(!/cdnjs|jsdelivr|unpkg/i.test(html), "no CDN is referenced anywhere in the page");
});

test("the vendored library exposes the three calls the page makes", () => {
  const JSZip = loadVendoredJSZip();
  assert.strictEqual(typeof JSZip, "function");
  assert.strictEqual(typeof JSZip.loadAsync, "function");
});

test("the whole application works against the real library", async () => {
  const JSZip = loadVendoredJSZip();
  const app = loadApp({ JSZip });

  const v1 = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "report_v1.docx"));
  const v2 = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "report_v2.docx"));

  await app.chooseFile("left", makeFile("report_v1.docx", v1));
  await app.chooseFile("right", makeFile("report_v2.docx", v2));

  assert.ok(app.app.innerHTML.includes("diff-grid"), "a diff was rendered");
  // The same answer the shim gives, so the two agree about these documents.
  assert.deepStrictEqual(app.counts(), { removed: 10, added: 20, fmt: 3 });
});

test("images come out of the real library as usable data URLs", async () => {
  const JSZip = loadVendoredJSZip();
  const app = loadApp({ JSZip });
  const doc = d.buildDocx({
    body: [d.para([d.run("see "), d.imageRun("rIdI")])],
    rels: [{ id: "rIdI", type: d.TYPE.image, target: "media/photo.png" }],
    images: { "word/media/photo.png": d.PNG_1PX },
  });
  const blocks = await app.blocks(doc);
  const img = blocks[0].segments.find((s) => s.isImage);
  assert.ok(img.dataUrl.startsWith("data:image/png;base64,"));
  assert.strictEqual(
    Buffer.from(img.dataUrl.split(",")[1], "base64").toString("base64"),
    d.PNG_1PX.toString("base64"),
    "the bytes survive the round trip",
  );
});

test("the real library refuses a file that is not a zip, as the shim does", async () => {
  const JSZip = loadVendoredJSZip();
  const app = loadApp({ JSZip });
  await app.chooseFile("left", makeFile("pretend.docx", Buffer.from("Dear Sir")));
  assert.strictEqual(
    app.dropzone("left").querySelector(".dz-error").textContent,
    "Could not read that file. Is it a valid Word document?",
  );
});

test("a document deflated by the real library reads back identically", async () => {
  // The fixtures this suite builds are written by tests/zip.js. Reading one
  // back with JSZip is the check that the two agree about the format, which is
  // what lets the other tests trust the shim.
  const JSZip = loadVendoredJSZip();
  const shimApp = loadApp();
  const realApp = loadApp({ JSZip });

  const doc = d.buildDocx({
    body: [
      d.para(d.run("Heading"), { style: "Heading1" }),
      d.para(d.run("Some body text with a longer run so that deflate actually compresses it.")),
      d.table([[d.para(d.run("a")), d.para(d.run("b"))]]),
    ],
    footnotes: [{ id: "1", body: d.para(d.run("a note")) }],
  });

  const viaShim = await shimApp.blocks(doc);
  const viaReal = await realApp.blocks(doc);
  assert.deepStrictEqual(
    Array.from(viaShim, (b) => b.text),
    Array.from(viaReal, (b) => b.text),
  );
});
