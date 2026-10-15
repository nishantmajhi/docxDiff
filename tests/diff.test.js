"use strict";

// The diff engine: the tokeniser, the two LCS paths, and the row builder.

const test = require("node:test");
const assert = require("node:assert");

const { loadApp, loadOriginal } = require("./harness.js");

const app = loadApp();
const original = loadOriginal();

const IMG = "￼";
const FN = "�";

// ---------------------------------------------------------------- tokeniser

test("words split on whitespace, and the whitespace is kept as its own token", () => {
  assert.deepStrictEqual(Array.from(app.ctx.tokenizeWords("one two  three")), [
    "one",
    " ",
    "two",
    "  ",
    "three",
  ]);
});

test("an image token is one token even with no space around it", () => {
  const tokens = Array.from(app.ctx.tokenizeWords("fig" + IMG + "1892:AABJRU5ErkJggg==" + IMG + "one"));
  assert.deepStrictEqual(tokens, ["fig", IMG + "1892:AABJRU5ErkJggg==" + IMG, "one"]);
});

test("two adjacent image tokens do not merge", () => {
  const t = Array.from(app.ctx.tokenizeWords(IMG + "a" + IMG + IMG + "b" + IMG));
  assert.deepStrictEqual(t, [IMG + "a" + IMG, IMG + "b" + IMG]);
});

test("a footnote token is one token, and following punctuation is not part of it", () => {
  const t = Array.from(app.ctx.tokenizeWords("text" + FN + "2" + FN + ". more"));
  assert.deepStrictEqual(t, ["text", FN + "2" + FN, ".", " ", "more"]);
});

test("an empty string tokenises to nothing", () => {
  assert.deepStrictEqual(Array.from(app.ctx.tokenizeWords("")), []);
});

// ------------------------------------------------------------------- lcsDiff

/** ops must rebuild `a` from equal+delete and `b` from equal+insert. */
function reconstructs(ops, a, b) {
  const ra = [];
  const rb = [];
  for (const op of ops) {
    if (op.type === "equal") {
      ra.push(op.a);
      rb.push(op.b);
    } else if (op.type === "delete") ra.push(op.a);
    else rb.push(op.b);
  }
  return ra.join("") === a.join("") && rb.join("") === b.join("");
}

/** An independent LCS length, so minimality is checked against something else. */
function lcsLength(a, b) {
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    const t = prev;
    prev = cur;
    cur = t;
    cur.fill(0);
  }
  return prev[b.length];
}

const equalCount = (ops) => ops.filter((o) => o.type === "equal").length;

test("identical sequences produce nothing but equals", () => {
  const a = ["x", "y", "z"];
  const ops = app.ctx.lcsDiff(a, a.slice());
  assert.strictEqual(ops.length, 3);
  assert.ok(ops.every((o) => o.type === "equal"));
});

test("an empty side gives only deletions or only insertions", () => {
  assert.deepStrictEqual(
    Array.from(app.ctx.lcsDiff(["a", "b"], []), (o) => o.type),
    ["delete", "delete"],
  );
  assert.deepStrictEqual(
    Array.from(app.ctx.lcsDiff([], ["a", "b"]), (o) => o.type),
    ["insert", "insert"],
  );
  assert.deepStrictEqual(Array.from(app.ctx.lcsDiff([], [])), []);
});

test("a custom equality function is honoured", () => {
  const a = [{ k: 1 }, { k: 2 }];
  const b = [{ k: 1 }, { k: 3 }];
  const ops = app.ctx.lcsDiff(a, b, (x, y) => x.k === y.k);
  assert.deepStrictEqual(
    Array.from(ops, (o) => o.type),
    ["equal", "delete", "insert"],
  );
});

// A deterministic generator, so a failure is reproducible.
let seed = 20260919;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function randSeq(len, alphabet) {
  const out = [];
  for (let i = 0; i < len; i++) out.push("s" + Math.floor(rand() * alphabet));
  return out;
}

test("the large path returns a shortest edit script on 2000 random pairs", () => {
  for (let t = 0; t < 2000; t++) {
    const alphabet = 1 + Math.floor(rand() * 8);
    const a = randSeq(Math.floor(rand() * 40), alphabet);
    const b = randSeq(Math.floor(rand() * 40), alphabet);
    const ops = Array.from(app.ctx.lcsDiffLarge(a, b, (x, y) => x === y));
    assert.ok(reconstructs(ops, a, b), `does not reconstruct: ${JSON.stringify([a, b])}`);
    assert.strictEqual(
      equalCount(ops),
      lcsLength(a, b),
      `not minimal for ${JSON.stringify([a, b])}`,
    );
  }
});

test("below the table limit the output is byte-identical to the original's", () => {
  // The whole point of keeping the table for small inputs: every document
  // anyone has diffed with this tool must still diff exactly the same way.
  for (let t = 0; t < 1500; t++) {
    const alphabet = 1 + Math.floor(rand() * 10);
    const a = randSeq(Math.floor(rand() * 60), alphabet);
    const b = randSeq(Math.floor(rand() * 60), alphabet);
    assert.strictEqual(
      JSON.stringify(app.ctx.lcsDiff(a, b)),
      JSON.stringify(original.ctx.lcsDiff(a, b)),
      `diverged on ${JSON.stringify([a, b])}`,
    );
  }
});

