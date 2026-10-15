"use strict";

// Document content must never become markup.
//
// Everything a .docx carries -- text, author names, hyperlink targets, colour
// values -- is written by whoever produced the file, and all of it ends up in
// a string that is assigned to innerHTML and then, if the user exports, into a
// standalone HTML file they may open or pass on. A tool whose entire premise is
// that documents stay on your machine cannot be the thing that runs a
// document's script on it.
//
// Rather than pattern-match for payloads, every check here renders the same
// document twice -- once with the hostile string, once with an inert one --
// and asserts the two outputs have the same *shape*: the same elements with the
// same attributes in the same order. Content that cannot change the shape
// cannot inject anything, whatever it says. It also means a new payload does
// not need a new assertion.

const test = require("node:test");
const assert = require("node:assert");

const { loadApp } = require("./harness.js");
const d = require("./docx.js");

const BENIGN = "SAFE";

// Strings aimed at each context document content reaches: an attribute in
// double quotes, one in single quotes, element content, and a CSS declaration.
const PAYLOADS = [
  '" onmouseover="alert(1)',
  "' onmouseover='alert(1)",
  "<script>alert(1)</" + "script>",
  '"><img src=x onerror="alert(1)',
  "</style><script>alert(1)</" + "script>",
  "javascript:alert(1)",
  'x;"><iframe src="javascript:alert(1)',
  '\\" onload=\\"alert(1)',
  "</span><b onclick='x'>",
];

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g;

// Attribute names have to be read with the values consumed, not matched
// loosely: an escaped payload contains the characters `onmouseover=` inside a
// quoted value, and a scanner that ignores quoting reports it as an attribute
// and fails a page that is perfectly safe.
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g;

/** The elements and attribute names of a fragment, in document order. */
function shape(html) {
  const out = [];
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html)) !== null) {
    const attrs = [];
    let a;
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(m[2])) !== null) {
      if (a[0] === "") break;
      attrs.push(a[1].toLowerCase());
    }
    out.push(m[1].toLowerCase() + "[" + attrs.join(",") + "]");
  }
  return out;
}

/**
 * Build the same document with `payload` and with an inert string, render
 * both, and require the markup shape to be identical.
 */
async function assertShapeUnchanged(build, payload, pick) {
  const withPayload = loadApp();
  const withBenign = loadApp();
  const render = async (app, value) => {
    const blocks = await app.blocks(build(value));
    return Array.from(blocks, (b) => b.html).join("\n");
  };
  const hostile = await render(withPayload, payload);
  const inert = await render(withBenign, BENIGN);
  assert.deepStrictEqual(
    shape(hostile),
    shape(inert),
    `markup shape changed for payload ${JSON.stringify(payload)}\n  got: ${hostile}`,
  );
  if (pick) pick(hostile);
}

test("escapeHtml escapes both kinds of quote as well as the angle brackets", () => {
  const app = loadApp();
  assert.strictEqual(app.ctx.escapeHtml("a<b>&\"c'd"), "a&lt;b&gt;&amp;&quot;c&#39;d");
});

test("escapeHtml handles the ampersand first, so nothing is double-encoded", () => {
  const app = loadApp();
  assert.strictEqual(app.ctx.escapeHtml("&lt;"), "&amp;lt;");
});

test("a tracked-change author cannot change the markup", async () => {
  for (const payload of PAYLOADS) {
    await assertShapeUnchanged(
      (v) => d.buildDocx({ body: [d.para(d.tracked("ins", v, d.run("new text")))] }),
      payload,
      (html) => assert.ok(html.includes("new text"), "the run's own text survives"),
    );
  }
});

test("a comment author cannot change the markup", async () => {
  for (const payload of PAYLOADS) {
    await assertShapeUnchanged(
      (v) =>
        d.buildDocx({
          body: [d.para(d.run("body"))],
          comments: [{ id: "1", author: v, body: d.para(d.run("a note")) }],
        }),
      payload,
    );
  }
});

test("a hyperlink target cannot change the markup", async () => {
  for (const payload of PAYLOADS) {
    await assertShapeUnchanged(
      (v) =>
        d.buildDocx({
          body: [d.para(d.hyperlink("rIdL", d.run("click")))],
          rels: [{ id: "rIdL", type: d.TYPE.hyperlink, target: v, mode: "External" }],
        }),
      payload,
    );
  }
});

test("document text cannot change the markup", async () => {
  for (const payload of PAYLOADS) {
    await assertShapeUnchanged((v) => d.buildDocx({ body: [d.para(d.run(v))] }), payload);
  }
});

test("a bookmark-style internal anchor cannot change the markup", async () => {
  for (const payload of PAYLOADS) {
    await assertShapeUnchanged(
      (v) =>
        d.buildDocx({
          body: [
            d.para(
              '<w:hyperlink w:anchor="' + d.xmlAttr(v) + '">' + d.run("jump") + "</w:hyperlink>",
            ),
          ],
        }),
      payload,
    );
  }
});

