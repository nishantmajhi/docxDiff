"use strict";

// Every fix in this pass was reproduced against the code as it was found
// before it was written. This file keeps those reproductions.
//
// It loads index.html out of the baseline commit and asserts that each bug is
// *present* there. Its job is to stop the rest of the suite from quietly
// asserting nothing: if a test in another file passes against the original as
// well as against the fix, it was never a regression test, and the matching
// assertion here is what says so.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadOriginal, baselineCommit, ROOT } = require("./harness.js");
const d = require("./docx.js");

test("the baseline commit is reachable and is not the working tree", () => {
  const sha = baselineCommit();
  assert.match(sha, /^[0-9a-f]{40}$/);
  const original = loadOriginal();
  assert.strictEqual(typeof original.ctx.lcsDiff, "function");
});

test("original: a run colour breaks out of the style attribute", async () => {
  const app = loadOriginal();
  const doc = d.buildDocx({
    body: [d.para(d.run("hello", { color: 'red" onmouseover="alert(1)' }))],
  });
  const blocks = await app.blocks(doc);
  // The colour is interpolated raw, so the quote closes style= and what
  // follows becomes a second attribute.
  assert.ok(
    blocks[0].html.includes('style="color:#red" onmouseover="alert(1);"'),
    "expected the unescaped colour to escape its attribute, got: " + blocks[0].html,
  );
});

test("original: table cell shading injects a whole element", async () => {
  const app = loadOriginal();
  const doc = d.buildDocx({
    body: [d.table([[d.para(d.run("cell"))]], [['fff;"><img src=x onerror="alert(1)']])],
  });
  const blocks = await app.blocks(doc);
  assert.ok(
    blocks[0].html.includes("<img src=x onerror="),
    "expected the unescaped fill to inject an element, got: " + blocks[0].html,
  );
});

test("original: a tracked-change author escapes its title attribute", async () => {
  const app = loadOriginal();
  const doc = d.buildDocx({
    body: [d.para(d.tracked("ins", 'X" onmouseover="alert(1)', d.run("new")))],
  });
  const blocks = await app.blocks(doc);
  assert.ok(
    blocks[0].html.includes('onmouseover="alert(1)"'),
    "expected escapeHtml to let the double quote through, got: " + blocks[0].html,
  );
});

test("original: a hyperlink target escapes its attributes", async () => {
  const app = loadOriginal();
  const doc = d.buildDocx({
    body: [d.para(d.hyperlink("rIdL", d.run("click")))],
    rels: [
      {
        id: "rIdL",
        type: d.TYPE.hyperlink,
        target: 'https://x/" onmouseover="alert(1)',
        mode: "External",
      },
    ],
  });
  const blocks = await app.blocks(doc);
  assert.ok(
    blocks[0].html.includes('" onmouseover="alert(1)"'),
    "expected the href to escape data-href= and title=, got: " + blocks[0].html,
  );
});

test("original: a document with footnotes differs from itself", async () => {
  const app = loadOriginal();
  const doc = d.buildDocx({
    body: [d.para([d.run("Body text"), d.footnoteRefRun("2")])],
    footnotes: [{ id: "2", body: d.para(d.run("The footnote.")) }],
  });
  await app.diff(doc, doc);
  assert.strictEqual(
    app.counts().fmt,
    2,
    "expected the random per-extraction id to make two blocks look reformatted",
  );
});

test("original: the checked-in sample compared with itself is not clean", async () => {
  const app = loadOriginal();
  const buf = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "report_v1.docx"));
  await app.diff(buf, buf, ["report_v1.docx", "report_v1.docx"]);
  assert.strictEqual(app.counts().fmt, 2);
});

test("original: content controls are silently dropped", async () => {
  const app = loadOriginal();
  const doc = d.buildDocx({
    body: [
      d.para(d.run("before")),
      "<w:sdt><w:sdtPr/><w:sdtContent>" +
        d.para(d.run("inside a content control")) +
        "</w:sdtContent></w:sdt>",
      d.para(d.run("after")),
    ],
  });
  const blocks = await app.blocks(doc);
  // Array.from re-homes the vm context's array into this realm. deepStrictEqual
  // compares prototypes, and a cross-realm array never matches a local literal.
  assert.deepStrictEqual(
    Array.from(blocks, (b) => b.text),
    ["before", "after"],
    "expected the paragraph inside w:sdt to vanish",
  );
});

test("original: the text of a text box is silently dropped", async () => {
  const app = loadOriginal();
  const doc = d.buildDocx({
    body: [
      "<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>" +
        d.para(d.run("callout text")) +
        "</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>",
    ],
  });
  const blocks = await app.blocks(doc);
  assert.deepStrictEqual(
    Array.from(blocks, (b) => b.text),
    [""],
    "expected the whole text box to come out empty",
  );
});

