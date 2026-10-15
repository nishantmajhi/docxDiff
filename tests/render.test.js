"use strict";

// What the two panes end up showing: alignment, the counts in the status bar,
// and the pieces of a document that are not text.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadApp, ROOT } = require("./harness.js");
const d = require("./docx.js");

const v1 = () => fs.readFileSync(path.join(ROOT, "tests", "fixtures", "report_v1.docx"));
const v2 = () => fs.readFileSync(path.join(ROOT, "tests", "fixtures", "report_v2.docx"));

test("a document compared with itself reports no differences at all", async () => {
  const app = loadApp();
  const buf = v1();
  await app.diff(buf, buf, ["report_v1.docx", "report_v1.docx"]);
  assert.deepStrictEqual(app.counts(), { removed: 0, added: 0, fmt: 0 });
});

test("a document with footnotes compared with itself reports no differences", async () => {
  const app = loadApp();
  const doc = d.buildDocx({
    body: [d.para([d.run("Body text"), d.footnoteRefRun("2")])],
    footnotes: [{ id: "2", body: d.para(d.run("The footnote.")) }],
  });
  await app.diff(doc, doc);
  assert.deepStrictEqual(app.counts(), { removed: 0, added: 0, fmt: 0 });
});

test("a document whose only content is a tracked deletion matches itself", async () => {
  const app = loadApp();
  const doc = d.buildDocx({
    body: [
      d.para(d.run("stable")),
      d.para(d.tracked("del", "A", d.run("gone", { deleted: true }))),
    ],
  });
  await app.diff(doc, doc);
  assert.deepStrictEqual(app.counts(), { removed: 0, added: 0, fmt: 0 });
});

test("two such paragraphs with different markup are still told apart", async () => {
  const app = loadApp();
  const left = d.buildDocx({
    body: [d.para(d.tracked("del", "A", d.run("one", { deleted: true })))],
  });
  const right = d.buildDocx({
    body: [d.para(d.tracked("del", "A", d.run("two", { deleted: true })))],
  });
  await app.diff(left, right);
  const c = app.counts();
  assert.ok(c.removed > 0 || c.added > 0 || c.fmt > 0, JSON.stringify(c));
});

test("a blank paragraph does not absorb a paragraph that only looks blank", async () => {
  const app = loadApp();
  const left = d.buildDocx({ body: [d.para(d.run("a")), "<w:p/>", d.para(d.run("b"))] });
  const right = d.buildDocx({
    body: [
      d.para(d.run("a")),
      d.para(d.tracked("del", "A", d.run("was here", { deleted: true }))),
      d.para(d.run("b")),
    ],
  });
  await app.diff(left, right);
  const c = app.counts();
  assert.ok(c.removed >= 1 && c.added >= 1, "the two must not be treated as the same blank: " + JSON.stringify(c));
});

test("the sample pair reports the changes it always has", async () => {
  const app = loadApp();
  await app.diff(v1(), v2(), ["report_v1.docx", "report_v2.docx"]);
  assert.deepStrictEqual(app.counts(), { removed: 10, added: 20, fmt: 3 });
});

test("swapping the two sides swaps removed and added", async () => {
  const app = loadApp();
  await app.diff(v1(), v2(), ["report_v1.docx", "report_v2.docx"]);
  const forward = app.counts();

  // The swap button exchanges the two loaded documents and re-renders.
  app.ctx.state = { left: app.ctx.state.right, right: app.ctx.state.left };
  app.ctx.renderApp();
  const backward = app.counts();

  assert.strictEqual(backward.removed, forward.added);
  assert.strictEqual(backward.added, forward.removed);
  assert.strictEqual(backward.fmt, forward.fmt);
});

