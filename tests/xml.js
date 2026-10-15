"use strict";

// A minimal XML parser producing just enough of a DOM for js/app.js.
//
// The app calls DOMParser().parseFromString(xml, "application/xml") and then
// uses exactly six things: nodeType, localName, childNodes, getAttribute,
// getElementsByTagName("*") and textContent. This builds those, with the same
// semantics a browser gives them for a namespaced document:
//
//   - localName is the part after the colon, so <w:p> has localName "p".
//   - getAttribute matches the *qualified* name as written, so the app's
//     getAttribute("w:val") and getAttribute("r:embed") work without the
//     parser knowing anything about namespace URIs. This is what a browser
//     does too, and it is why the app can get away with never declaring one.

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)
      ? NAMED_ENTITIES[body]
      : whole;
  });
}

class XmlNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
  }
}

class XmlText extends XmlNode {
  constructor(data) {
    super(TEXT_NODE);
    this.data = data;
  }
  get textContent() {
    return this.data;
  }
}

class XmlElement extends XmlNode {
  constructor(name, attrs) {
    super(ELEMENT_NODE);
    this.nodeName = name;
    this.tagName = name;
    const colon = name.indexOf(":");
    this.prefix = colon >= 0 ? name.slice(0, colon) : null;
    this.localName = colon >= 0 ? name.slice(colon + 1) : name;
    this._attrs = attrs;
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
  }
  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name);
  }
  getElementsByTagName(sel) {
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== ELEMENT_NODE) continue;
        if (sel === "*" || child.nodeName === sel) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  get textContent() {
    let out = "";
    for (const child of this.childNodes) out += child.textContent;
    return out;
  }
}

class XmlDocument extends XmlNode {
  constructor() {
    super(9);
  }
  get documentElement() {
    return this.childNodes.find((n) => n.nodeType === ELEMENT_NODE) || null;
  }
  getElementsByTagName(sel) {
    const root = this.documentElement;
    if (!root) return [];
    const out = sel === "*" || root.nodeName === sel ? [root] : [];
    return out.concat(root.getElementsByTagName(sel));
  }
  get textContent() {
    const root = this.documentElement;
    return root ? root.textContent : "";
  }
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function parseAttributes(src) {
  const attrs = Object.create(null);
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(src)) !== null) {
    attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
  }
  return attrs;
}

function parseXml(src) {
  const doc = new XmlDocument();
  const stack = [doc];
  let i = 0;

  const push = (node) => {
    const parent = stack[stack.length - 1];
    node.parentNode = parent;
    parent.childNodes.push(node);
  };

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      const tail = src.slice(i);
      if (tail) push(new XmlText(decodeEntities(tail)));
      break;
    }
    if (lt > i) push(new XmlText(decodeEntities(src.slice(i, lt))));

    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt);
      const body = src.slice(lt + 9, end < 0 ? src.length : end);
      push(new XmlText(body)); // CDATA content is not entity-decoded
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (src.startsWith("<!", lt)) {
      const end = src.indexOf(">", lt);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (src.startsWith("</", lt)) {
      const end = src.indexOf(">", lt);
      if (end < 0) throw new Error("unterminated end tag");
      if (stack.length > 1) stack.pop();
      i = end + 1;
      continue;
    }

    // Start tag. Find the matching ">", skipping any inside quoted attributes.
    let j = lt + 1;
    let quote = null;
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
    }
    if (j >= src.length) throw new Error("unterminated start tag");

    let inner = src.slice(lt + 1, j);
    const selfClosing = inner.endsWith("/");
    if (selfClosing) inner = inner.slice(0, -1);

    const nameMatch = /^([^\s/>]+)/.exec(inner);
    if (!nameMatch) throw new Error("malformed start tag");
    const el = new XmlElement(nameMatch[1], parseAttributes(inner.slice(nameMatch[1].length)));
    push(el);
    if (!selfClosing) stack.push(el);
    i = j + 1;
  }

  return doc;
}

class DOMParser {
  parseFromString(src, mime) {
    if (mime !== "application/xml" && mime !== "text/xml") {
      throw new Error(`xml shim: unsupported mime type ${mime}`);
    }
    return parseXml(src);
  }
}

module.exports = { DOMParser, parseXml, XmlElement, XmlText, XmlDocument, decodeEntities };
