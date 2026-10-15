"use strict";

// What comes out of a .docx package, and what must never be left behind in it.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadApp, ROOT } = require("./harness.js");
const d = require("./docx.js");

const texts = (blocks) => Array.from(blocks, (b) => b.text);

test("plain paragraphs come out in order", async () => {
  const app = loadApp();
  const blocks = await app.blocks(d.simpleDocx(["first", "second", "third"]));
  assert.deepStrictEqual(texts(blocks), ["first", "second", "third"]);
});

test("a missing word/document.xml is refused by name", async () => {
  const app = loadApp();
  await assert.rejects(
    () => app.blocks(d.buildDocx({ omitDocument: true })),
    /not a valid \.docx/,
  );
});

test("something that is not a zip at all is refused", async () => {
  const app = loadApp();
  await assert.rejects(() => app.blocks(Buffer.from("Dear Sir, please find attached")));
});

test("headings carry their level", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [
        d.para(d.run("Title"), { style: "Heading1" }),
        d.para(d.run("Sub"), { style: "Heading2" }),
        d.para(d.run("Body")),
      ],
    }),
  );
  assert.strictEqual(blocks[0].isHeading, true);
  assert.strictEqual(blocks[0].headingLevel, 1);
  assert.strictEqual(blocks[1].headingLevel, 2);
  assert.strictEqual(blocks[2].isHeading, false);
});

test("list items carry their indent level", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [
        d.para(d.run("top"), { list: true, ilvl: 0 }),
        d.para(d.run("nested"), { list: true, ilvl: 2 }),
      ],
    }),
  );
  assert.strictEqual(blocks[0].isListItem, true);
  assert.strictEqual(blocks[0].ilvl, 0);
  assert.strictEqual(blocks[1].ilvl, 2);
});

test("headers, footers, footnotes and comments are all read", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [d.para(d.run("body text"))],
      headers: [[d.para(d.run("page header"))]],
      footers: [[d.para(d.run("page footer"))]],
      footnotes: [{ id: "1", body: d.para(d.run("a footnote")) }],
      comments: [{ id: "1", author: "Reviewer", body: d.para(d.run("a comment")) }],
    }),
  );
  const all = texts(blocks).join(" ");
  for (const want of ["page header", "body text", "page footer", "a footnote", "a comment"]) {
    assert.ok(all.includes(want), `expected ${want} in the extracted blocks`);
  }
  const labels = Array.from(blocks, (b) => b.sectionLabel);
  for (const want of ["header", "body", "footer", "footnote", "comment"]) {
    assert.ok(labels.includes(want), `expected a ${want} section`);
  }
});

test("separator footnotes are not treated as content", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [d.para(d.run("body"))],
      footnotes: [
        { id: "-1", type: "separator", body: d.para(d.run("sep")) },
        { id: "0", type: "continuationSeparator", body: d.para(d.run("cont")) },
        { id: "1", body: d.para(d.run("the real footnote")) },
      ],
    }),
  );
  const all = texts(blocks).join(" ");
  assert.ok(all.includes("the real footnote"));
  assert.ok(!all.includes("sep"));
  assert.ok(!all.includes("cont"));
});

test("a paragraph inside a content control is read, not skipped", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [
        d.para(d.run("before")),
        "<w:sdt><w:sdtPr/><w:sdtContent>" +
          d.para(d.run("inside a content control")) +
          "</w:sdtContent></w:sdt>",
        d.para(d.run("after")),
      ],
    }),
  );
  assert.deepStrictEqual(texts(blocks), ["before", "inside a content control", "after"]);
});

test("content controls nested two deep are still read", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [
        "<w:sdt><w:sdtContent><w:sdt><w:sdtContent>" +
          d.para(d.run("deep")) +
          "</w:sdtContent></w:sdt></w:sdtContent></w:sdt>",
      ],
    }),
  );
  assert.deepStrictEqual(texts(blocks), ["deep"]);
});

test("a table inside a content control is read", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [
        "<w:sdt><w:sdtContent>" +
          d.table([[d.para(d.run("a")), d.para(d.run("b"))]]) +
          "</w:sdtContent></w:sdt>",
      ],
    }),
  );
  assert.deepStrictEqual(texts(blocks), ["a | b"]);
  assert.strictEqual(blocks[0].isTableRow, true);
});

test("a paragraph inside a text box is read", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [
        "<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>" +
          d.para(d.run("callout text")) +
          "</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>",
      ],
    }),
  );
  assert.ok(texts(blocks).join(" ").includes("callout text"));
});

test("a nested table contributes its text to the containing cell", async () => {
  const app = loadApp();
  const inner = d.table([[d.para(d.run("nested cell"))]]);
  const blocks = await app.blocks(
    d.buildDocx({ body: [d.table([[d.para(d.run("outer")) + inner]])] }),
  );
  assert.strictEqual(blocks.length, 1);
  assert.ok(
    blocks[0].text.includes("nested cell"),
    "expected the nested table's text, got: " + JSON.stringify(blocks[0].text),
  );
  assert.ok(blocks[0].text.includes("outer"));
});

