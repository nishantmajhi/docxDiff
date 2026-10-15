/*
 * Solitaire (Klondike), as Windows 95 shipped it: Draw One or Draw Three,
 * Standard, Vegas or no scoring, a timed game, Undo, a choice of card backs,
 * right-click to send everything possible home -- and the bouncing cards when
 * you win.
 *
 * The rules are plain functions over a state object (Win95.rules.solitaire).
 */
(function () {
  "use strict";

  var Win95 = (window.Win95 = window.Win95 || {});
  var Cards = Win95.Cards;

  // ---------------------------------------------------------------- rules

  function isRed(suit) {
    return suit === "H" || suit === "D";
  }

  function newDeck() {
    var deck = [];
    ["C", "D", "H", "S"].forEach(function (suit) {
      for (var r = 1; r <= 13; r++) deck.push({ rank: r, suit: suit });
    });
    return deck;
  }

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

  /**
   * A new deal. opts: draw (1 | 3), scoring ("standard" | "vegas" | "none"),
   * timed (bool), carry (a Vegas score carried over from the last deal).
   */
  function deal(opts, rand) {
    var deck = shuffle(newDeck(), rand);
    var tableau = [[], [], [], [], [], [], []];
    for (var row = 0; row < 7; row++) {
      for (var p = row; p < 7; p++) {
        var c = deck.pop();
        tableau[p].push({ rank: c.rank, suit: c.suit, up: p === row });
      }
    }
    var stock = deck.map(function (c) {
      return { rank: c.rank, suit: c.suit, up: false };
    });
    return {
      stock: stock,
      waste: [],
      fan: 0,
      foundations: [[], [], [], []],
      tableau: tableau,
      draw: opts.draw === 3 ? 3 : 1,
      scoring: opts.scoring || "standard",
      timed: opts.timed !== false,
      score: opts.scoring === "vegas" ? (opts.carry || 0) - 52 : 0,
      passes: 0,
      time: 0,
      moves: 0,
      history: [],
      won: false,
    };
  }

  function top(pile) {
    return pile.length ? pile[pile.length - 1] : null;
  }

  function canStack(card, pile) {
    var t = top(pile);
    if (!t) return card.rank === 13;
    return t.up && isRed(t.suit) !== isRed(card.suit) && t.rank === card.rank + 1;
  }

  function canFound(card, pile) {
    var t = top(pile);
    if (!t) return card.rank === 1;
    return t.suit === card.suit && t.rank === card.rank - 1;
  }

  function addScore(g, standardPts, vegasPts) {
    if (g.scoring === "standard") g.score = Math.max(0, g.score + standardPts);
    else if (g.scoring === "vegas") g.score += vegasPts || 0;
  }

  function snapshot(g) {
    return JSON.stringify({
      stock: g.stock,
      waste: g.waste,
      fan: g.fan,
      foundations: g.foundations,
      tableau: g.tableau,
      score: g.score,
      passes: g.passes,
    });
  }

  function remember(g) {
    g.history.push(snapshot(g));
    if (g.history.length > 200) g.history.shift();
  }

  function undo(g) {
    if (!g.history.length || g.won) return false;
    var s = JSON.parse(g.history.pop());
    Object.keys(s).forEach(function (k) {
      g[k] = s[k];
    });
    return true;
  }

  /** Vegas allows one pass through the stock in Draw One, three in Draw Three. */
  function canRecycle(g) {
    if (g.stock.length || !g.waste.length) return false;
    if (g.scoring !== "vegas") return true;
    return g.passes < (g.draw === 3 ? 2 : 0);
  }

  /** Click on the stock: turn cards over, or turn the waste back over. */
  function drawCards(g) {
    if (!g.stock.length) {
      if (!canRecycle(g)) return false;
      remember(g);
      g.stock = g.waste.reverse().map(function (c) {
        return { rank: c.rank, suit: c.suit, up: false };
      });
      g.waste = [];
      g.fan = 0;
      g.passes++;
      if (g.draw === 1) addScore(g, -100);
      else if (g.passes >= 4) addScore(g, -20);
      return true;
    }
    remember(g);
    var n = Math.min(g.draw, g.stock.length);
    for (var i = 0; i < n; i++) {
      var c = g.stock.pop();
      c.up = true;
      g.waste.push(c);
    }
    g.fan = n;
    g.moves++;
    return true;
  }

  /** Turn over the face-down card on top of a tableau pile. */
  function flip(g, i) {
    var t = top(g.tableau[i]);
    if (!t || t.up) return false;
    remember(g);
    t.up = true;
    addScore(g, 5);
    g.moves++;
    return true;
  }

  /** The cards a move would pick up, or null if they cannot be picked up. */
  function picked(g, from) {
    if (from.pile === "waste") return g.waste.length ? [top(g.waste)] : null;
    if (from.pile === "f") {
      var f = g.foundations[from.i];
      return f.length ? [top(f)] : null;
    }
    var t = g.tableau[from.i];
    if (from.index < 0 || from.index >= t.length || !t[from.index].up) return null;
    return t.slice(from.index);
  }

  function canMove(g, from, to) {
    var cards = picked(g, from);
    if (!cards) return false;
    if (to.pile === from.pile && to.i === from.i) return false;
    if (to.pile === "f") return cards.length === 1 && canFound(cards[0], g.foundations[to.i]);
    if (to.pile === "t") return canStack(cards[0], g.tableau[to.i]);
    return false;
  }

  /** from: {pile: "waste"} | {pile: "t", i, index} | {pile: "f", i}; to: {pile: "t"|"f", i}. */
  function move(g, from, to, keepHistory) {
    if (!canMove(g, from, to)) return false;
    if (!keepHistory) remember(g);
    var cards;
    if (from.pile === "waste") {
      cards = [g.waste.pop()];
      g.fan = Math.max(g.waste.length ? 1 : 0, g.fan - 1);
    } else if (from.pile === "f") {
      cards = [g.foundations[from.i].pop()];
    } else {
      cards = g.tableau[from.i].splice(from.index);
    }
    var dest = to.pile === "f" ? g.foundations[to.i] : g.tableau[to.i];
    cards.forEach(function (c) {
      dest.push(c);
    });
    if (to.pile === "f") {
      addScore(g, from.pile === "f" ? 0 : 10, 5);
    } else if (from.pile === "waste") {
      addScore(g, 5);
    } else if (from.pile === "f") {
      addScore(g, -15, -5);
    }
    g.moves++;
    g.won = g.foundations.every(function (f) {
      return f.length === 13;
    });
    return true;
  }

  /** Where a card could go home, or -1. */
  function foundationFor(g, card) {
    for (var i = 0; i < 4; i++) if (canFound(card, g.foundations[i])) return i;
    return -1;
  }

  /** Double-click: send one card home if it can go. */
  function sendHome(g, from) {
    var cards = picked(g, from);
    if (!cards || cards.length !== 1) return false;
    var f = foundationFor(g, cards[0]);
    return f !== -1 && move(g, from, { pile: "f", i: f });
  }

  /** Right-click: send home everything that can go, as one undoable step. */
  function autoPlay(g) {
    var before = snapshot(g);
    var moved = 0;
    var again = true;
    while (again && !g.won) {
      again = false;
      var froms = [{ pile: "waste" }];
      for (var i = 0; i < 7; i++) froms.push({ pile: "t", i: i, index: g.tableau[i].length - 1 });
      for (var k = 0; k < froms.length; k++) {
        var cards = picked(g, froms[k]);
        if (!cards || cards.length !== 1) continue;
        var f = foundationFor(g, cards[0]);
        if (f !== -1 && move(g, froms[k], { pile: "f", i: f }, true)) {
          moved++;
          again = true;
        }
      }
    }
    if (moved) {
      g.history.push(before);
    }
    return moved;
  }

  /** One second of the clock: a timed Standard game loses 2 points every 10. */
  function tick(g) {
    g.time++;
    if (g.timed && g.scoring === "standard" && g.time % 10 === 0) addScore(g, -2);
  }

  /** The Standard bonus for a timed win. */
  function bonus(g) {
    if (!g.timed || g.scoring !== "standard" || g.time < 30) return 0;
    return Math.round(700000 / g.time);
  }

  var rules = {
    deal: deal,
    canStack: canStack,
    canFound: canFound,
    canRecycle: canRecycle,
    drawCards: drawCards,
    flip: flip,
    canMove: canMove,
    move: move,
    sendHome: sendHome,
    autoPlay: autoPlay,
    undo: undo,
    tick: tick,
    bonus: bonus,
  };
  Win95.rules = Win95.rules || {};
  Win95.rules.solitaire = rules;

  // ---------------------------------------------------------------- game window

  var ICON =
    '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">' +
    '<path d="M1 3h8v11H1z" fill="#fff" stroke="#000" stroke-width="1"/><path d="M2 4h6v9H2z" fill="#0050c8"/>' +
    '<path d="M6.5 1.5h8v11h-8z" fill="#fff" stroke="#000"/><path d="M10 4l2 2.5-2 2.5-2-2.5z" fill="#d40000"/></svg>';

  function createGame(win) {
    var store = Win95.store;
    var settings = store.get("solitaire.settings", {
      draw: 3,
      scoring: "standard",
      timed: true,
      back: "weave",
      keep: false,
    });
    var g;
    var timer = null;
    var started = false;
    var celebrating = null;
    var lay = null; // layout of the last render

    win.body.innerHTML = '<div class="card-host"><div class="card-board"></div></div>';
    var host = win.body.querySelector(".card-host");
    var board = host.querySelector(".card-board");
    var status = win.statusBar(2);

    function stopTimer() {
      if (timer) clearInterval(timer);
      timer = null;
    }
    function startTimer() {
      stopTimer();
      timer = setInterval(function () {
        tick(g);
        renderStatus();
      }, 1000);
    }

    function newDeal() {
      stopCelebration();
      stopTimer();
      // Vegas with Keep score carries the running total into the next deal,
      // which costs another $52.
      var carry =
        g && g.scoring === "vegas" && settings.scoring === "vegas" && settings.keep ? g.score : 0;
      g = deal({ draw: settings.draw, scoring: settings.scoring, timed: settings.timed, carry: carry });
      started = false;
      render();
    }

    function touch() {
      if (!started && !g.won) {
        started = true;
        startTimer();
      }
    }

    // ---- layout

    function layout() {
      var fit = Cards.fitBoard(host, board, 545, 330);
      var gap = Math.max(6, Math.min(40, (fit.width - 7 * 71) / 8));
      var colX = function (i) {
        return Math.round(gap + i * (71 + gap));
      };
      return { fit: fit, colX: colX, top: 10, tabY: 10 + 96 + 14, width: fit.width, height: fit.height };
    }

    function renderStatus() {
      var score =
        g.scoring === "none"
          ? ""
          : "Score: " + (g.scoring === "vegas" ? (g.score < 0 ? "-$" + -g.score : "$" + g.score) : g.score);
      status[0].textContent = "";
      status[1].textContent = score + (g.timed ? (score ? "   " : "") + "Time: " + g.time : "");
    }

    function render() {
      lay = layout();
      var html = [];
      var back = settings.back;
      var L = lay;

      // Stock: its thickness shows how much is left.
      if (g.stock.length) {
        var layers = Math.min(3, 1 + Math.floor((g.stock.length - 1) / 8));
        for (var s = 0; s < layers; s++) {
          var last = s === layers - 1;
          html.push(
            Cards.cardHTML(g.stock[0], {
              x: L.colX(0) + s * 2,
              y: L.top + s,
              z: s + 1,
              faceDown: true,
              back: back,
              attrs: last ? ' data-hit="stock"' : "",
            }),
          );
        }
      } else {
        var canGo = canRecycle(g);
        html.push(
          Cards.slotHTML(
            L.colX(0),
            L.top,
            ' data-hit="stock" title="' + (canGo ? "Turn the deck over" : "No more passes") + '"',
            "stock-slot",
            canGo
              ? '<svg viewBox="0 0 71 96" width="69" height="94"><circle cx="35.5" cy="48" r="18" fill="none" stroke="#00c000" stroke-width="7"/></svg>'
              : '<svg viewBox="0 0 71 96" width="69" height="94"><path d="M20 32l31 32M51 32L20 64" stroke="#c00000" stroke-width="8"/></svg>',
          ),
        );
      }

      // Waste: the last cards turned over, fanned in Draw Three.
      var shown = Math.min(g.waste.length, Math.max(1, g.fan));
      var under = g.waste.length - shown;
      if (under > 0) {
        html.push(Cards.cardHTML(g.waste[under - 1], { x: L.colX(1), y: L.top, z: 1 }));
      }
      for (var w = 0; w < shown; w++) {
        var idx = under + w;
        var isTop = idx === g.waste.length - 1;
        html.push(
          Cards.cardHTML(g.waste[idx], {
            x: L.colX(1) + (g.draw === 3 ? w * 14 : 0),
            y: L.top,
            z: 2 + w,
            attrs: isTop ? ' data-hit="waste"' : "",
          }),
        );
      }

      // Foundations.
      g.foundations.forEach(function (f, i) {
        var x = L.colX(3 + i);
        if (!f.length) {
          html.push(Cards.slotHTML(x, L.top, ' data-target="f' + i + '"'));
          return;
        }
        if (f.length > 1) html.push(Cards.cardHTML(f[f.length - 2], { x: x, y: L.top, z: 1 }));
        html.push(
          Cards.cardHTML(top(f), {
            x: x,
            y: L.top,
            z: 2,
            attrs: ' data-hit="f' + i + '" data-target="f' + i + '"',
          }),
        );
      });

      // Tableau, squeezed to fit the window's height.
      g.tableau.forEach(function (pile, i) {
        var x = L.colX(i);
        html.push(Cards.slotHTML(x, L.tabY, ' data-hit="t' + i + '-slot"' + (pile.length ? "" : ' data-target="t' + i + '"')));
        var downs = pile.filter(function (c) {
          return !c.up;
        }).length;
        var ups = pile.length - downs;
        var down = 4;
        var up = 16;
        var room = L.height - L.tabY - 96 - 6;
        if (downs * down + Math.max(0, ups - 1) * up > room && ups > 1) {
          up = Math.max(6, (room - downs * down) / (ups - 1));
        }
        var y = L.tabY;
        pile.forEach(function (c, j) {
          var isTop = j === pile.length - 1;
          html.push(
            Cards.cardHTML(c, {
              x: x,
              y: Math.round(y),
              z: j + 2,
              faceDown: !c.up,
              back: back,
              attrs:
                ' data-hit="t' + i + "-" + j + '" data-pile="t' + i + '" data-index="' + j + '"' +
                (isTop ? ' data-target="t' + i + '"' : ""),
            }),
          );
          y += c.up ? up : down;
        });
      });

      board.innerHTML = html.join("");
      renderStatus();
    }

    // ---- moves

    function parseHit(hit) {
      if (!hit) return null;
      if (hit === "stock") return { pile: "stock" };
      if (hit === "waste") return { pile: "waste" };
      var m = /^f(\d)$/.exec(hit);
      if (m) return { pile: "f", i: Number(m[1]) };
      m = /^t(\d)-(\d+)$/.exec(hit);
      if (m) return { pile: "t", i: Number(m[1]), index: Number(m[2]) };
      return null;
    }

    function parseTarget(id) {
      return { pile: id.charAt(0), i: Number(id.slice(1)) };
    }

    function after() {
      render();
      if (g.won) win95();
    }

    var drag = Cards.dragController(board, {
      scale: function () {
        return lay ? lay.fit.scale : 1;
      },
      pick: function (el) {
        if (g.won || celebrating) return null;
        var from = parseHit(el.getAttribute("data-hit"));
        if (!from || from.pile === "stock") return null;
        var cards = (function () {
          if (from.pile === "t") {
            var pile = g.tableau[from.i];
            if (!pile[from.index] || !pile[from.index].up) return null;
            return Array.prototype.slice
              .call(board.querySelectorAll('[data-pile="t' + from.i + '"]'))
              .filter(function (c) {
                return Number(c.getAttribute("data-index")) >= from.index;
              });
          }
          return [el];
        })();
        return cards ? { els: cards, payload: from } : null;
      },
      drop: function (from, rect) {
        var target = Cards.bestTarget(board, rect, function (id) {
          return canMove(g, from, parseTarget(id));
        });
        if (!target) return false;
        touch();
        move(g, from, parseTarget(target));
        after();
        return true;
      },
      click: function (el) {
        if (g.won || celebrating) return;
        var hit = el && parseHit(el.getAttribute("data-hit"));
        if (!hit) return;
        if (hit.pile === "stock") {
          if (drawCards(g)) {
            touch();
            render();
          }
        } else if (hit.pile === "t") {
          var pile = g.tableau[hit.i];
          if (hit.index === pile.length - 1 && !pile[hit.index].up) {
            touch();
            flip(g, hit.i);
            render();
          }
        }
      },
      dblclick: function (el) {
        if (g.won || celebrating || !el) return;
        var hit = parseHit(el.getAttribute("data-hit"));
        if (!hit) return;
        if (hit.pile === "stock") {
          // Two quick clicks on the deck are two draws.
          if (drawCards(g)) {
            touch();
            render();
          }
          return;
        }
        if (hit.pile === "t") {
          var pile = g.tableau[hit.i];
          if (hit.index !== pile.length - 1) return;
          if (!pile[hit.index].up) {
            touch();
            flip(g, hit.i);
            render();
            return;
          }
        }
        if (sendHome(g, hit)) {
          touch();
          after();
        }
      },
      rightclick: function () {
        if (g.won || celebrating) return;
        if (autoPlay(g)) {
          touch();
          after();
        }
      },
    });

    // ---- the win

    function stopCelebration() {
      if (!celebrating) return;
      celebrating.stop();
      celebrating = null;
    }

    function win95() {
      stopTimer();
      var extra = bonus(g);
      if (extra) {
        g.score += extra;
        renderStatus();
      }
      celebrate(function () {
        win.message("Deal again?", {
          title: "Solitaire",
          icon: "question",
          buttons: [
            { label: "<u>Y</u>es", value: "yes", isDefault: true },
            { label: "<u>N</u>o", value: "no", isCancel: true },
          ],
          onClose: function (v) {
            if (v === "yes") newDeal();
          },
        });
      });
    }

    // Each card leaves its foundation in turn, Kings first, and bounces off
    // the bottom of the window leaving a trail behind it.
    function celebrate(done) {
      var L = lay;
      var queue = [];
      for (var r = 12; r >= 0; r--) {
        for (var f = 0; f < 4; f++) queue.push({ f: f, card: g.foundations[f][r] });
      }
      var images = queue.map(function (q) {
        return Cards.image(q.card);
      });
      var canvas = document.createElement("canvas");
      canvas.className = "win-canvas";
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(host.clientWidth * dpr);
      canvas.height = Math.round(host.clientHeight * dpr);
      host.appendChild(canvas);
      var ctx = canvas.getContext("2d");
      ctx.setTransform(dpr * L.fit.scale, 0, 0, dpr * L.fit.scale, 0, 0);
      var shown = [13, 13, 13, 13];
      var cur = null;
      var raf = 0;
      var stopped = false;

      function launch() {
        var q = queue.shift();
        if (!q) return null;
        shown[q.f]--;
        // The foundation underneath now shows the next card down.
        var pile = g.foundations[q.f];
        g.foundations[q.f] = pile.slice(0, shown[q.f]);
        render();
        g.foundations[q.f] = pile;
        var dir = Math.random() < 0.5 ? -1 : 1;
        return {
          img: images[51 - queue.length],
          x: L.colX(3 + q.f),
          y: L.top,
          vx: dir * (2 + Math.random() * 5),
          vy: -Math.random() * 10,
        };
      }

      function frame() {
        if (stopped) return;
        for (var step = 0; step < 2; step++) {
          if (!cur) {
            cur = launch();
            if (!cur) return finish();
          }
          cur.vy += 0.6;
          cur.x += cur.vx;
          cur.y += cur.vy;
          var floor = L.height - 96;
          if (cur.y > floor) {
            cur.y = floor;
            cur.vy = -cur.vy * 0.78;
          }
          try {
            ctx.drawImage(cur.img, cur.x, cur.y, 71, 96);
          } catch (e) {
            /* an image not decoded yet is simply skipped this frame */
          }
          if (cur.x < -71 || cur.x > L.width) cur = null;
        }
        raf = requestAnimationFrame(frame);
      }

      function finish() {
        if (stopped) return;
        stop();
        done();
      }

      function stop() {
        stopped = true;
        cancelAnimationFrame(raf);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        host.removeEventListener("pointerdown", finish);
        celebrating = null;
        render();
      }

      host.addEventListener("pointerdown", finish);
      celebrating = { stop: stop, finish: finish };

      Promise.all(
        images.map(function (img) {
          return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
        }),
      ).then(function () {
        if (!stopped) raf = requestAnimationFrame(frame);
      });
    }

    // ---- dialogs

    function showOptions() {
      var body =
        '<div class="sol-options">' +
        '<fieldset class="group95"><legend>Draw</legend>' +
        '<label><input type="radio" name="draw" value="1"' + (settings.draw === 1 ? " checked" : "") + "/> Draw <u>O</u>ne</label>" +
        '<label><input type="radio" name="draw" value="3"' + (settings.draw === 3 ? " checked" : "") + "/> Draw <u>T</u>hree</label>" +
        "</fieldset>" +
        '<fieldset class="group95"><legend>Scoring</legend>' +
        ["standard", "vegas", "none"]
          .map(function (k) {
            return (
              '<label><input type="radio" name="scoring" value="' + k + '"' + (settings.scoring === k ? " checked" : "") + "/> " +
              { standard: "<u>S</u>tandard", vegas: "<u>V</u>egas", none: "<u>N</u>one" }[k] +
              "</label>"
            );
          })
          .join("") +
        "</fieldset>" +
        '<label class="dlg-check"><input type="checkbox" name="timed"' + (settings.timed ? " checked" : "") + "/> T<u>i</u>med game</label>" +
        '<label class="dlg-check"><input type="checkbox" name="keep"' + (settings.keep ? " checked" : "") + "/> <u>K</u>eep score (Vegas)</label>" +
        "</div>";
      win.dialog({
        title: "Options",
        body: body,
        buttons: [
          { label: "OK", value: "ok", isDefault: true },
          { label: "Cancel", value: "cancel", isCancel: true },
        ],
        onClose: function (v, d) {
          if (v !== "ok") return;
          var draw = Number(d.querySelector('[name="draw"]:checked').value);
          var scoring = d.querySelector('[name="scoring"]:checked').value;
          var timed = d.querySelector('[name="timed"]').checked;
          var changed = draw !== settings.draw || scoring !== settings.scoring || timed !== settings.timed;
          settings.draw = draw;
          settings.scoring = scoring;
          settings.timed = timed;
          settings.keep = d.querySelector('[name="keep"]').checked;
          store.set("solitaire.settings", settings);
          if (changed) newDeal();
        },
      });
    }

    function showDeck() {
      var chosen = settings.back;
      var grid = document.createElement("div");
      grid.className = "back-grid";
      grid.innerHTML = Cards.BACKS.map(function (b) {
        return (
          '<button type="button" class="back-choice' + (b.id === chosen ? " on" : "") + '" data-back="' + b.id + '" title="' + b.name + '" aria-label="' + b.name + '">' +
          Cards.backHTML(b.id) +
          "</button>"
        );
      }).join("");
      var dlg;
      grid.addEventListener("click", function (e) {
        var b = e.target.closest("[data-back]");
        if (!b) return;
        chosen = b.getAttribute("data-back");
        grid.querySelectorAll(".back-choice").forEach(function (x) {
          x.classList.toggle("on", x === b);
        });
      });
      grid.addEventListener("dblclick", function (e) {
        if (e.target.closest("[data-back]")) dlg.close("ok");
      });
      dlg = win.dialog({
        title: "Select Card Back",
        body: grid,
        buttons: [
          { label: "OK", value: "ok", isDefault: true },
          { label: "Cancel", value: "cancel", isCancel: true },
        ],
        onClose: function (v) {
          if (v !== "ok") return;
          settings.back = chosen;
          store.set("solitaire.settings", settings);
          render();
        },
      });
    }

    function about() {
      win.message(
        "<b>Solitaire</b><br/><br/>Build the four foundations up by suit from Ace to King. " +
          "On the table, build down in alternating colours; only a King may fill a space.<br/><br/>" +
          "Double-click a card to send it home; right-click to send home everything that can go.<br/><br/>" +
          "Part of docxDiff. Everything runs in this browser.",
        { title: "About Solitaire" },
      );
    }

    win.setMenus([
      {
        label: "<u>G</u>ame",
        items: function () {
          return [
            { label: "<u>D</u>eal", key: "F2", action: newDeal },
            "-",
            {
              label: "<u>U</u>ndo",
              key: "Ctrl+Z",
              disabled: !g.history.length || g.won,
              action: function () {
                if (undo(g)) render();
              },
            },
            { label: "De<u>c</u>k…", action: showDeck },
            { label: "<u>O</u>ptions…", action: showOptions },
            "-",
            { label: "E<u>x</u>it", action: function () { win.close(); } },
          ];
        },
      },
      { label: "<u>H</u>elp", items: [{ label: "<u>A</u>bout Solitaire…", key: "F1", action: about }] },
    ]);

    newDeal();

    return {
      onResize: function () {
        if (!drag.busy() && !celebrating) render();
      },
      onKey: function (e) {
        if (e.key === "F2") {
          e.preventDefault();
          newDeal();
        } else if (e.key === "F1") {
          e.preventDefault();
          about();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
          e.preventDefault();
          if (undo(g)) render();
        } else if (celebrating) {
          celebrating.finish();
        }
      },
      onMinimize: function () {
        stopTimer();
      },
      onRestore: function () {
        if (started && !g.won) startTimer();
      },
      destroy: function () {
        stopTimer();
        stopCelebration();
        drag.cancel();
      },
      state: function () {
        return g;
      },
    };
  }

  if (Win95.registerGame) {
    Win95.registerGame({
      id: "solitaire",
      title: "Solitaire",
      icon: ICON,
      width: 640,
      height: 480,
      minWidth: 320,
      minHeight: 260,
      create: createGame,
    });
  }
})();
