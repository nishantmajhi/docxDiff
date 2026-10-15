(function () {
  // docxDiff. Loaded by index.html after vendor/jszip.min.js; styled by
  // css/style.css. Everything runs in this browser tab and nothing is sent
  // anywhere.

  var state = { left: null, right: null }; // {fileName, blocks}

  var app = document.getElementById("app");
  var resetBtn = document.getElementById("reset-btn");
  var inputLeft = document.getElementById("file-input-left");
  var inputRight = document.getElementById("file-input-right");

  var lastDiffHtml = "";

  // Document content reaches the page inside attribute values as well as
  // between tags -- title=, data-href=, id= and href= all carry strings
  // taken straight out of the .docx -- so the quotes have to go too.
  // Without them an author name or a hyperlink target closes the
  // attribute it sits in and everything after it becomes markup.
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escapeHtmlVisibleWs(s) {
    return escapeHtml(s).replace(/ /g, '<span class="ws-dot">\u00b7</span>');
  }

  // Colours are the one place a document's string is interpolated into
  // CSS rather than into text, and escaping is the wrong tool there:
  // a colour is not arbitrary text that needs quoting, it is one of a
  // known set of values. OOXML writes w:color/@w:val and w:shd/@w:fill
  // as six hex digits or the word "auto", so accept exactly that and
  // discard anything else rather than trying to describe what is unsafe.
  function hexColor(v) {
    return typeof v === "string" && /^[0-9A-Fa-f]{6}$/.test(v)
      ? v.toUpperCase()
      : null;
  }

  // A toggle property in OOXML is on when the element is present, unless
  // its w:val says otherwise. Word writes <w:b w:val="0"/> whenever a run
  // turns off something its paragraph style switched on, so reading mere
  // presence as "on" renders text bold that the document says is not.
  function onOff(el) {
    if (!el) return false;
    var v = el.getAttribute("w:val");
    if (v === null) return true;
    return !(v === "0" || v === "false" || v === "off" || v === "none");
  }

  // ============================== OOXML EXTRACTION ==============================

  function childrenLocal(el, name) {
    return Array.from(el.childNodes).filter(function (n) {
      return n.nodeType === 1 && n.localName === name;
    });
  }
  function allLocal(el, name) {
    return Array.from(el.getElementsByTagName("*")).filter(function (n) {
      return n.localName === name;
    });
  }
  function firstLocal(el, name) {
    var arr = childrenLocal(el, name);
    return arr.length ? arr[0] : null;
  }

  function extractParagraph(pEl, pendingImages, rels, basePart, docId) {
    var pPr = firstLocal(pEl, "pPr");
    var numPr = pPr && firstLocal(pPr, "numPr");
    var ilvl = 0;
    if (numPr) {
      var ilvlEl = firstLocal(numPr, "ilvl");
      if (ilvlEl) ilvl = parseInt(ilvlEl.getAttribute("w:val") || "0", 10) || 0;
    }
    var isListItem = !!numPr;
    var pStyle = pPr && firstLocal(pPr, "pStyle");
    var styleVal = pStyle ? pStyle.getAttribute("w:val") : null;
    var isHeading = false,
      headingLevel = 0;
    if (styleVal && /^Heading([1-6])/.test(styleVal)) {
      isHeading = true;
      headingLevel = parseInt(RegExp.$1, 10);
    }

    var segments = [];

    function walk(node, ctx) {
      Array.from(node.childNodes).forEach(function (child) {
        if (child.nodeType !== 1) return;
        var ln = child.localName;
        if (ln === "ins") {
          walk(
            child,
            Object.assign({}, ctx, {
              trackType: "ins",
              author: child.getAttribute("w:author") || "",
            }),
          );
        } else if (ln === "del") {
          walk(
            child,
            Object.assign({}, ctx, {
              trackType: "del",
              author: child.getAttribute("w:author") || "",
            }),
          );
        } else if (ln === "hyperlink") {
          var rid = child.getAttribute("r:id");
          var anchor = child.getAttribute("w:anchor");
          var href = null;
          if (rid && rels[rid]) href = rels[rid].target;
          else if (anchor) href = "#" + anchor;
          walk(child, Object.assign({}, ctx, { href: href }));
        } else if (ln === "r") {
          var rPr = firstLocal(child, "rPr");
          var bold = rPr
            ? onOff(firstLocal(rPr, "b")) || onOff(firstLocal(rPr, "bCs"))
            : false;
          var italic = rPr
            ? onOff(firstLocal(rPr, "i")) || onOff(firstLocal(rPr, "iCs"))
            : false;
          var underline = rPr ? onOff(firstLocal(rPr, "u")) : false;
          var strike = rPr ? onOff(firstLocal(rPr, "strike")) : false;
          var colorEl = rPr && firstLocal(rPr, "color");
          var color = colorEl ? hexColor(colorEl.getAttribute("w:val")) : null;
          Array.from(child.childNodes).forEach(function (tn) {
            if (tn.nodeType !== 1) return;
            if (tn.localName === "t" || tn.localName === "delText") {
              segments.push({
                text: tn.textContent,
                bold: bold,
                italic: italic,
                underline: underline,
                strike: strike,
                color: color,
                trackType: ctx.trackType || null,
                author: ctx.author || null,
                href: ctx.href || null,
                isDel: tn.localName === "delText",
                isImage: false,
              });
            } else if (tn.localName === "tab") {
              segments.push({
                text: "\t",
                bold: false,
                isDel: false,
                isImage: false,
                trackType: ctx.trackType || null,
              });
            } else if (tn.localName === "br") {
              segments.push({
                text: "\n",
                bold: false,
                isDel: false,
                isImage: false,
                trackType: ctx.trackType || null,
              });
            } else if (tn.localName === "drawing") {
              var blip = allLocal(tn, "blip")[0];
              var embed = blip ? blip.getAttribute("r:embed") : null;
              var seg = {
                text: "\uFFFC",
                isImage: true,
                isDel: false,
                relId: embed,
                trackType: ctx.trackType || null,
                dataUrl: null,
                _rels: rels,
                _basePart: basePart,
              };
              segments.push(seg);
              if (embed) pendingImages.push(seg);
              // A drawing can carry a text box as well as a picture, and
              // its paragraphs sit below this point.
              walk(tn, ctx);
            } else if (tn.localName === "footnoteReference") {
              var fnRefId = tn.getAttribute("w:id");
              segments.push({
                text: fnRefId,
                isFootnoteRef: true,
                footnoteId: fnRefId,
                anchorId: (docId || "") + "fn-" + fnRefId,
                refAnchorId: (docId || "") + "fnref-" + fnRefId,
                isDel: false,
                isImage: false,
                trackType: ctx.trackType || null,
              });
            } else {
              // Anything else inside a run can still hold text. A text
              // box -- VML w:pict, or the DrawingML equivalent -- holds
              // whole paragraphs, and skipping it meant a callout or a
              // sidebar was compared as though it were not in the
              // document. Its paragraphs are flattened into the
              // paragraph that anchors the box rather than becoming
              // blocks of their own, which is where they sit in the
              // reading order anyway.
              walk(tn, ctx);
            }
          });
        } else {
          walk(child, ctx);
        }
      });
    }
    walk(pEl, {});
    return {
      isHeading: isHeading,
      headingLevel: headingLevel,
      isListItem: isListItem,
      ilvl: ilvl,
      segments: segments,
    };
  }

  function makeParagraphBlock(pd, sectionLabel) {
    return {
      sectionLabel: sectionLabel,
      isHeading: pd.isHeading,
      headingLevel: pd.headingLevel,
      isListItem: pd.isListItem,
      ilvl: pd.ilvl,
      segments: pd.segments,
      isTableRow: false,
      isDivider: false,
    };
  }
  function makeTableRowBlock(cells, sectionLabel) {
    return {
      sectionLabel: sectionLabel,
      isTableRow: true,
      cells: cells,
      isDivider: false,
    };
  }
  function makeDividerBlock(label) {
    return {
      sectionLabel: "divider",
      isDivider: true,
      segments: [
        {
          text: "\u2014 " + label + " \u2014",
          isDel: false,
          isImage: false,
        },
      ],
    };
  }

  // Every w:p at or below `el`, in document order, without descending
  // into a paragraph itself. Used for the contents of a table cell, which
  // may hold a nested table whose paragraphs would otherwise be lost.
  function descendantParagraphs(el) {
    var out = [];
    (function walk(node) {
      Array.from(node.childNodes).forEach(function (child) {
        if (child.nodeType !== 1) return;
        if (child.localName === "p") out.push(child);
        else walk(child);
      });
    })(el);
    return out;
  }

  function extractBlocksFromContainer(
    containerEl,
    pendingImages,
    rels,
    sectionLabel,
    basePart,
    docId,
  ) {
    var blocks = [];

    function visit(el) {
      Array.from(el.childNodes).forEach(function (child) {
        if (child.nodeType !== 1) return;
        var ln = child.localName;
        if (ln === "p") {
          blocks.push(
            makeParagraphBlock(
              extractParagraph(child, pendingImages, rels, basePart, docId),
              sectionLabel,
            ),
          );
        } else if (ln === "tbl") {
          childrenLocal(child, "tr").forEach(function (tr) {
            var cells = childrenLocal(tr, "tc").map(function (tc) {
              var segs = [];
              // descendantParagraphs rather than direct children: a cell
              // holding a nested table used to contribute nothing but its
              // own loose paragraphs, so the nested rows vanished.
              descendantParagraphs(tc).forEach(function (p, idx) {
                if (idx > 0)
                  segs.push({ text: "\n", isDel: false, isImage: false });
                var pd = extractParagraph(
                  p,
                  pendingImages,
                  rels,
                  basePart,
                  docId,
                );
                segs = segs.concat(pd.segments);
              });
              var tcPr = firstLocal(tc, "tcPr");
              var shd = tcPr && firstLocal(tcPr, "shd");
              var fill = shd ? hexColor(shd.getAttribute("w:fill")) : null;
              if (fill === "FFFFFF") fill = null;
              return { segs: segs, fill: fill };
            });
            blocks.push(makeTableRowBlock(cells, sectionLabel));
          });
        } else {
          // Not a block itself, but it may contain them. Content controls
          // (w:sdt), text boxes (w:txbxContent), smart tags and custom XML
          // all sit between the body and its paragraphs. Looking only at
          // direct children meant a table of contents, a form field or a
          // whole templated section was never read at all -- and a diff
          // that never reads a section reports it as unchanged, which is
          // the one answer it must never give.
          visit(child);
        }
      });
    }

    visit(containerEl);
    return blocks;
  }

  function footnoteOrCommentBlock(
    containerEl,
    prefixSeg,
    pendingImages,
    rels,
    sectionLabel,
    basePart,
    docId,
  ) {
    var segs = [prefixSeg];
    childrenLocal(containerEl, "p").forEach(function (p, idx) {
      if (idx > 0) segs.push({ text: " ", isDel: false, isImage: false });
      var pd = extractParagraph(p, pendingImages, rels, basePart, docId);
      segs = segs.concat(pd.segments);
    });
    return {
      sectionLabel: sectionLabel,
      isHeading: false,
      isListItem: false,
      ilvl: 0,
      segments: segs,
      isTableRow: false,
      isDivider: false,
    };
  }

  // Images and footnote references are diffed as tokens, so they need a
  // spelling inside the plain text that the word tokeniser can pick out
  // again. Both are wrapped in their own marker character at each end:
  // the fingerprint of an image is base64, which has no delimiter of its
  // own, so an opening marker alone left "fig<mark>1892:AAB...</mark>one"
  // as a single word whenever an image sat against text with no space.
  // That word matched nothing in the token map and was printed verbatim.
  var IMG_MARK = "\uFFFC";
  var FN_MARK = "\uFFFD";

  function imageToken(seg) {
    return IMG_MARK + (seg.imgFingerprint || seg.relId || "?") + IMG_MARK;
  }
  function footnoteToken(seg) {
    return FN_MARK + (seg.footnoteId || "?") + FN_MARK;
  }
  // Marker characters occurring in the document's own text would make a
  // token ambiguous, so they are dropped from the text used for
  // alignment. They stay in the rendered markup, so a paragraph that
  // differs only by one still shows up -- as a formatting change.
  function stripTokenMarks(s) {
    return String(s).replace(/[\uFFFC\uFFFD]/g, "");
  }

  // Record every image and footnote segment under the exact token that
  // plainTextForDiff will emit for it, so the renderer can turn a token
  // back into the thing it stands for. Both sides go through the same two
  // helpers; building the key separately is how they drifted before.
  function indexTokens(block, segments) {
    segments.forEach(function (s) {
      if (s.isDel) return;
      if (s.isImage) block.imageTokens[imageToken(s)] = s;
      else if (s.isFootnoteRef || s.isFootnoteMarker)
        block.footnoteTokens[footnoteToken(s)] = s;
    });
  }

  function plainTextForDiff(segments) {
    return segments
      .filter(function (s) {
        return !s.isDel;
      })
      .map(function (s) {
        if (s.isImage) return imageToken(s);
        if (s.isFootnoteRef || s.isFootnoteMarker) return footnoteToken(s);
        return stripTokenMarks(s.text);
      })
      .join("");
  }

  function renderSegmentsHtml(segments) {
    return segments
      .map(function (s) {
        if (s.isFootnoteRef) {
          return (
            '<sup class="fn-ref" id="' +
            escapeHtml(s.refAnchorId) +
            '"><a class="fn-ref-link" href="#' +
            escapeHtml(s.anchorId) +
            '" title="Jump to footnote ' +
            escapeHtml(s.footnoteId) +
            '">' +
            escapeHtml(s.footnoteId) +
            "</a></sup>"
          );
        }
        if (s.isFootnoteMarker) {
          return (
            '<sup class="fn-marker" id="' +
            escapeHtml(s.anchorId) +
            '"><a class="fn-marker-link" href="#' +
            escapeHtml(s.backAnchorId) +
            '" title="Back to text">' +
            escapeHtml(s.footnoteId) +
            "</a></sup>"
          );
        }
        if (s.isImage) {
          var cls =
            "inline-img" +
            (s.trackType === "ins" ? " trk-ins" : "") +
            (s.trackType === "del" ? " trk-del" : "");
          var title = s.trackType
            ? "Tracked " + s.trackType + (s.author ? " by " + s.author : "")
            : "Embedded image";
          return (
            '<span class="' +
            cls +
            '" title="' +
            escapeHtml(title) +
            '">' +
            (s.dataUrl ? '<img src="' + s.dataUrl + '">' : "[image]") +
            "</span>"
          );
        }
        var text = escapeHtml(s.text)
          .replace(/\t/g, "&nbsp;&nbsp;&nbsp;&nbsp;")
          .replace(/\n/g, "<br>");
        var style = "";
        if (s.bold) style += "font-weight:600;";
        if (s.italic) style += "font-style:italic;";
        if (s.underline) style += "text-decoration:underline;";
        if (s.strike) style += "text-decoration:line-through;";
        if (s.color) style += "color:#" + s.color + ";";
        var cls = [];
        var title = "";
        if (s.isDel) {
          cls.push("trk-del");
          title = "Tracked deletion" + (s.author ? " by " + s.author : "");
        } else if (s.trackType === "ins") {
          cls.push("trk-ins");
          title = "Tracked insertion" + (s.author ? " by " + s.author : "");
        }
        var inner = text;
        if (s.href) {
          inner =
            '<a class="doc-link" data-href="' +
            escapeHtml(s.href) +
            '" title="' +
            escapeHtml(s.href) +
            '">' +
            inner +
            "</a>";
        }
        return (
          "<span" +
          (cls.length ? ' class="' + cls.join(" ") + '"' : "") +
          (style ? ' style="' + style + '"' : "") +
          (title ? ' title="' + escapeHtml(title) + '"' : "") +
          ">" +
          inner +
          "</span>"
        );
      })
      .join("");
  }

  async function extractDocxStructured(file) {
    var docId = "d" + Math.random().toString(36).slice(2, 9) + "_";
    var buf = await file.arrayBuffer();
    var zip = await JSZip.loadAsync(buf);

    async function xml(path) {
      var f = zip.file(path);
      if (!f) return null;
      var s = await f.async("string");
      return new DOMParser().parseFromString(s, "application/xml");
    }
    async function relsFor(partPath) {
      var idx = partPath.lastIndexOf("/");
      var dir = idx >= 0 ? partPath.slice(0, idx) : "";
      var name = idx >= 0 ? partPath.slice(idx + 1) : partPath;
      var relsPath = (dir ? dir + "/" : "") + "_rels/" + name + ".rels";
      var relsXmlDoc = await xml(relsPath);
      var map = {};
      if (relsXmlDoc) {
        allLocal(relsXmlDoc, "Relationship").forEach(function (r) {
          map[r.getAttribute("Id")] = {
            target: r.getAttribute("Target"),
            type: r.getAttribute("Type"),
            mode: r.getAttribute("TargetMode"),
          };
        });
      }
      return map;
    }
    function resolveTarget(basePartPath, target, mode) {
      if (
        mode === "External" ||
        /^https?:\/\//i.test(target || "") ||
        /^mailto:/i.test(target || "")
      )
        return target;
      var idx = basePartPath.lastIndexOf("/");
      var dir = idx >= 0 ? basePartPath.slice(0, idx) : "";
      var combined = (dir ? dir + "/" : "") + target;
      var parts = combined.split("/"),
        stack = [];
      parts.forEach(function (p) {
        if (p === "" || p === ".") return;
        if (p === "..") stack.pop();
        else stack.push(p);
      });
      return stack.join("/");
    }

    var docXml = await xml("word/document.xml");
    if (!docXml)
      throw new Error("Missing word/document.xml \u2014 not a valid .docx");
    var docRels = await relsFor("word/document.xml");

    var pendingImages = [];
    var blocks = [];

    var headerParts = [],
      footerParts = [];
    Object.keys(docRels).forEach(function (id) {
      var r = docRels[id];
      if (!r.type) return;
      if (/\/header$/.test(r.type))
        headerParts.push(resolveTarget("word/document.xml", r.target, r.mode));
      if (/\/footer$/.test(r.type))
        footerParts.push(resolveTarget("word/document.xml", r.target, r.mode));
    });

    for (var hi = 0; hi < headerParts.length; hi++) {
      var hp = headerParts[hi];
      var hXml = await xml(hp);
      if (!hXml) continue;
      var hRels = await relsFor(hp);
      blocks.push(makeDividerBlock("HEADER"));
      blocks = blocks.concat(
        extractBlocksFromContainer(
          hXml.documentElement,
          pendingImages,
          hRels,
          "header",
          hp,
          docId,
        ),
      );
    }

    var body = allLocal(docXml, "body")[0];
    if (body)
      blocks = blocks.concat(
        extractBlocksFromContainer(
          body,
          pendingImages,
          docRels,
          "body",
          "word/document.xml",
          docId,
        ),
      );

    for (var fi = 0; fi < footerParts.length; fi++) {
      var fp = footerParts[fi];
      var fXml = await xml(fp);
      if (!fXml) continue;
      var fRels = await relsFor(fp);
      blocks.push(makeDividerBlock("FOOTER"));
      blocks = blocks.concat(
        extractBlocksFromContainer(
          fXml.documentElement,
          pendingImages,
          fRels,
          "footer",
          fp,
          docId,
        ),
      );
    }

    var footnotesXml = await xml("word/footnotes.xml");
    if (footnotesXml) {
      var fnRels = await relsFor("word/footnotes.xml");
      var fns = childrenLocal(footnotesXml.documentElement, "footnote").filter(
        function (f) {
          var t = f.getAttribute("w:type");
          return t !== "separator" && t !== "continuationSeparator";
        },
      );
      if (fns.length) {
        blocks.push(makeDividerBlock("FOOTNOTES"));
        fns.forEach(function (f) {
          var id = f.getAttribute("w:id");
          blocks.push(
            footnoteOrCommentBlock(
              f,
              {
                text: id,
                isFootnoteMarker: true,
                footnoteId: id,
                anchorId: docId + "fn-" + id,
                backAnchorId: docId + "fnref-" + id,
                isDel: false,
                isImage: false,
              },
              pendingImages,
              fnRels,
              "footnote",
              "word/footnotes.xml",
              docId,
            ),
          );
        });
      }
    }

    var commentsXml = await xml("word/comments.xml");
    if (commentsXml) {
      var cRels = await relsFor("word/comments.xml");
      var cs = childrenLocal(commentsXml.documentElement, "comment");
      if (cs.length) {
        blocks.push(makeDividerBlock("COMMENTS"));
        cs.forEach(function (c) {
          var author = c.getAttribute("w:author") || "Unknown";
          blocks.push(
            footnoteOrCommentBlock(
              c,
              {
                text: "Comment (" + author + "): ",
                bold: true,
                isDel: false,
                isImage: false,
              },
              pendingImages,
              cRels,
              "comment",
              "word/comments.xml",
              docId,
            ),
          );
        });
      }
    }

    await Promise.all(
      pendingImages.map(async function (seg) {
        if (!seg.relId || !seg._rels || !seg._rels[seg.relId]) return;
        var r = seg._rels[seg.relId];
        var path = resolveTarget(seg._basePart, r.target, r.mode);
        var f = zip.file(path);
        if (!f) return;
        var base64 = await f.async("base64");
        var ext = (path.split(".").pop() || "png").toLowerCase();
        var mime =
          ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : ext === "gif"
              ? "image/gif"
              : ext === "bmp"
                ? "image/bmp"
                : "image/png";
        seg.dataUrl = "data:" + mime + ";base64," + base64;
        seg.imgFingerprint = base64.length + ":" + base64.slice(-16);
      }),
    );

    blocks.forEach(function (b) {
      b.imageTokens = {};
      b.footnoteTokens = {};
      if (b.isTableRow) {
        b.text = b.cells
          .map(function (c) {
            return plainTextForDiff(c.segs);
          })
          .join(" | ");
        b.html =
          '<div class="row-cells">' +
          b.cells
            .map(function (c) {
              var style = c.fill ? ' style="background:#' + c.fill + ';"' : "";
              return (
                '<div class="row-cell"' +
                style +
                ">" +
                renderSegmentsHtml(c.segs) +
                "</div>"
              );
            })
            .join("") +
          "</div>";
        b.cells.forEach(function (c) {
          indexTokens(b, c.segs);
        });
      } else {
        b.text = plainTextForDiff(b.segments);
        b.html = renderSegmentsHtml(b.segments);
        indexTokens(b, b.segments);
      }

      // b.html carries docId, which is freshly randomised on every read,
      // so the same file read twice produces two different strings for
      // any paragraph holding a footnote anchor. Comparing b.html to
      // decide "formatting changed" therefore reported every one of
      // those paragraphs as changed against an identical copy of itself.
      // fmtKey is the same markup with the per-read id taken back out,
      // and it -- not b.html -- is what the alignment compares.
      b.fmtKey = docId ? b.html.split(docId).join("") : b.html;

      // A paragraph that is entirely a tracked deletion (or otherwise has no
      // accepted text but still has visible markup, e.g. an in-source comment
      // anchor) must never be treated as an interchangeable "blank paragraph"
      // during alignment -- give it a key of its own so it surfaces as its
      // own change instead of silently absorbing into an unrelated blank.
      // The key is the markup itself and not a counter: the counter ran across
      // both documents at once, so the same deleted paragraph was handed a
      // different key on each side and always came out as one removal plus one
      // addition -- even when a file was compared with itself.
      if (b.text === "" && b.fmtKey !== "") {
        b.text = "\u0000" + b.fmtKey;
      }
    });

    return blocks;
  }

  // ============================== DIFF ENGINE ==============================

  // Split on runs of whitespace, and on each of the two marked tokens.
  // Both markers are paired, so a token ends where its own closing marker
  // is rather than where the next space happens to fall -- which is what
  // lets an image sit directly against a word without swallowing it.
  var TOKEN_SPLIT =
    /(\s+|\uFFFC[^\uFFFC\uFFFD]*\uFFFC|\uFFFD[^\uFFFC\uFFFD]*\uFFFD)/;

  function tokenizeWords(text) {
    return text.split(TOKEN_SPLIT).filter(function (t) {
      return t.length > 0;
    });
  }

  // How the diff is computed depends on how big the problem is.
  //
  // The table below fills an (n+1) x (m+1) grid of 32-bit cells, so its
  // cost is the product of the two lengths: 2,000 blocks a side is 16 MB
  // and about half a second, 10,000 is 400 MB, and 20,000 is 1.6 GB and
  // takes the tab with it. Blocks are paragraphs and table rows, so that
  // is a book or a long table rather than a report -- but the same
  // function also diffs the words of a single paragraph against each
  // other, and a paragraph of 20,000 words reaches it far sooner.
  //
  // Rather than cap the input and refuse to answer, anything past the
  // limit goes to Myers' algorithm, whose cost is driven by the number of
  // differences rather than by the size of the input. Two revisions of the
  // same long document differ in very little, so that path is fast exactly
  // when the table is unaffordable. Everything below the limit still takes
  // the table, unchanged, so the output for ordinary documents is
  // identical to what it has always been.
  var LCS_TABLE_CELL_LIMIT = 4e6; // ~16 MB of Int32Array

  // generic LCS-based diff; eq defaults to === ; ops store {type, a, b}
  function lcsDiff(a, b, eq) {
    eq =
      eq ||
      function (x, y) {
        return x === y;
      };
    if ((a.length + 1) * (b.length + 1) <= LCS_TABLE_CELL_LIMIT) {
      return lcsDiffTable(a, b, eq);
    }
    return lcsDiffLarge(a, b, eq);
  }

  function lcsDiffTable(a, b, eq) {
    var n = a.length,
      m = b.length;
    var dp = new Array(n + 1);
    for (var i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
    for (var i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = eq(a[i], b[j])
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var ops = [];
    var i = 0,
      j = 0;
    while (i < n && j < m) {
      if (eq(a[i], b[j])) {
        ops.push({ type: "equal", a: a[i], b: b[j] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: "delete", a: a[i] });
        i++;
      } else {
        ops.push({ type: "insert", b: b[j] });
        j++;
      }
    }
    while (i < n) {
      ops.push({ type: "delete", a: a[i] });
      i++;
    }
    while (j < m) {
      ops.push({ type: "insert", b: b[j] });
      j++;
    }
    return ops;
  }

  // Caps for the large path. MYERS_MAX_D bounds the memory kept for the
  // backtrack (about (D+1)^2 ints, so 16 MB at 2,000); MYERS_MAX_WORK
  // bounds the wall clock by counting comparisons, because the running
  // time depends on the input as well as on the number of differences.
  // Past either, the two sequences have so little in common that pairing
  // them up element by element says as much as an exact answer would, and
  // says it immediately.
  var MYERS_MAX_D = 2000;
  var MYERS_MAX_WORK = 2e7;

  function lcsDiffLarge(a, b, eq) {
    // Two revisions of one document usually share a long head and tail.
    // Trimming those first is what makes the middle small enough to be
    // worth an exact algorithm at all.
    var head = 0;
    var aEnd = a.length,
      bEnd = b.length;
    while (head < aEnd && head < bEnd && eq(a[head], b[head])) head++;
    while (aEnd > head && bEnd > head && eq(a[aEnd - 1], b[bEnd - 1])) {
      aEnd--;
      bEnd--;
    }

    var ops = [];
    for (var i = 0; i < head; i++) {
      ops.push({ type: "equal", a: a[i], b: b[i] });
    }

    var midA = a.slice(head, aEnd),
      midB = b.slice(head, bEnd);
    var mid = myersDiff(midA, midB, eq);
    if (mid === null) {
      // Out of budget: emit the middle as a wholesale replacement. Still
      // a correct edit script -- it reproduces both sides -- just not the
      // shortest one.
      for (var d = 0; d < midA.length; d++) {
        ops.push({ type: "delete", a: midA[d] });
      }
      for (var s = 0; s < midB.length; s++) {
        ops.push({ type: "insert", b: midB[s] });
      }
    } else {
      for (var o = 0; o < mid.length; o++) ops.push(mid[o]);
    }

    for (var t = aEnd; t < a.length; t++) {
      ops.push({ type: "equal", a: a[t], b: b[bEnd + (t - aEnd)] });
    }
    return ops;
  }

  // Myers' 1986 greedy shortest-edit-script search. It walks outwards by
  // edit distance D, keeping for each D the furthest point reached on
  // every diagonal, and stops as soon as one of them reaches the end --
  // so a pair that differs in ten places costs ten passes, whatever the
  // length of the input. Returns null if it runs past its budget.
  function myersDiff(a, b, eq) {
    var n = a.length,
      m = b.length;
    if (n === 0 || m === 0) {
      var only = [];
      for (var q = 0; q < n; q++) only.push({ type: "delete", a: a[q] });
      for (var w = 0; w < m; w++) only.push({ type: "insert", b: b[w] });
      return only;
    }

    var limit = Math.min(n + m, MYERS_MAX_D);
    var offset = limit + 1;
    var v = new Int32Array(2 * limit + 3);
    var trace = [];
    var work = 0;

    for (var d = 0; d <= limit; d++) {
      // Snapshot the diagonals reachable at this depth before extending
      // them; the backtrack replays these to recover the actual script.
      trace.push(v.slice(offset - d, offset + d + 1));
      for (var k = -d; k <= d; k += 2) {
        var x;
        if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
          x = v[offset + k + 1]; // came from above: an insertion
        } else {
          x = v[offset + k - 1] + 1; // came from the left: a deletion
        }
        var y = x - k;
        while (x < n && y < m && eq(a[x], b[y])) {
          x++;
          y++;
          work++;
        }
        work++;
        v[offset + k] = x;
        if (x >= n && y >= m) return myersBacktrack(a, b, trace, d);
        if (work > MYERS_MAX_WORK) return null;
      }
    }
    return null;
  }

  function myersBacktrack(a, b, trace, d) {
    var ops = [];
    var x = a.length,
      y = b.length;

    for (var step = d; step >= 0; step--) {
      var snap = trace[step]; // covers diagonals -step .. step at index k+step
      var k = x - y;
      var prevK;
      if (
        k === -step ||
        (k !== step && snap[k - 1 + step] < snap[k + 1 + step])
      ) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }
      var prevX = step === 0 ? 0 : snap[prevK + step];
      var prevY = prevX - prevK;

      while (x > prevX && y > prevY) {
        x--;
        y--;
        ops.push({ type: "equal", a: a[x], b: b[y] });
      }
      if (step > 0) {
        if (x === prevX) {
          y--;
          ops.push({ type: "insert", b: b[y] });
        } else {
          x--;
          ops.push({ type: "delete", a: a[x] });
        }
      }
      x = prevX;
      y = prevY;
    }

    ops.reverse();
    return ops;
  }

  function buildRows(ops) {
    var rows = [];
    var delBuf = [],
      insBuf = [];

    function flush() {
      var len = Math.max(delBuf.length, insBuf.length);
      for (var k = 0; k < len; k++) {
        var d = delBuf[k],
          ins = insBuf[k];
        if (d !== undefined && ins !== undefined) {
          var wordOps = lcsDiff(tokenizeWords(d.text), tokenizeWords(ins.text));
          rows.push({
            kind: "modified",
            left: d,
            right: ins,
            wordOps: wordOps,
          });
        } else if (d !== undefined) {
          rows.push({ kind: "removed", left: d, right: null });
        } else {
          rows.push({ kind: "added", left: null, right: ins });
        }
      }
      delBuf = [];
      insBuf = [];
    }

    ops.forEach(function (op) {
      if (op.type === "equal") {
        flush();
        var formatChanged = op.a.fmtKey !== op.b.fmtKey;
        rows.push({
          kind: formatChanged ? "format-changed" : "equal",
          left: op.a,
          right: op.b,
        });
      } else if (op.type === "delete") {
        delBuf.push(op.a);
      } else {
        insBuf.push(op.b);
      }
    });
    flush();
    return rows;
  }

  function renderImageToken(token, block) {
    if (!block || !block.imageTokens || token.charAt(0) !== "\uFFFC")
      return null;
    var seg = block.imageTokens[token];
    if (!seg) return null;
    return (
      '<span class="inline-img"><img src="' + (seg.dataUrl || "") + '"></span>'
    );
  }

  function renderFootnoteToken(token, block) {
    if (!block || !block.footnoteTokens || token.charAt(0) !== "\uFFFD")
      return null;
    var seg = block.footnoteTokens[token];
    if (!seg) return null;
    if (seg.isFootnoteRef) {
      return (
        '<sup class="fn-ref" id="' +
        escapeHtml(seg.refAnchorId) +
        '"><a class="fn-ref-link" href="#' +
        escapeHtml(seg.anchorId) +
        '" title="Jump to footnote ' +
        escapeHtml(seg.footnoteId) +
        '">' +
        escapeHtml(seg.footnoteId) +
        "</a></sup>"
      );
    }
    if (seg.isFootnoteMarker) {
      return (
        '<sup class="fn-marker" id="' +
        escapeHtml(seg.anchorId) +
        '"><a class="fn-marker-link" href="#' +
        escapeHtml(seg.backAnchorId) +
        '" title="Back to text">' +
        escapeHtml(seg.footnoteId) +
        "</a></sup>"
      );
    }
    return null;
  }

  function renderWordDiff(ops, side, leftBlock, rightBlock) {
    var html = "";
    ops.forEach(function (o) {
      if (o.type === "equal") {
        var eqImg =
          renderImageToken(o.a, leftBlock) || renderImageToken(o.a, rightBlock);
        var eqFn =
          eqImg === null
            ? renderFootnoteToken(o.a, leftBlock) ||
              renderFootnoteToken(o.a, rightBlock)
            : null;
        html += eqImg || eqFn || escapeHtml(o.a);
      } else if (o.type === "delete" && side === "left") {
        var delImg = renderImageToken(o.a, leftBlock);
        var delFn =
          delImg === null ? renderFootnoteToken(o.a, leftBlock) : null;
        if (delImg) {
          html += '<span class="del">' + delImg + "</span>";
        } else if (delFn) {
          html += '<span class="del">' + delFn + "</span>";
        } else {
          var isWs = o.a.trim() === "" && o.a.length > 0;
          html +=
            '<span class="del">' +
            (isWs ? escapeHtmlVisibleWs(o.a) : escapeHtml(o.a)) +
            "</span>";
        }
      } else if (o.type === "insert" && side === "right") {
        var insImg = renderImageToken(o.b, rightBlock);
        var insFn =
          insImg === null ? renderFootnoteToken(o.b, rightBlock) : null;
        if (insImg) {
          html += '<span class="ins">' + insImg + "</span>";
        } else if (insFn) {
          html += '<span class="ins">' + insFn + "</span>";
        } else {
          var isWs2 = o.b.trim() === "" && o.b.length > 0;
          html +=
            '<span class="ins">' +
            (isWs2 ? escapeHtmlVisibleWs(o.b) : escapeHtml(o.b)) +
            "</span>";
        }
      }
    });
    return html;
  }

  function sectionBadge(block) {
    if (
      !block ||
      !block.sectionLabel ||
      block.sectionLabel === "body" ||
      block.sectionLabel === "divider"
    )
      return "";
    return (
      '<span class="sec-badge">' + escapeHtml(block.sectionLabel) + "</span>"
    );
  }

  function wrapBlockContent(block, innerHtml) {
    if (!block) return innerHtml;
    if (block.isDivider)
      return '<div class="block-divider">' + innerHtml + "</div>";
    if (block.isTableRow) return innerHtml;
    if (block.isHeading)
      return (
        '<div class="block-heading h' +
        block.headingLevel +
        '">' +
        innerHtml +
        "</div>"
      );
    if (block.isListItem) {
      var bullet =
        block.ilvl >= 2 ? "\u25aa" : block.ilvl === 1 ? "\u25e6" : "\u2022";
      return (
        '<div class="block-li"><span class="li-bullet" style="margin-left:' +
        block.ilvl * 18 +
        'px;">' +
        bullet +
        '</span><span class="li-text">' +
        innerHtml +
        "</span></div>"
      );
    }
    return '<div class="block-p">' + innerHtml + "</div>";
  }

  function renderCellForSide(
    block,
    kind,
    side,
    wordOps,
    leftBlock,
    rightBlock,
  ) {
    if (!block) return '<div class="cell gap"></div>';
    var badge = sectionBadge(block);
    var innerHtml, cellClass;
    if (kind === "modified") {
      innerHtml = badge + renderWordDiff(wordOps, side, leftBlock, rightBlock);
      cellClass = "cell modified";
    } else if (kind === "removed") {
      innerHtml = badge + block.html;
      cellClass = "cell removed";
    } else if (kind === "added") {
      innerHtml = badge + block.html;
      cellClass = "cell added";
    } else if (kind === "format-changed") {
      innerHtml =
        badge + block.html + '<span class="fmt-tag">formatting changed</span>';
      cellClass = "cell fmt-changed";
    } else {
      innerHtml = badge + block.html;
      cellClass = "cell";
    }
    return (
      '<div class="' +
      cellClass +
      '">' +
      wrapBlockContent(block, innerHtml) +
      "</div>"
    );
  }

  function renderBlockPreview(block) {
    return wrapBlockContent(block, sectionBadge(block) + block.html);
  }

  // ============================== UI ==============================
  //
  // The page is a Windows 95 desktop with one DiffPad window per document.
  // The desktop, taskbar, Start menu and About box are static markup in
  // index.html; each window -- title bar, menu bar, page and status bar -- is
  // drawn here on every render.

  var ROLE = { left: "Original", right: "Updated" };

  // Which window has the navy title bar. Win95 shows exactly one active
  // window; clicking a window or its taskbar button moves it.
  var activeSide = "left";

  var ICON_DIFFPAD =
    '<svg class="icon16" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">' +
    '<path d="M2.5 1.5h8l3 3v10h-11z" fill="#fff" stroke="#000"/>' +
    '<path d="M10.5 1.5v3h3" fill="#c0c0c0" stroke="#000"/>' +
    '<path d="M4 6.5h8M4 8.5h8M4 10.5h8M4 12.5h6" stroke="#000080"/></svg>';

  var ICON_SWAP =
    '<svg viewBox="0 0 12 10" shape-rendering="crispEdges" aria-hidden="true">' +
    '<path d="M0 2h9V0h1v1h1v1h1v1h-1v1h-1v1H9V3H0z"/>' +
    '<path d="M12 7H3V5H2v1H1v1H0v1h1v1h1v1h1V8h9z"/></svg>';

  var ICON_DOC_BIG =
    '<svg class="icon32" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">' +
    '<path d="M6.5 2.5h14l6 6v21h-20z" fill="#fff" stroke="#000"/>' +
    '<path d="M20.5 2.5v6h6" fill="#c0c0c0" stroke="#000"/>' +
    '<path d="M9 12.5h14M9 15.5h14M9 18.5h14M9 21.5h14M9 24.5h9" stroke="#000080"/></svg>';

  function windowTitle(side) {
    var doc = state[side];
    return (doc ? escapeHtml(doc.fileName) : "Untitled") + " - DiffPad";
  }

  function swapButtonHtml(enabled) {
    return (
      '<button class="title-btn swap-btn" title="Swap original and updated" aria-label="Swap original and updated"' +
      (enabled ? "" : " disabled") +
      ">" +
      ICON_SWAP +
      "</button>"
    );
  }

  function menuItemHtml(action, label, side, enabled) {
    return (
      '<button class="menu-item" role="menuitem" data-action="' +
      action +
      '" data-for="' +
      side +
      '"' +
      (enabled ? "" : " disabled") +
      ">" +
      label +
      "</button>"
    );
  }

  function menuHtml(label, items) {
    return (
      '<div class="menu">' +
      '<button class="menu-title" aria-haspopup="true">' +
      label +
      "</button>" +
      '<div class="menu-list" role="menu">' +
      items
        .map(function (it) {
          return it === "-" ? '<div class="menu-sep"></div>' : it;
        })
        .join("") +
      "</div></div>"
    );
  }

  // Notepad's bare menu bar: no toolbar, no format bar, no ruler.
  function menuBarHtml(side) {
    var ready = !!(state.left && state.right);
    return (
      '<div class="menubar" role="menubar">' +
      menuHtml("<u>F</u>ile", [
        menuItemHtml("open", "<u>O</u>pen…", side, true),
        menuItemHtml("close", "<u>C</u>lose", side, !!state[side]),
        "-",
        menuItemHtml("export", "<u>E</u>xport diff…", side, ready),
      ]) +
      menuHtml("<u>H</u>elp", [
        menuItemHtml("about", "<u>A</u>bout docxDiff", side, true),
      ]) +
      "</div>"
    );
  }

  function statusBarHtml(side) {
    var other = side === "left" ? "right" : "left";
    if (state.left && state.right) {
      return side === "left"
        ? '<span class="sb-main"><i class="swatch removed"></i><span id="removed-count">0</span> removed</span>' +
            '<span class="sb-cell">' +
            ROLE[side] +
            "</span>"
        : '<span class="sb-main"><i class="swatch added"></i><span id="added-count">0</span> added or changed' +
            '<i class="swatch fmt"></i><span id="fmt-count">0</span> formatting only</span>' +
            '<span class="sb-cell">' +
            ROLE[side] +
            "</span>";
    }
    var text = state[side]
      ? "Waiting for the " + ROLE[other].toLowerCase() + " document"
      : "For Help, press F1";
    return (
      '<span class="sb-main">' +
      text +
      "</span>" +
      '<span class="sb-cell">' +
      ROLE[side] +
      "</span>"
    );
  }

  // A loaded window has no dropzone, so a file opened into it from the File
  // menu reports its progress and its errors here instead.
  function windowMessagesHtml() {
    return (
      '<div class="dz-loading win-loading" style="display:none;"><span class="progress"></span>Reading document…</div>' +
      '<div class="dz-error" style="display:none;"></div>'
    );
  }

  function windowHtml(side, pageHtml) {
    return (
      '<section class="window' +
      (side === activeSide ? "" : " inactive") +
      '" data-win="' +
      side +
      '">' +
      '<div class="titlebar">' +
      ICON_DIFFPAD +
      '<span class="title-text">' +
      windowTitle(side) +
      "</span>" +
      swapButtonHtml(!!(state.left || state.right)) +
      "</div>" +
      menuBarHtml(side) +
      '<div class="page">' +
      pageHtml +
      "</div>" +
      '<div class="statusbar">' +
      statusBarHtml(side) +
      "</div>" +
      (state[side] ? windowMessagesHtml() : "") +
      "</section>"
    );
  }

  function renderTasks() {
    var tasks = document.getElementById("tasks");
    if (!tasks) return;
    tasks.innerHTML = ["left", "right"]
      .map(function (side) {
        var name = state[side] ? escapeHtml(state[side].fileName) : "Untitled";
        return (
          '<button class="task' +
          (side === activeSide ? " on" : "") +
          '" data-task="' +
          side +
          '" title="' +
          ROLE[side] +
          '">' +
          ICON_DIFFPAD +
          '<span class="task-text">' +
          name +
          " - DiffPad</span></button>"
        );
      })
      .join("");
  }

  function setActive(side) {
    if (side !== "left" && side !== "right") return;
    activeSide = side;
    if (!app.querySelectorAll) return;
    app.querySelectorAll(".window").forEach(function (w) {
      w.classList.toggle("inactive", w.getAttribute("data-win") !== side);
    });
    var tasks = document.getElementById("tasks");
    if (tasks && tasks.querySelectorAll) {
      tasks.querySelectorAll(".task").forEach(function (t) {
        t.classList.toggle("on", t.getAttribute("data-task") === side);
      });
    }
  }

  function setMode() {
    var ready = !!(state.left && state.right);
    document.body.classList.toggle("mode-setup", !ready);
    document.body.classList.toggle("mode-diff", ready);
  }

  // Start over lives in the taskbar's Start menu, outside the windows.
  function updateGlobalCommands() {
    if (resetBtn) resetBtn.disabled = !(state.left || state.right);
  }

  function renderSetup() {
    setMode();

    function pageFor(side) {
      if (!state[side]) return dropzoneHtml(side);
      return (
        '<div class="page-scroll"><div class="doc-preview">' +
        state[side].blocks.map(renderBlockPreview).join("") +
        "</div></div>"
      );
    }

    app.innerHTML =
      '<div class="desk">' +
      '<div class="frames">' +
      windowHtml("left", pageFor("left")) +
      windowHtml("right", pageFor("right")) +
      "</div></div>";
    wireDropzones();
  }

  function dropzoneHtml(side) {
    var label = side === "left" ? "original" : "updated";
    return (
      '<div class="dropzone" data-side="' +
      side +
      '">' +
      ICON_DOC_BIG +
      '<p class="dz-title">Drag a .docx here or click to browse</p>' +
      '<p class="dz-sub">Open the ' +
      label +
      " document</p>" +
      '<span class="btn95 dz-open"><span class="focus-ring">Open…</span></span>' +
      '<div class="dz-loading" style="display:none;"><span class="progress"></span>Reading document…</div>' +
      '<div class="dz-error" style="display:none;"></div>' +
      "</div>"
    );
  }

  function wireDropzones() {
    document.querySelectorAll(".dropzone").forEach(function (dz) {
      var side = dz.getAttribute("data-side");
      var input = side === "left" ? inputLeft : inputRight;

      dz.addEventListener("click", function (e) {
        // The error box sits inside the dropzone. Clicking it dismisses it
        // rather than opening the picker again underneath.
        if (
          e &&
          e.target &&
          e.target.closest &&
          e.target.closest(".dz-error")
        ) {
          hideError(dz);
          return;
        }
        input.click();
      });
      dz.addEventListener("dragover", function (e) {
        e.preventDefault();
        dz.classList.add("drag");
      });
      dz.addEventListener("dragleave", function () {
        dz.classList.remove("drag");
      });
      dz.addEventListener("drop", function (e) {
        e.preventDefault();
        dz.classList.remove("drag");
        if (e.dataTransfer.files && e.dataTransfer.files[0])
          handleFile(side, e.dataTransfer.files[0], dz);
      });
    });

    // Both routes into handleFile have to name the place they came from,
    // because that is the only place an error is shown. Choosing a file
    // through the picker used to pass nothing, so showDropzoneError returned
    // at its first line and a wrong file type or an unreadable document
    // produced no message, no spinner and no change on screen at all -- the
    // click simply did nothing.
    inputLeft.onchange = function () {
      if (inputLeft.files[0])
        handleFile("left", inputLeft.files[0], messageHostFor("left"));
      inputLeft.value = "";
    };
    inputRight.onchange = function () {
      if (inputRight.files[0])
        handleFile("right", inputRight.files[0], messageHostFor("right"));
      inputRight.value = "";
    };
  }

  function dropzoneFor(side) {
    return document.querySelector('.dropzone[data-side="' + side + '"]');
  }

  // An empty side shows progress and errors on its dropzone; a loaded side,
  // replaced through File > Open, shows them on its window.
  function messageHostFor(side) {
    return (
      dropzoneFor(side) ||
      document.querySelector('.window[data-win="' + side + '"]')
    );
  }

  function hideError(host) {
    host.classList.remove("error");
    var err = host.querySelector(".dz-error");
    if (err) err.style.display = "none";
  }

  function showDropzoneError(dz, message) {
    if (!dz) return;
    dz.classList.remove("drag");
    var loading = dz.querySelector(".dz-loading");
    if (loading) loading.style.display = "none";
    dz.classList.add("error");
    var err = dz.querySelector(".dz-error");
    err.style.display = "block";
    err.textContent = message;
  }

  function handleFile(side, file, dzEl) {
    // .docm is the same package with macros allowed in it. Nothing here
    // runs them -- only word/document.xml and its relations are read --
    // so refusing the extension refused a document this tool can compare
    // perfectly well.
    if (!/\.doc[xm]$/i.test(file.name)) {
      showDropzoneError(dzEl, "Please upload a .docx file.");
      return;
    }
    if (dzEl) {
      var loading = dzEl.querySelector(".dz-loading");
      if (loading) loading.style.display = "block";
      dzEl.classList.remove("error");
      var err = dzEl.querySelector(".dz-error");
      if (err) err.style.display = "none";
    }
    extractDocxStructured(file)
      .then(function (blocks) {
        state[side] = { fileName: file.name, blocks: blocks };
        renderApp();
      })
      .catch(function (err) {
        console.error(err);
        showDropzoneError(
          dzEl,
          "Could not read that file. Is it a valid Word document?",
        );
      });
  }

  function renderDiff() {
    var ops = lcsDiff(state.left.blocks, state.right.blocks, function (x, y) {
      return x.text === y.text;
    });
    var rows = buildRows(ops);

    var removedCount = 0,
      addedCount = 0,
      fmtCount = 0;
    rows.forEach(function (r) {
      if (r.kind === "removed" || r.kind === "modified") removedCount++;
      if (r.kind === "added" || r.kind === "modified") addedCount++;
      if (r.kind === "format-changed") fmtCount++;
    });

    var gridHtml = rows
      .map(function (r) {
        return (
          renderCellForSide(
            r.left,
            r.kind,
            "left",
            r.wordOps,
            r.left,
            r.right,
          ) +
          renderCellForSide(
            r.right,
            r.kind,
            "right",
            r.wordOps,
            r.left,
            r.right,
          )
        );
      })
      .join("");

    lastDiffHtml = gridHtml;

    // The two windows are drawn empty, and the diff lies over both of their
    // pages in a single scroller: one grid in one scroller is what keeps a
    // row's two sides level. The grid's column gap spans the inner edge of
    // the Original window, the desktop between the windows and the outer
    // edge of the Updated one, and is transparent, so the window frames show
    // through it.
    app.innerHTML =
      '<div class="desk diff-wrap">' +
      '<div class="frames">' +
      windowHtml("left", "") +
      windowHtml("right", "") +
      "</div>" +
      '<div class="diff-scroll"><div class="diff-grid">' +
      gridHtml +
      "</div></div>" +
      "</div>";

    mountOriginalScrollbar();

    document.getElementById("removed-count").textContent = removedCount;
    document.getElementById("added-count").textContent = addedCount;
    document.getElementById("fmt-count").textContent = fmtCount;
  }

  // The diff's scroller has one scrollbar, inside the Updated window's page.
  // This puts a second one inside the Original window's page: an empty track
  // with the diff's scroll range, kept in step with the diff both ways.
  var originalScrollbarObserver = null;

  function unmountOriginalScrollbar() {
    if (originalScrollbarObserver) originalScrollbarObserver.disconnect();
    originalScrollbarObserver = null;
  }

  function mountOriginalScrollbar() {
    unmountOriginalScrollbar();
    var wrap = app.querySelector(".diff-wrap");
    var scroller = app.querySelector(".diff-scroll");
    var grid = app.querySelector(".diff-grid");
    if (!wrap || !scroller || !grid || !wrap.appendChild) return;

    var bar = document.createElement("div");
    bar.className = "diff-scrollbar-left";
    bar.setAttribute("aria-hidden", "true");
    var track = document.createElement("div");
    // The scrollbar takes the bar's whole width, and a track left with no
    // width of its own does not count as overflow, so nothing would scroll.
    track.style.width = "1px";
    bar.appendChild(track);
    wrap.appendChild(bar);

    function layout() {
      // The grid leaves room for a scrollbar at the inner edge of the
      // Original page. An overlay scrollbar measures zero; it still needs
      // room to appear.
      var width = Math.max(scroller.offsetWidth - scroller.clientWidth, 12);
      wrap.style.setProperty("--sbw", width + "px");
      var firstCell = grid.firstElementChild;
      var wrapRect = wrap.getBoundingClientRect();
      var scrollerRect = scroller.getBoundingClientRect();
      bar.style.left =
        (firstCell
          ? firstCell.getBoundingClientRect().right
          : scrollerRect.left) -
        wrapRect.left +
        "px";
      bar.style.top = scrollerRect.top - wrapRect.top + "px";
      bar.style.width = width + "px";
      bar.style.height = scroller.clientHeight + "px";
      track.style.height = scroller.scrollHeight + "px";
      bar.scrollTop = scroller.scrollTop;
    }

    // Each side copies the other's position. The copy raises a scroll
    // event of its own, which is recognised and dropped: echoing it back
    // would pull a smooth scroll, still under way, back to where it was a
    // frame ago.
    var echo = [null, null];
    function follow(from, to, self, other) {
      from.addEventListener("scroll", function () {
        var expected = echo[self];
        echo[self] = null;
        if (expected !== null && Math.abs(from.scrollTop - expected) < 1)
          return;
        if (Math.abs(to.scrollTop - from.scrollTop) < 1) return;
        echo[other] = from.scrollTop;
        to.scrollTop = from.scrollTop;
      });
    }
    follow(scroller, bar, 0, 1);
    follow(bar, scroller, 1, 0);

    layout();
    if (typeof ResizeObserver === "function") {
      originalScrollbarObserver = new ResizeObserver(layout);
      originalScrollbarObserver.observe(scroller);
      originalScrollbarObserver.observe(grid);
    }
  }

  function renderApp() {
    unmountOriginalScrollbar();
    closeMenus();
    setMode();
    if (state.left && state.right) {
      renderDiff();
    } else {
      renderSetup();
    }
    updateGlobalCommands();
    renderTasks();
  }

  // ------------------------------------------------ menus and commands

  // The Start menu and the game windows belong to js/desktop.js; this file
  // looks after the two DiffPad windows and the About box.
  var aboutBox = document.getElementById("about");

  function closeMenus() {
    if (app.querySelectorAll) {
      app.querySelectorAll(".menu.open").forEach(function (m) {
        m.classList.remove("open");
      });
    }
  }

  function anyMenuOpen() {
    return !!(app.querySelector && app.querySelector(".menu.open"));
  }

  function showAbout() {
    closeMenus();
    if (!aboutBox) return;
    aboutBox.hidden = false;
    var ok = aboutBox.querySelector("button");
    if (ok) ok.focus();
  }

  function hideAbout() {
    if (aboutBox) aboutBox.hidden = true;
  }

  function startOver() {
    state = { left: null, right: null };
    renderApp();
  }

  function exportDiff() {
    if (!lastDiffHtml) return;
    var doc =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>docxDiff export</title><style>' +
      "body{font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;margin:0;padding:24px;background:#fafaf8;color:#1a1a18;}" +
      ".diff-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);border:1px solid #e3e1d9;border-radius:8px;overflow:hidden;background:#fff;}" +
      ".cell{padding:9px 20px;border-bottom:1px solid #e3e1d9;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;min-width:0;}" +
      ".cell:nth-child(2n){border-left:1px solid #e3e1d9;}" +
      ".cell.removed{background:#faece7;}.cell.removed .block-p,.cell.removed .block-li,.cell.removed .block-heading{color:#7a2c11;text-decoration:line-through;}" +
      ".cell.added{background:#e1f5ee;}.cell.added .block-p,.cell.added .block-li,.cell.added .block-heading{color:#0b5544;}" +
      ".cell.fmt-changed{background:#fdf7e6;box-shadow:inset 3px 0 0 #e8c766;}" +
      ".del{background:#faece7;color:#7a2c11;text-decoration:line-through;border-radius:3px;padding:0 2px;}" +
      ".ins{background:#e1f5ee;color:#0b5544;border-radius:3px;padding:0 2px;}" +
      ".ws-dot{opacity:.6;}" +
      ".block-heading{font-weight:600;}.block-heading.h1{font-size:17px;}.block-heading.h2{font-size:15px;}" +
      ".block-li{display:flex;gap:7px;}.block-divider{text-align:center;color:#9a9990;font-size:10.5px;letter-spacing:.06em;}" +
      ".row-cells{display:flex;margin:0 -20px;}.row-cell{flex:1;min-width:0;padding:0 12px;border-right:1px dashed #e3e1d9;}.row-cell:first-child{padding-left:20px;}.row-cell:last-child{border-right:none;padding-right:20px;}" +
      ".sec-badge{display:inline-block;font-size:9.5px;font-weight:600;text-transform:uppercase;background:#f4f3ee;color:#9a9990;border:1px solid #cfcdc2;border-radius:4px;padding:1px 5px;margin-right:7px;}" +
      ".fmt-tag{display:inline-block;margin-left:8px;font-size:10px;font-weight:600;text-transform:uppercase;color:#8a6d1a;background:#fbf0d2;border-radius:4px;padding:1px 6px;}" +
      ".inline-img img{max-height:60px;max-width:170px;border:1px solid #cfcdc2;border-radius:4px;vertical-align:middle;}" +
      ".trk-ins{text-decoration:underline wavy #1d9e75;}.trk-del{text-decoration:line-through;color:#8a4634;opacity:.85;}" +
      ".doc-link{color:#3c3489;text-decoration:underline;}" +
      '</style></head><body><h2 style="font-weight:500;">' +
      escapeHtml(state.left.fileName) +
      " &rarr; " +
      escapeHtml(state.right.fileName) +
      "</h2>" +
      '<div class="diff-grid">' +
      lastDiffHtml +
      "</div></body></html>";
    var blob = new Blob([doc], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "docxdiff-export.html";
    // The anchor has to be in the document for the click to count in
    // Firefox, and the object URL has to outlive the click: revoking it
    // on the next line races the download the click has only just
    // started, and the browser may find the blob already gone.
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function runAction(action, side) {
    closeMenus();
    if (action === "open") {
      (side === "right" ? inputRight : inputLeft).click();
    } else if (action === "close") {
      state[side] = null;
      renderApp();
    } else if (action === "export") {
      exportDiff();
    } else if (action === "reset") {
      startOver();
    } else if (action === "about") {
      showAbout();
    }
  }

  // Everything inside the windows is redrawn on each render, so their clicks
  // are handled once, here, rather than wired to each new element.
  app.addEventListener("click", function (e) {
    var t = e && e.target && e.target.closest ? e.target : null;
    if (!t) return;

    var swap = t.closest(".swap-btn");
    if (swap) {
      if (swap.disabled) return;
      var tmp = state.left;
      state.left = state.right;
      state.right = tmp;
      renderApp();
      return;
    }

    var title = t.closest(".menu-title");
    if (title) {
      var menu = title.parentNode;
      var wasOpen = menu.classList.contains("open");
      closeMenus();
      if (!wasOpen) menu.classList.add("open");
      return;
    }

    var item = t.closest(".menu-item");
    if (item) {
      if (!item.disabled)
        runAction(
          item.getAttribute("data-action"),
          item.getAttribute("data-for"),
        );
      return;
    }

    var err = t.closest(".window > .dz-error");
    if (err) hideError(err.parentNode);
  });

  // Win95 menus follow the pointer from one title to the next once one of
  // them is open.
  app.addEventListener("mouseover", function (e) {
    var t = e && e.target && e.target.closest ? e.target : null;
    var title = t && t.closest(".menu-title");
    if (!title || !anyMenuOpen()) return;
    var menu = title.parentNode;
    if (menu.classList.contains("open")) return;
    closeMenus();
    menu.classList.add("open");
  });

  // Clicking anywhere in a window makes it the active one. In the diff the
  // pages lie under the shared scroller, so the side is read from where the
  // click landed rather than from the element it landed on.
  app.addEventListener("mousedown", function (e) {
    if (!app.getBoundingClientRect || typeof e.clientX !== "number") return;
    var r = app.getBoundingClientRect();
    setActive(e.clientX < r.left + r.width / 2 ? "left" : "right");
  });

  if (document.addEventListener) {
    document.addEventListener("mousedown", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("#app .menu")) return;
      closeMenus();
    });
    document.addEventListener("keydown", function (e) {
      // While a game window is the active one, the keyboard is the game's.
      if (document.body.classList.contains("game-focus")) return;
      if (e.key === "Escape") {
        closeMenus();
        hideAbout();
      } else if (e.key === "F1") {
        e.preventDefault();
        showAbout();
      }
    });
  }

  var tasksEl = document.getElementById("tasks");
  if (tasksEl) {
    tasksEl.addEventListener("click", function (e) {
      var task = e.target && e.target.closest && e.target.closest(".task");
      if (task) setActive(task.getAttribute("data-task"));
    });
  }

  if (aboutBox) {
    aboutBox.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest("[data-close]"))
        hideAbout();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      closeMenus();
      startOver();
    });
  }

  renderApp();
})();
