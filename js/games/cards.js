/*
 * Playing cards for Solitaire, FreeCell and Hearts: the deck, the shuffle,
 * card faces drawn as SVG at the classic 71 x 96 pixels, card backs, and
 * drag-and-drop with the mouse or a finger.
 *
 * A card is { rank: 1..13, suit: "C" | "D" | "H" | "S" }.
 */
(function () {
  "use strict";

  var Win95 = (window.Win95 = window.Win95 || {});

  var W = 71;
  var H = 96;
  var RED = "#d40000";
  var SUITS = ["C", "D", "H", "S"];
  var RANKS = [null, "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  var RANK_NAMES = [null, "Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King"];
  var SUIT_NAMES = { C: "Clubs", D: "Diamonds", H: "Hearts", S: "Spades" };

  // Each suit drawn in a 100 x 100 box.
  var SUIT_PATH = {
    H: "M50 92C30 72 4 54 4 30 4 13 16 4 28 4c10 0 18 6 22 16C54 10 62 4 72 4c12 0 24 9 24 26 0 24-26 42-46 62z",
    D: "M50 2L88 50 50 98 12 50z",
    S: "M50 2C62 24 94 40 94 64c0 14-10 23-22 23-8 0-14-4-18-10 1 9 5 16 12 21H34c7-5 11-12 12-21-4 6-10 10-18 10C16 87 6 78 6 64 6 40 38 24 50 2z",
    C:
      "M50 4a21 21 0 1 1 0 42 21 21 0 1 1 0-42z" +
      "M27 38a21 21 0 1 1 0 42 21 21 0 1 1 0-42z" +
      "M73 38a21 21 0 1 1 0 42 21 21 0 1 1 0-42z" +
      "M38 36h24l-6 24H44z" +
      "M46 56h8c0 18 4 30 14 40H32c10-10 14-22 14-40z",
  };

  function isRed(suit) {
    return suit === "H" || suit === "D";
  }

  function newDeck() {
    var deck = [];
    SUITS.forEach(function (suit) {
      for (var r = 1; r <= 13; r++) deck.push({ rank: r, suit: suit });
    });
    return deck;
  }

  // Fisher-Yates. `rand` returns a float in [0, 1); Math.random by default.
  function shuffle(arr, rand) {
    rand = rand || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function name(card) {
    return RANK_NAMES[card.rank] + " of " + SUIT_NAMES[card.suit];
  }

  function key(card) {
    return card.suit + card.rank;
  }

  // ---------------------------------------------------------------- faces

  function pip(suit, cx, cy, size, flip, fill) {
    var t =
      (flip ? "rotate(180 " + cx + " " + cy + ") " : "") +
      "translate(" + (cx - size / 2) + " " + (cy - size / 2) + ") scale(" + size / 100 + ")";
    return '<path d="' + SUIT_PATH[suit] + '" transform="' + t + '" fill="' + fill + '"/>';
  }

  var L = 21, C = 35.5, R = 50;
  var PIPS = {
    2: [[C, 17], [C, 79]],
    3: [[C, 17], [C, 48], [C, 79]],
    4: [[L, 17], [R, 17], [L, 79], [R, 79]],
    5: [[L, 17], [R, 17], [C, 48], [L, 79], [R, 79]],
    6: [[L, 17], [R, 17], [L, 48], [R, 48], [L, 79], [R, 79]],
    7: [[L, 17], [R, 17], [C, 32.5], [L, 48], [R, 48], [L, 79], [R, 79]],
    8: [[L, 17], [R, 17], [C, 32.5], [L, 48], [R, 48], [C, 63.5], [L, 79], [R, 79]],
    9: [[L, 17], [R, 17], [L, 37.7], [R, 37.7], [C, 48], [L, 58.3], [R, 58.3], [L, 79], [R, 79]],
    10: [[L, 17], [R, 17], [C, 27.3], [L, 37.7], [R, 37.7], [L, 58.3], [R, 58.3], [C, 68.7], [L, 79], [R, 79]],
  };

  // Court colours in the cards.dll spirit: a robe, a trim, and gold.
  var ROBE = { H: RED, D: "#e8b400", C: "#0040c0", S: "#202020" };
  var TRIM = { H: "#e8b400", D: RED, C: "#e8b400", S: "#e8b400" };

  function courtHalf(card) {
    var robe = ROBE[card.suit];
    var trim = TRIM[card.suit];
    var s = 'stroke="#000" stroke-width="0.6"';
    var out = [];
    // Robe and shoulders.
    out.push('<path d="M13 48V39q10-9 22.5-8 12.5-1 22.5 8v9z" fill="' + robe + '" ' + s + "/>");
    out.push('<path d="M32 31h7v17h-7z" fill="' + trim + '" ' + s + "/>");
    out.push('<path d="M26 33q9.5 7 19 0" fill="none" stroke="' + trim + '" stroke-width="2"/>');
    // Hair, behind the head.
    if (card.rank === 12) {
      out.push('<path d="M27 20q-3 10 1 15h15q4-5 1-15z" fill="#e8b400" ' + s + "/>");
    } else if (card.rank === 11) {
      out.push('<path d="M28 20q-2 6 1 9h13q3-3 1-9z" fill="#8a4a10" ' + s + "/>");
    }
    // Head and face.
    out.push('<ellipse cx="35.5" cy="24" rx="6" ry="7" fill="#ffd8a8" ' + s + "/>");
    out.push('<path d="M33 23h1M37 23h1" stroke="#000" stroke-width="1.2"/>');
    out.push('<path d="M34 28h3" stroke="' + RED + '" stroke-width="0.9"/>');
    if (card.rank === 13) {
      // Beard, and a tall crown.
      out.push('<path d="M29.5 26q6 11 12 0q-2 3-6 3t-6-3z" fill="#f4f4f4" ' + s + "/>");
      out.push('<path d="M28 18v-8l3.5 4 4-6 4 6 3.5-4v8z" fill="#e8b400" ' + s + "/>");
      out.push('<path d="M31 16h1.5M35 15h1.5M39 16h1.5" stroke="' + RED + '" stroke-width="1.5"/>');
      // A sword over the shoulder.
      out.push('<path d="M50 46L52 14" stroke="#808080" stroke-width="2"/><path d="M48 18h7" stroke="#000" stroke-width="1.5"/>');
    } else if (card.rank === 12) {
      out.push('<path d="M29 18v-5l3 3 3.5-5 3.5 5 3-3v5z" fill="#e8b400" ' + s + "/>");
      out.push('<path d="M34.8 14.5h1.4" stroke="#0040c0" stroke-width="1.6"/>');
      // A flower.
      out.push('<path d="M20 46L22 33" stroke="#008000" stroke-width="1.2"/><circle cx="22" cy="31" r="3" fill="' + RED + '" ' + s + "/>");
    } else {
      // A cap with a feather.
      out.push('<path d="M28.5 19q7-11 14 0z" fill="' + robe + '" ' + s + "/>");
      out.push('<path d="M41 13q6-6 9-1" fill="none" stroke="' + trim + '" stroke-width="1.6"/>');
      out.push('<path d="M51 46L49 30" stroke="#8a4a10" stroke-width="2"/>');
    }
    out.push(pip(card.suit, 18.5, 15, 8, false, isRed(card.suit) ? RED : "#000"));
    return out.join("");
  }

  var faceCache = {};

  function faceSVG(card) {
    var k = key(card);
    if (faceCache[k]) return faceCache[k];
    var fill = isRed(card.suit) ? RED : "#000";
    var label = RANKS[card.rank];
    var index =
      '<text x="7.5" y="12.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="' +
      (label === "10" ? 10 : 12) +
      '"' +
      (label === "10" ? ' letter-spacing="-1"' : "") +
      ' fill="' +
      fill +
      '">' +
      label +
      "</text>" +
      pip(card.suit, 7.5, 20, 9, false, fill);
    var out = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 71 96" width="71" height="96">',
      '<rect x="0.5" y="0.5" width="70" height="95" rx="3" fill="#fff" stroke="#000"/>',
      index,
      '<g transform="rotate(180 35.5 48)">' + index + "</g>",
    ];
    if (card.rank === 1) {
      out.push(pip(card.suit, C, 48, card.suit === "S" ? 38 : 24, false, fill));
    } else if (card.rank <= 10) {
      PIPS[card.rank].forEach(function (p) {
        out.push(pip(card.suit, p[0], p[1], 14, p[1] > 48, fill));
      });
    } else {
      var half = courtHalf(card);
      out.push('<rect x="12.5" y="9.5" width="46" height="77" fill="#fff"/>');
      out.push('<svg x="12.5" y="9.5" width="46" height="38.5" viewBox="12.5 9.5 46 38.5">' + half + "</svg>");
      out.push(
        '<g transform="rotate(180 35.5 48)"><svg x="12.5" y="9.5" width="46" height="38.5" viewBox="12.5 9.5 46 38.5">' +
          half +
          "</svg></g>",
      );
      out.push('<rect x="12.5" y="9.5" width="46" height="77" fill="none" stroke="#000"/>');
      out.push('<path d="M12.5 48h46" stroke="#000" stroke-width="0.6"/>');
    }
    out.push("</svg>");
    faceCache[k] = out.join("");
    return faceCache[k];
  }

  // ---------------------------------------------------------------- backs

  var BACKS = [
    { id: "weave", name: "Blue weave" },
    { id: "weave-red", name: "Red weave" },
    { id: "fish", name: "Fish" },
    { id: "castle", name: "Castle" },
    { id: "roses", name: "Roses" },
    { id: "shell", name: "Shells" },
  ];

  var BACK_ART = {
    fish:
      '<svg viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M0 22q8-4 16 0t16 0 16 0 16 0M0 50q8-4 16 0t16 0 16 0 16 0M0 76q8-4 16 0t16 0 16 0 16 0" fill="none" stroke="#60a0ff" stroke-width="1.5"/>' +
      '<path d="M10 36q10-10 24 0-14 10-24 0z" fill="#ffb000" stroke="#000" stroke-width=".8"/><path d="M34 36l7-5v10z" fill="#ffb000" stroke="#000" stroke-width=".8"/><circle cx="15" cy="34.5" r="1.3"/>' +
      '<path d="M50 62q-9-8-20 0 11 8 20 0z" fill="#ff6060" stroke="#000" stroke-width=".8"/><path d="M30 62l-6-4v8z" fill="#ff6060" stroke="#000" stroke-width=".8"/><circle cx="45" cy="60.6" r="1.2"/>' +
      '<circle cx="44" cy="22" r="2" fill="none" stroke="#fff"/><circle cx="47" cy="15" r="1.4" fill="none" stroke="#fff"/></svg>',
    castle:
      '<svg viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true">' +
      '<circle cx="48" cy="16" r="7" fill="#ffffc0"/>' +
      '<path d="M8 88V44h5v-5h4v5h5v-5h4v5h5V30h4v-5h4v5h4v-5h4v5h4v14h5v-5h4v5h5v44z" fill="#909090" stroke="#000" stroke-width=".8"/>' +
      '<path d="M27 88V70q4-6 9 0v18zM16 56h3v5h-3zM44 56h3v5h-3zM34 38h3v5h-3z" fill="#000"/>' +
      '<path d="M0 88h63v-6H0z" fill="#008000"/></svg>',
    roses:
      '<svg viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true">' +
      '<g fill="#e00000" stroke="#600" stroke-width=".6">' +
      '<circle cx="16" cy="18" r="6"/><circle cx="47" cy="18" r="6"/><circle cx="31.5" cy="44" r="8"/><circle cx="16" cy="70" r="6"/><circle cx="47" cy="70" r="6"/></g>' +
      '<g fill="none" stroke="#600" stroke-width=".7"><path d="M13 18q3-4 6 0M44 18q3-4 6 0M27 44q4-6 9 0M13 70q3-4 6 0M44 70q3-4 6 0"/></g>' +
      '<g fill="#008000"><path d="M22 22l6 4-7 1zM41 22l-6 4 7 1zM22 66l6-4-7-1zM41 66l-6-4 7-1z"/></g></svg>',
    shell:
      '<svg viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true">' +
      '<g fill="#ffd0a0" stroke="#804000" stroke-width=".8">' +
      '<path d="M8 30q12-24 24 0z"/><path d="M31 58q12-24 24 0z"/><path d="M8 84q12-24 24 0z"/></g>' +
      '<g stroke="#804000" stroke-width=".6"><path d="M20 30l-8-7M20 30l-3-10M20 30l3-10M20 30l8-7M43 58l-8-7M43 58l-3-10M43 58l3-10M43 58l8-7M20 84l-8-7M20 84l-3-10M20 84l3-10M20 84l8-7"/></g></svg>',
  };

  function backHTML(design) {
    return '<div class="cb cb-' + design + '">' + (BACK_ART[design] || "") + "</div>";
  }

  // ---------------------------------------------------------------- markup

  /**
   * One positioned card. `opts`: x, y, z, faceDown, back (design id),
   * attrs (extra attribute string), cls (extra class names).
   */
  function cardHTML(card, opts) {
    var down = opts.faceDown;
    return (
      '<div class="card' +
      (down ? " down" : "") +
      (opts.cls ? " " + opts.cls : "") +
      '" style="left:' +
      opts.x +
      "px;top:" +
      opts.y +
      "px;z-index:" +
      (opts.z || 1) +
      '"' +
      (opts.attrs || "") +
      (down ? "" : ' aria-label="' + name(card) + '"') +
      ">" +
      (down ? backHTML(opts.back || "weave") : faceSVG(card)) +
      "</div>"
    );
  }

  /** An empty place a card can go: a pile's outline on the felt. */
  function slotHTML(x, y, attrs, cls, inner) {
    return (
      '<div class="slot' +
      (cls ? " " + cls : "") +
      '" style="left:' +
      x +
      "px;top:" +
      y +
      'px"' +
      (attrs || "") +
      ">" +
      (inner || "") +
      "</div>"
    );
  }

  var imageCache = {};
  /** A face as an <img>, for drawing on a canvas (Solitaire's win). */
  function image(card) {
    var k = key(card);
    if (!imageCache[k]) {
      var img = new Image();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(faceSVG(card));
      imageCache[k] = img;
    }
    return imageCache[k];
  }

  // ---------------------------------------------------------------- layout

  /**
   * Fit a card table to its window. Below `minW` x `minH` the table is drawn
   * at that size and scaled down, so a narrow window still shows every pile.
   */
  function fitBoard(host, board, minW, minH) {
    var w = Math.max(1, host.clientWidth);
    var h = Math.max(1, host.clientHeight);
    var scale = Math.min(1, w / minW, h / minH);
    var bw = w / scale;
    var bh = h / scale;
    board.style.width = bw + "px";
    board.style.height = bh + "px";
    board.style.transform = scale < 1 ? "scale(" + scale + ")" : "";
    return { scale: scale, width: bw, height: bh };
  }

  function overlap(a, b) {
    var w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }

  /** The legal drop target under a dragged card: the one it overlaps most. */
  function bestTarget(board, rect, isLegal) {
    var best = null;
    var bestArea = 0;
    board.querySelectorAll("[data-target]").forEach(function (el) {
      var id = el.getAttribute("data-target");
      var area = overlap(rect, el.getBoundingClientRect());
      if (area > bestArea && isLegal(id)) {
        best = id;
        bestArea = area;
      }
    });
    return best;
  }

  /**
   * Pointer handling for a card table.
   *
   *   pick(el)           -> { els, payload } to start dragging, or null
   *   drop(payload, r)   -> true if the cards moved (the game redraws), false
   *                         to send them back
   *   click(el), dblclick(el), rightclick(e)
   *
   * `el` is the element under the pointer that carries data-hit, or null for
   * bare felt. Double-click is detected here rather than left to the browser,
   * so a double tap works on a touch screen too.
   */
  function dragController(board, opts) {
    var press = null;
    var last = { key: null, time: 0 };

    function scale() {
      return opts.scale ? opts.scale() : 1;
    }

    function onDown(e) {
      if (e.button !== 0 || press) return;
      var target = e.target.closest("[data-hit]");
      press = { x: e.clientX, y: e.clientY, target: target, dragging: false, refused: false };
      if (e.pointerType === "mouse") e.preventDefault();
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    }

    function startDrag() {
      var picked = press.target ? opts.pick(press.target) : null;
      if (!picked || !picked.els.length) {
        press.refused = true;
        return;
      }
      press.dragging = true;
      press.els = picked.els;
      press.payload = picked.payload;
      press.orig = picked.els.map(function (el) {
        return { left: parseFloat(el.style.left), top: parseFloat(el.style.top), z: el.style.zIndex };
      });
      picked.els.forEach(function (el, i) {
        el.classList.add("lifted");
        el.style.zIndex = String(1000 + i);
      });
    }

    function onMove(e) {
      if (!press) return;
      if (!press.dragging) {
        if (press.refused) return;
        if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) < 5) return;
        startDrag();
        if (!press.dragging) return;
      }
      var s = scale();
      var dx = (e.clientX - press.x) / s;
      var dy = (e.clientY - press.y) / s;
      press.els.forEach(function (el, i) {
        el.style.left = press.orig[i].left + dx + "px";
        el.style.top = press.orig[i].top + dy + "px";
      });
    }

    function finish() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      var p = press;
      press = null;
      return p;
    }

    function sendBack(p) {
      p.els.forEach(function (el, i) {
        el.classList.add("returning");
        el.style.left = p.orig[i].left + "px";
        el.style.top = p.orig[i].top + "px";
      });
      setTimeout(function () {
        p.els.forEach(function (el, i) {
          el.classList.remove("returning", "lifted");
          el.style.zIndex = p.orig[i].z;
        });
      }, 160);
    }

    function onUp(e) {
      var p = finish();
      if (!p) return;
      if (p.dragging) {
        var moved = opts.drop(p.payload, p.els[0].getBoundingClientRect(), e);
        if (!moved) sendBack(p);
        return;
      }
      if (p.refused && Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) >= 5) return;
      var k = p.target ? p.target.getAttribute("data-hit") : "felt";
      var now = Date.now();
      if (last.key === k && now - last.time < 450) {
        last = { key: null, time: 0 };
        if (opts.dblclick) opts.dblclick(p.target, e);
      } else {
        last = { key: k, time: now };
        if (opts.click) opts.click(p.target, e);
      }
    }

    function onCancel() {
      var p = finish();
      if (p && p.dragging) sendBack(p);
    }

    board.addEventListener("pointerdown", onDown);
    board.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      if (opts.rightclick) opts.rightclick(e);
    });

    return {
      cancel: function () {
        var p = finish();
        if (p && p.dragging) sendBack(p);
      },
      busy: function () {
        return !!(press && press.dragging);
      },
    };
  }

  Win95.Cards = {
    W: W,
    H: H,
    SUITS: SUITS,
    RANKS: RANKS,
    BACKS: BACKS,
    isRed: isRed,
    newDeck: newDeck,
    shuffle: shuffle,
    name: name,
    key: key,
    faceSVG: faceSVG,
    backHTML: backHTML,
    cardHTML: cardHTML,
    slotHTML: slotHTML,
    image: image,
    fitBoard: fitBoard,
    bestTarget: bestTarget,
    dragController: dragController,
  };
})();
