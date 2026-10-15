"use strict";

// Builds .docx fixtures.
//
// The two checked-in sample documents are a good end-to-end pair but they
// cannot be edited to probe a specific edge, so most tests construct their own
// package. Everything here writes real OOXML into a real zip: the point is to
// exercise js/app.js's parser, not a simplified stand-in for it.

const { writeZip } = require("./zip.js");

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

const TYPE = {
  header: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
  footer: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  footnotes: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes",
  comments: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
};

function xmlAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A <w:r> with optional run properties. */
function run(text, opts) {
  const o = opts || {};
  const props = [];
  if (o.bold) props.push("<w:b/>");
  if (o.italic) props.push("<w:i/>");
  if (o.underline) props.push("<w:u w:val=\"single\"/>");
  if (o.strike) props.push("<w:strike/>");
  if (o.color !== undefined && o.color !== null) {
    props.push('<w:color w:val="' + xmlAttr(o.color) + '"/>');
  }
  const rPr = props.length ? "<w:rPr>" + props.join("") + "</w:rPr>" : "";
  const tag = o.deleted ? "w:delText" : "w:t";
  return (
    "<w:r>" +
    rPr +
    "<" +
    tag +
    ' xml:space="preserve">' +
    xmlText(text) +
    "</" +
    tag +
    ">" +
    "</w:r>"
  );
}

/** A <w:r> whose only child is an inline image referencing relationship `relId`. */
function imageRun(relId) {
  return (
    "<w:r><w:drawing><wp:inline><a:graphic><a:graphicData>" +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:blipFill><a:blip r:embed="' +
    xmlAttr(relId) +
    '"/></pic:blipFill></pic:pic>' +
    "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
  );
}

function footnoteRefRun(id) {
  return '<w:r><w:footnoteReference w:id="' + xmlAttr(id) + '"/></w:r>';
}

/** A <w:p>. `opts.style` sets pStyle, `opts.list` makes it a list item. */
function para(runsHtml, opts) {
  const o = opts || {};
  const props = [];
  if (o.style) props.push('<w:pStyle w:val="' + xmlAttr(o.style) + '"/>');
  if (o.list) props.push("<w:numPr><w:ilvl w:val=\"" + (o.ilvl || 0) + '"/><w:numId w:val="1"/></w:numPr>');
  const pPr = props.length ? "<w:pPr>" + props.join("") + "</w:pPr>" : "";
  return "<w:p>" + pPr + (Array.isArray(runsHtml) ? runsHtml.join("") : runsHtml) + "</w:p>";
}

/** Wrap runs in a tracked insertion or deletion. */
function tracked(kind, author, inner) {
  return (
    "<w:" +
    kind +
    ' w:id="1" w:author="' +
    xmlAttr(author) +
    '" w:date="2026-01-01T00:00:00Z">' +
    (Array.isArray(inner) ? inner.join("") : inner) +
    "</w:" +
    kind +
    ">"
  );
}

function hyperlink(relId, inner) {
  return (
    '<w:hyperlink r:id="' +
    xmlAttr(relId) +
    '">' +
    (Array.isArray(inner) ? inner.join("") : inner) +
    "</w:hyperlink>"
  );
}

/** A one-row table. `rows` is an array of arrays of cell body XML. */
function table(rows, fills) {
  let out = "<w:tbl>";
  rows.forEach((cells, ri) => {
    out += "<w:tr>";
    cells.forEach((cell, ci) => {
      const fill = fills && fills[ri] && fills[ri][ci];
      const tcPr = fill ? '<w:tcPr><w:shd w:fill="' + xmlAttr(fill) + '"/></w:tcPr>' : "";
      out += "<w:tc>" + tcPr + cell + "</w:tc>";
    });
    out += "</w:tr>";
  });
  return out + "</w:tbl>";
}