test("a footnote id cannot change the markup", async () => {
  for (const payload of PAYLOADS) {
    await assertShapeUnchanged(
      (v) =>
        d.buildDocx({
          body: [d.para([d.run("text"), d.footnoteRefRun(v)])],
          footnotes: [{ id: v, body: d.para(d.run("the note")) }],
        }),
      payload,
    );
  }
});

test("a file name cannot escape the header it is shown in", async () => {
  const doc = d.simpleDocx(["a"]);
  const hostile = loadApp();
  const inert = loadApp();
  const h = await hostile.diff(doc, doc, ['"><img src=x onerror="alert(1)', "b.docx"]);
  const i = await inert.diff(doc, doc, ["a.docx", "b.docx"]);
  assert.deepStrictEqual(shape(h), shape(i));
});

test("a run colour that is not six hex digits is discarded, not escaped", async () => {
  for (const bad of ['red" onmouseover="x', "expression(alert(1))", "../../x", "auto", "", "fff"]) {
    const app = loadApp();
    const blocks = await app.blocks(d.buildDocx({ body: [d.para(d.run("t", { color: bad }))] }));
    assert.ok(
      !blocks[0].html.includes("color:#"),
      `expected ${JSON.stringify(bad)} to be dropped, got: ${blocks[0].html}`,
    );
  }
});

test("a run colour that is six hex digits is kept", async () => {
  const app = loadApp();
  const blocks = await app.blocks(d.buildDocx({ body: [d.para(d.run("t", { color: "1a2B3c" }))] }));
  assert.ok(blocks[0].html.includes("color:#1A2B3C;"), blocks[0].html);
});

test("table cell shading that is not six hex digits is discarded", async () => {
  // A dropped fill must leave exactly the markup an unshaded cell produces.
  const plain = loadApp();
  const unshaded = (await plain.blocks(d.buildDocx({ body: [d.table([[d.para(d.run("cell"))]])] })))[0]
    .html;

  for (const bad of ['fff;"><img src=x onerror="alert(1)', "auto", "red", "12345", "#ABCDEF"]) {
    const app = loadApp();
    const blocks = await app.blocks(
      d.buildDocx({ body: [d.table([[d.para(d.run("cell"))]], [[bad]])] }),
    );
    assert.ok(!blocks[0].html.includes("background:"), blocks[0].html);
    assert.strictEqual(blocks[0].html, unshaded, "for fill " + JSON.stringify(bad));
  }
});

test("table cell shading that is six hex digits is kept, except plain white", async () => {
  const app = loadApp();
  const kept = await app.blocks(
    d.buildDocx({ body: [d.table([[d.para(d.run("c"))]], [["DDEEFF"]])] }),
  );
  assert.ok(kept[0].html.includes("background:#DDEEFF;"));

  const white = await app.blocks(
    d.buildDocx({ body: [d.table([[d.para(d.run("c"))]], [["FFFFFF"]])] }),
  );
  assert.ok(!white[0].html.includes("background:"), "white is the page colour already");
});

test("the exported HTML file carries no injected markup either", async () => {
  const payload = '"><img src=x onerror="alert(1)';
  const other = d.buildDocx({ body: [d.para(d.run("different"))] });
  const build = (v) => d.buildDocx({ body: [d.para(d.tracked("ins", v, d.run("text")))] });

  const exports = [];
  for (const value of [payload, BENIGN]) {
    const app = loadApp();
    await app.diff(build(value), other);
    await app.menu("export");
    assert.strictEqual(app.downloads.length, 1, "the export produced a download");
    const html = app.exportedHtml();
    assert.ok(typeof html === "string" && html.length > 0);
    exports.push(html.replace(/<style>[\s\S]*?<\/style>/, ""));
  }
  assert.deepStrictEqual(shape(exports[0]), shape(exports[1]));
});

test("a whitespace-only change is made visible without becoming markup", () => {
  const app = loadApp();
  const out = app.ctx.escapeHtmlVisibleWs('a b"c');
  assert.ok(out.includes('class="ws-dot"'));
  assert.ok(out.includes("&quot;"), "the quote is still escaped: " + out);
});

test("the word-level diff escapes the tokens it renders", () => {
  const app = loadApp();
  const ops = [
    { type: "equal", a: "<b>", b: "<b>" },
    { type: "delete", a: '"x"' },
    { type: "insert", b: "'y'" },
  ];
  const left = app.ctx.renderWordDiff(ops, "left", null, null);
  const right = app.ctx.renderWordDiff(ops, "right", null, null);
  assert.ok(!left.includes("<b>"), left);
  assert.ok(left.includes("&lt;b&gt;"));
  assert.ok(left.includes("&quot;x&quot;"), left);
  assert.ok(right.includes("&#39;y&#39;"), right);
});