test("a long document with a handful of edits is fast and exact", () => {
  const a = Array.from({ length: 20000 }, (_, i) => "paragraph number " + i);
  const b = a.slice();
  for (let i = 0; i < 40; i++) b[i * 431] = "edited paragraph " + i;
  b.splice(9000, 0, "an inserted paragraph");
  b.splice(3000, 1);

  const started = process.hrtime.bigint();
  const ops = Array.from(app.ctx.lcsDiff(a, b));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  assert.ok(reconstructs(ops, a, b));
  // The same shape through the table would be 1.6 GB. Allow a wide margin over
  // the few milliseconds it actually takes, so the check is about the
  // algorithm rather than about this machine.
  assert.ok(ms < 2000, `took ${ms.toFixed(0)} ms`);
  assert.strictEqual(equalCount(ops), 19959);
});

test("20,000 words in one paragraph is fast too", () => {
  const a = Array.from({ length: 20000 }, (_, i) => "w" + ((i * 7919) % 5000));
  const b = a.slice();
  for (let i = 0; i < 25; i++) b[i * 700] = "CHANGED" + i;
  const started = process.hrtime.bigint();
  const ops = Array.from(app.ctx.lcsDiff(a, b));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(reconstructs(ops, a, b));
  assert.ok(ms < 2000, `took ${ms.toFixed(0)} ms`);
});

test("two large documents with nothing in common still answer, and answer quickly", () => {
  // Past its budget the search gives up and pairs the two sides off wholesale.
  // That is not the shortest script, but it is a correct one and it is
  // immediate -- the alternative is the tab dying.
  const a = randSeq(6000, 900);
  const b = randSeq(6000, 900);
  const started = process.hrtime.bigint();
  const ops = Array.from(app.ctx.lcsDiff(a, b));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(reconstructs(ops, a, b));
  assert.ok(ms < 5000, `took ${ms.toFixed(0)} ms`);
});

test("the table path is chosen below the limit and the large path above it", () => {
  const cell = app.ctx.LCS_TABLE_CELL_LIMIT;
  assert.strictEqual(typeof cell, "number");
  const small = Math.floor(Math.sqrt(cell)) - 2;
  assert.ok((small + 1) * (small + 1) <= cell);
  const a = Array.from({ length: small }, (_, i) => "x" + i);
  assert.ok(reconstructs(Array.from(app.ctx.lcsDiff(a, a.slice())), a, a));
});

test("a common head and tail are trimmed before the expensive part", () => {
  const head = Array.from({ length: 5 }, (_, i) => "h" + i);
  const tail = Array.from({ length: 5 }, (_, i) => "t" + i);
  const a = head.concat(["mid-a"], tail);
  const b = head.concat(["mid-b"], tail);
  const ops = Array.from(app.ctx.lcsDiffLarge(a, b, (x, y) => x === y));
  assert.deepStrictEqual(
    Array.from(ops, (o) => o.type),
    ["equal", "equal", "equal", "equal", "equal", "delete", "insert", "equal", "equal", "equal", "equal", "equal"],
  );
});

// ----------------------------------------------------------------- buildRows

/** Minimal stand-ins for the blocks buildRows expects. */
const blk = (text, fmtKey) => ({ text, html: fmtKey || text, fmtKey: fmtKey || text });

test("a deletion and an insertion next to each other become one modified row", () => {
  const rows = Array.from(
    app.ctx.buildRows([
      { type: "equal", a: blk("same"), b: blk("same") },
      { type: "delete", a: blk("old line") },
      { type: "insert", b: blk("new line") },
    ]),
  );
  assert.deepStrictEqual(
    rows.map((r) => r.kind),
    ["equal", "modified"],
  );
  assert.ok(rows[1].wordOps, "a modified row carries its word-level diff");
});

test("an unmatched deletion is a removed row and an unmatched insertion an added one", () => {
  const rows = Array.from(
    app.ctx.buildRows([{ type: "delete", a: blk("gone") }, { type: "insert", b: blk("fresh") }, { type: "insert", b: blk("also fresh") }]),
  );
  assert.deepStrictEqual(
    rows.map((r) => r.kind),
    ["modified", "added"],
  );
});

test("equal text with different markup is a formatting change", () => {
  const rows = Array.from(
    app.ctx.buildRows([
      { type: "equal", a: blk("text", "<b>text</b>"), b: blk("text", "<i>text</i>") },
    ]),
  );
  assert.strictEqual(rows[0].kind, "format-changed");
});

test("equal text with the same markup is equal", () => {
  const rows = Array.from(
    app.ctx.buildRows([
      { type: "equal", a: blk("text", "<b>text</b>"), b: blk("text", "<b>text</b>") },
    ]),
  );
  assert.strictEqual(rows[0].kind, "equal");
});

test("the formatting comparison uses fmtKey, not html", () => {
  // Two reads of one file produce different html for a footnote anchor but the
  // same fmtKey. buildRows must look at the latter.
  const left = { text: "t", html: "<sup id='aaa_fn-1'>1</sup>", fmtKey: "<sup id='fn-1'>1</sup>" };
  const right = { text: "t", html: "<sup id='bbb_fn-1'>1</sup>", fmtKey: "<sup id='fn-1'>1</sup>" };
  const rows = Array.from(app.ctx.buildRows([{ type: "equal", a: left, b: right }]));
  assert.strictEqual(rows[0].kind, "equal");
});