test("original: nested tables are silently dropped", async () => {
  const app = loadOriginal();
  const inner = d.table([[d.para(d.run("nested cell"))]]);
  const doc = d.buildDocx({ body: [d.table([[d.para(d.run("outer")) + inner]])] });
  const blocks = await app.blocks(doc);
  assert.deepStrictEqual(Array.from(blocks, (b) => b.text), ["outer"]);
});

test("original: an image beside text leaks its internal token into the page", async () => {
  const app = loadOriginal();
  const mk = (tail) =>
    d.buildDocx({
      body: [d.para([d.run("fig"), d.imageRun("rIdI"), d.run(tail)])],
      rels: [{ id: "rIdI", type: d.TYPE.image, target: "media/i.png" }],
      images: { "word/media/i.png": d.PNG_1PX },
    });
  const html = await app.diff(mk("one"), mk("two"));
  assert.ok(html.includes("￼"), "expected the raw object-replacement character on screen");
  assert.ok(
    /fig￼[0-9]+:[A-Za-z0-9+/=]+one/.test(html),
    "expected the base64 fingerprint to be rendered as text",
  );
});

test("original: an explicitly disabled run property is read as enabled", async () => {
  const app = loadOriginal();
  const doc = d.buildDocx({
    body: [
      d.para(
        '<w:r><w:rPr><w:b w:val="0"/><w:i w:val="false"/><w:u w:val="none"/></w:rPr>' +
          "<w:t>plain</w:t></w:r>",
      ),
    ],
  });
  const blocks = await app.blocks(doc);
  assert.ok(blocks[0].html.includes("font-weight:600"));
  assert.ok(blocks[0].html.includes("font-style:italic"));
  assert.ok(blocks[0].html.includes("text-decoration:underline"));
});

test("original: a wholly deleted paragraph never matches its own copy", async () => {
  const app = loadOriginal();
  const doc = d.buildDocx({
    body: [
      d.para(d.run("stable")),
      d.para(d.tracked("del", "A", d.run("gone", { deleted: true }))),
    ],
  });
  await app.diff(doc, doc);
  assert.strictEqual(app.counts().removed, 1, "expected a false removal");
  assert.strictEqual(app.counts().added, 1, "expected a false addition");
});

test("original: the file picker swallows every error", async () => {
  const app = loadOriginal();

  // Dropped onto the dropzone: the message appears.
  const dz = app.makeStubElement("dz");
  app.ctx.handleFile("left", { name: "notes.txt" }, dz);
  assert.strictEqual(dz.querySelector(".dz-error").textContent, "Please upload a .docx file.");

  // Chosen through the file picker: handleFile is called with no element, so
  // showDropzoneError returns immediately and nothing at all happens.
  const app2 = loadOriginal();
  const before = app2.app.innerHTML;
  assert.ok(!before.includes("Please upload"), "no message on screen to begin with");
  app2.ctx.handleFile("left", { name: "notes.txt" });
  assert.strictEqual(app2.ctx.state.left, null);
  assert.strictEqual(app2.app.innerHTML, before, "nothing changed, so nothing was shown");
});

test("original: a corrupt file chosen through the picker reports nothing", async () => {
  const app = loadOriginal();
  await app.ctx.handleFile("left", {
    name: "x.docx",
    arrayBuffer: async () => Buffer.from("not a zip").buffer,
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(app.consoleErrors.length, 1, "it reached the catch");
  assert.strictEqual(app.ctx.state.left, null, "and gave up, with no message anywhere");
});

test("original: the LCS table is allocated in full whatever the size", () => {
  const app = loadOriginal();
  const n = 1200;
  const a = Array.from({ length: n }, (_, i) => "line " + i);
  const b = a.slice();
  b[600] = "changed";

  // 1200 x 1200 is 5.8 MB and takes long enough to measure; the same shape at
  // 20,000 blocks is 1.6 GB, which is what crashes the tab.
  const before = process.memoryUsage().heapTotal;
  const started = process.hrtime.bigint();
  app.ctx.lcsDiff(a, b);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const grew = process.memoryUsage().heapTotal - before;

  assert.ok(
    grew > 4e6 || ms > 40,
    `expected the full table to cost real time or memory, saw ${ms.toFixed(0)} ms / ${grew} bytes`,
  );
});

test("original: JSZip is fetched from a CDN with no integrity attribute", () => {
  const { git } = require("./harness.js");
  const html = git(["show", baselineCommit() + ":index.html"]);
  const tag = /<script[^>]*jszip[^>]*>/i.exec(html);
  assert.ok(tag, "expected a jszip script tag");
  assert.ok(tag[0].includes("cdnjs.cloudflare.com"), "expected it to point at a CDN");
  assert.ok(!/integrity=/i.test(tag[0]), "expected no subresource integrity");
});

test("original: there is no README", () => {
  const { git } = require("./harness.js");
  const tree = git(["ls-tree", "-r", "--name-only", baselineCommit()]);
  assert.ok(!/^README/im.test(tree), "expected the baseline to have no README");
});