test("each table row is its own block and cells are joined with a pipe", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [
        d.table([
          [d.para(d.run("r1c1")), d.para(d.run("r1c2"))],
          [d.para(d.run("r2c1")), d.para(d.run("r2c2"))],
        ]),
      ],
    }),
  );
  assert.deepStrictEqual(texts(blocks), ["r1c1 | r1c2", "r2c1 | r2c2"]);
});

test("run properties that are explicitly switched off stay off", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [
        d.para(
          '<w:r><w:rPr><w:b w:val="0"/><w:i w:val="false"/><w:u w:val="none"/>' +
            '<w:strike w:val="off"/></w:rPr><w:t>plain</w:t></w:r>',
        ),
      ],
    }),
  );
  const s = blocks[0].segments[0];
  assert.strictEqual(s.bold, false);
  assert.strictEqual(s.italic, false);
  assert.strictEqual(s.underline, false);
  assert.strictEqual(s.strike, false);
  assert.ok(!blocks[0].html.includes("font-weight"), blocks[0].html);
});

test("run properties that are present and unqualified are on", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({ body: [d.para(d.run("loud", { bold: true, italic: true }))] }),
  );
  assert.strictEqual(blocks[0].segments[0].bold, true);
  assert.strictEqual(blocks[0].segments[0].italic, true);
});

test('w:u w:val="single" is an underline', async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({ body: [d.para(d.run("underlined", { underline: true }))] }),
  );
  assert.strictEqual(blocks[0].segments[0].underline, true);
});

test("tabs and breaks become segments", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [d.para("<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r>")],
    }),
  );
  assert.strictEqual(blocks[0].text, "a\tb\nc");
});

test("tracked insertions and deletions are labelled with their author", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [
        d.para([
          d.run("kept "),
          d.tracked("ins", "Ana", d.run("added")),
          d.tracked("del", "Bo", d.run("removed", { deleted: true })),
        ]),
      ],
    }),
  );
  const segs = blocks[0].segments;
  assert.strictEqual(segs[1].trackType, "ins");
  assert.strictEqual(segs[1].author, "Ana");
  assert.strictEqual(segs[2].isDel, true);
  // A tracked deletion is not part of the text the two documents are aligned
  // on -- it is text the author has already taken out.
  assert.strictEqual(blocks[0].text, "kept added");
  assert.ok(blocks[0].html.includes("removed"), "but it is still rendered");
});

test("an embedded image becomes a data URL and a stable token", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [d.para([d.run("see "), d.imageRun("rIdI")])],
      rels: [{ id: "rIdI", type: d.TYPE.image, target: "media/photo.png" }],
      images: { "word/media/photo.png": d.PNG_1PX },
    }),
  );
  const img = blocks[0].segments.find((s) => s.isImage);
  assert.ok(img.dataUrl.startsWith("data:image/png;base64,"));
  assert.ok(blocks[0].html.includes("<img src=\"data:image/png;base64,"));
  assert.strictEqual(Object.keys(blocks[0].imageTokens).length, 1);
});

test("an image whose part is missing does not throw", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [d.para([d.run("x"), d.imageRun("rIdI")])],
      rels: [{ id: "rIdI", type: d.TYPE.image, target: "media/absent.png" }],
    }),
  );
  assert.ok(blocks[0].html.includes("[image]"));
});

test("a relationship target that climbs out of the package resolves to nothing", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [d.para([d.run("x"), d.imageRun("rIdI")])],
      rels: [{ id: "rIdI", type: d.TYPE.image, target: "../../../../secrets.png" }],
    }),
  );
  // Nothing in the zip answers to that path, so the image is simply absent.
  assert.ok(blocks[0].html.includes("[image]"));
});

test("a hyperlink keeps its target and an internal anchor keeps its name", async () => {
  const app = loadApp();
  const blocks = await app.blocks(
    d.buildDocx({
      body: [
        d.para(d.hyperlink("rIdL", d.run("external"))),
        d.para('<w:hyperlink w:anchor="section2">' + d.run("internal") + "</w:hyperlink>"),
      ],
      rels: [
        {
          id: "rIdL",
          type: d.TYPE.hyperlink,
          target: "https://example.org/report",
          mode: "External",
        },
      ],
    }),
  );
  assert.strictEqual(blocks[0].segments[0].href, "https://example.org/report");
  assert.strictEqual(blocks[1].segments[0].href, "#section2");
});

test("the two checked-in sample documents both parse", async () => {
  const app = loadApp();
  for (const name of ["report_v1.docx", "report_v2.docx"]) {
    const blocks = await app.blocks(fs.readFileSync(path.join(ROOT, "tests", "fixtures", name)), name);
    assert.ok(blocks.length > 10, `${name} produced only ${blocks.length} blocks`);
    assert.ok(
      texts(blocks).some((t) => t.includes("Marketing Performance Report")),
      `${name} lost its title`,
    );
  }
});

test("every block carries the four fields the renderer needs", async () => {
  const app = loadApp();
  const blocks = await app.blocks(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "report_v2.docx")));
  for (const b of blocks) {
    assert.strictEqual(typeof b.text, "string");
    assert.strictEqual(typeof b.html, "string");
    assert.strictEqual(typeof b.fmtKey, "string");
    assert.strictEqual(typeof b.imageTokens, "object");
  }
});