test("an image next to a word renders as a picture, not as its fingerprint", async () => {
  const app = loadApp();
  const mk = (tail) =>
    d.buildDocx({
      body: [d.para([d.run("fig"), d.imageRun("rIdI"), d.run(tail)])],
      rels: [{ id: "rIdI", type: d.TYPE.image, target: "media/i.png" }],
      images: { "word/media/i.png": d.PNG_1PX },
    });
  const html = await app.diff(mk("one"), mk("two"));
  assert.ok(!html.includes("￼"), "the object-replacement character must not reach the page");
  assert.ok(!/[0-9]+:[A-Za-z0-9+/=]{16}/.test(html), "nor the base64 fingerprint");
  assert.ok(html.includes('<img src="data:image/png;base64,'), "the image itself is shown");
  assert.ok(html.includes("fig"), "and so is the text beside it");
});

test("an unchanged image in a changed paragraph is still drawn", async () => {
  const app = loadApp();
  const mk = (tail) =>
    d.buildDocx({
      body: [d.para([d.run("see "), d.imageRun("rIdI"), d.run(" " + tail)])],
      rels: [{ id: "rIdI", type: d.TYPE.image, target: "media/i.png" }],
      images: { "word/media/i.png": d.PNG_1PX },
    });
  const html = await app.diff(mk("one"), mk("two"));
  assert.ok(html.includes("<img src=\"data:image"), html.slice(0, 400));
});

test("a footnote reference in a changed paragraph renders as a marker", async () => {
  const app = loadApp();
  const mk = (tail) =>
    d.buildDocx({
      body: [d.para([d.run("text "), d.footnoteRefRun("1"), d.run(" " + tail)])],
      footnotes: [{ id: "1", body: d.para(d.run("note")) }],
    });
  const html = await app.diff(mk("one"), mk("two"));
  assert.ok(!html.includes("�"), "the replacement character must not reach the page");
  assert.ok(html.includes('class="fn-ref"'), "the marker is rendered");
});

test("section badges label everything that is not the body", async () => {
  const app = loadApp();
  const doc = d.buildDocx({
    body: [d.para(d.run("body"))],
    headers: [[d.para(d.run("header text"))]],
  });
  const other = d.buildDocx({
    body: [d.para(d.run("body changed"))],
    headers: [[d.para(d.run("header text"))]],
  });
  const html = await app.diff(doc, other);
  assert.ok(html.includes('class="sec-badge">header<'), "the header rows are labelled");
});

test("a heading renders as a heading and a list item with a bullet", async () => {
  const app = loadApp();
  const doc = d.buildDocx({
    body: [d.para(d.run("Title"), { style: "Heading1" }), d.para(d.run("point"), { list: true })],
  });
  const other = d.buildDocx({
    body: [d.para(d.run("Title"), { style: "Heading1" }), d.para(d.run("point"), { list: true })],
  });
  const html = await app.diff(doc, other);
  assert.ok(html.includes('class="block-heading h1"'));
  assert.ok(html.includes('class="block-li"'));
});

test("a row present on one side only leaves an empty cell on the other", async () => {
  const app = loadApp();
  const html = await app.diff(d.simpleDocx(["a"]), d.simpleDocx(["a", "b"]));
  assert.ok(html.includes('class="cell gap"'), "the missing side is a gap cell");
});

test("a whitespace-only difference is made visible", async () => {
  const app = loadApp();
  const html = await app.diff(d.simpleDocx(["one two"]), d.simpleDocx(["one  two"]));
  assert.ok(html.includes("ws-dot"), "the extra space is shown as a dot");
});

test("the head row names both files", async () => {
  const app = loadApp();
  const html = await app.diff(v1(), v2(), ["before.docx", "after.docx"]);
  assert.ok(html.includes("before.docx"));
  assert.ok(html.includes("after.docx"));
});

test("resetting clears both sides and returns to the dropzones", async () => {
  const app = loadApp();
  await app.diff(v1(), v2());
  assert.ok(app.app.innerHTML.includes("diff-grid"));
  await app.resetBtn.fire("click");
  assert.strictEqual(app.ctx.state.left, null);
  assert.strictEqual(app.ctx.state.right, null);
  assert.ok(app.app.innerHTML.includes("dropzone"));
});