function relsXml(rels) {
  const items = rels
    .map(
      (r) =>
        '<Relationship Id="' +
        xmlAttr(r.id) +
        '" Type="' +
        xmlAttr(r.type) +
        '" Target="' +
        xmlAttr(r.target) +
        '"' +
        (r.mode ? ' TargetMode="' + xmlAttr(r.mode) + '"' : "") +
        "/>",
    )
    .join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + REL_NS + ">" + items + "</Relationships>";
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  "</Types>";

const ROOT_RELS = relsXml([
  {
    id: "rId1",
    type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
    target: "word/document.xml",
  },
]);

// A one-pixel PNG, so image relationships resolve to real bytes.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Build a .docx.
 *
 * opts:
 *   body        array of block XML strings (use para()/table())
 *   rels        extra relationships for word/document.xml
 *   headers     array of arrays of block XML
 *   footers     array of arrays of block XML
 *   footnotes   array of {id, body}
 *   comments    array of {id, author, body}
 *   images      map of zip path -> Buffer
 *   extra       map of zip path -> string|Buffer, written verbatim
 *   omitDocument  leave word/document.xml out entirely
 */
function buildDocx(opts) {
  const o = opts || {};
  const files = {};
  files["[Content_Types].xml"] = CONTENT_TYPES;
  files["_rels/.rels"] = ROOT_RELS;

  const docRels = (o.rels || []).slice();

  (o.headers || []).forEach((blocks, i) => {
    const name = "header" + (i + 1) + ".xml";
    docRels.push({ id: "rIdHdr" + (i + 1), type: TYPE.header, target: name });
    files["word/" + name] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ' +
      W_NS +
      ">" +
      blocks.join("") +
      "</w:hdr>";
  });

  (o.footers || []).forEach((blocks, i) => {
    const name = "footer" + (i + 1) + ".xml";
    docRels.push({ id: "rIdFtr" + (i + 1), type: TYPE.footer, target: name });
    files["word/" + name] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' +
      W_NS +
      ">" +
      blocks.join("") +
      "</w:ftr>";
  });

  if (o.footnotes && o.footnotes.length) {
    docRels.push({ id: "rIdFn", type: TYPE.footnotes, target: "footnotes.xml" });
    const body = o.footnotes
      .map(
        (f) =>
          '<w:footnote w:id="' +
          xmlAttr(f.id) +
          '"' +
          (f.type ? ' w:type="' + xmlAttr(f.type) + '"' : "") +
          ">" +
          f.body +
          "</w:footnote>",
      )
      .join("");
    files["word/footnotes.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ' +
      W_NS +
      ">" +
      body +
      "</w:footnotes>";
  }

  if (o.comments && o.comments.length) {
    docRels.push({ id: "rIdCm", type: TYPE.comments, target: "comments.xml" });
    const body = o.comments
      .map(
        (c) =>
          '<w:comment w:id="' +
          xmlAttr(c.id) +
          '" w:author="' +
          xmlAttr(c.author) +
          '">' +
          c.body +
          "</w:comment>",
      )
      .join("");
    files["word/comments.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ' +
      W_NS +
      ">" +
      body +
      "</w:comments>";
  }

  for (const [p, buf] of Object.entries(o.images || {})) files[p] = buf;

  if (docRels.length) files["word/_rels/document.xml.rels"] = relsXml(docRels);

  if (!o.omitDocument) {
    files["word/document.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' +
      W_NS +
      "><w:body>" +
      (o.body || []).join("") +
      "</w:body></w:document>";
  }

  for (const [p, content] of Object.entries(o.extra || {})) files[p] = content;

  return writeZip(files);
}

/** The common case: a document that is nothing but plain paragraphs. */
function simpleDocx(paragraphs) {
  return buildDocx({ body: paragraphs.map((t) => para(run(t))) });
}

module.exports = {
  buildDocx,
  simpleDocx,
  para,
  run,
  imageRun,
  footnoteRefRun,
  tracked,
  hyperlink,
  table,
  relsXml,
  xmlAttr,
  xmlText,
  TYPE,
  PNG_1PX,
  W_NS,
};
