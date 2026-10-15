/*
 * FreeCell, as Windows 95 shipped it: games numbered 1 to 32000 and dealt
 * exactly as Microsoft's FreeCell dealt them, so game #11982 is the same
 * game it always was; click a column, then where it should go; supermoves
 * through free cells and empty columns; cards go home on their own once
 * nothing can be played on them; Undo, Restart, Select Game and Statistics.
 *
 * Cards can also be dragged, which Windows 95 could not do.
 *
 * The rules are plain functions over a state object (Win95.rules.freecell).
 */
(function () {
  "use strict";

  var Win95 = (window.Win95 = window.Win95 || {});
  var Cards = Win95.Cards;

  // ---------------------------------------------------------------- rules

  function isRed(suit) {
    return suit === "H" || suit === "D";
  }

  /**
   * The Microsoft deal: a linear congruential generator seeded with the game
   * number, picking from Ace of Clubs, Ace of Diamonds, Ace of Hearts, Ace of
   * Spades, Two of Clubs... and dealing across eight columns.
   */
  function msDeal(n) {
    var seed = n;
    function rand() {
      seed = (seed * 214013 + 2531011) % 2147483648;
      return Math.floor(seed / 65536);
    }
    var deck = [];
    for (var i = 0; i < 52; i++) deck.push({ rank: Math.floor(i / 4) + 1, suit: "CDHS".charAt(i % 4) });
    var cols = [[], [], [], [], [], [], [], []];
    var left = 52;
    for (var k = 0; k < 52; k++) {
      var j = rand() % left;
      cols[k % 8].push(deck[j]);
      deck[j] = deck[--left];
    }
    return cols;
  }

  function newGame(n) {
    return {
      game: n,
      cells: [null, null, null, null],
      home: [[], [], [], []],
      cols: msDeal(n),
      history: [],
      moves: 0,
      won: false,
    };
  }

  function top(pile) {
    return pile.length ? pile[pile.length - 1] : null;
  }

  function stacks(card, onto) {
    return !!onto && isRed(card.suit) !== isRed(onto.suit) && onto.rank === card.rank + 1;
  }

  /** How many cards at the bottom of a column form one movable run. */
  function runLength(col) {
    if (!col.length) return 0;
    var n = 1;
    for (var i = col.length - 1; i > 0 && stacks(col[i], col[i - 1]); i--) n++;
    return n;
  }

  /** The supermove limit: (free cells + 1) x 2^(empty columns). */
  function maxMove(g, toEmptyColumn) {
    var free = g.cells.filter(function (c) {
      return !c;
    }).length;
    var empty = g.cols.filter(function (c) {
      return !c.length;
    }).length;
    if (toEmptyColumn) empty--;
    return (free + 1) * Math.pow(2, Math.max(0, empty));
  }

  /** The home cell a card can go to, or -1. */
  function homeFor(g, card) {
    for (var i = 0; i < 4; i++) {
      var t = top(g.home[i]);
      if (t ? t.suit === card.suit && t.rank === card.rank - 1 : card.rank === 1 && !homeTaken(g, card.suit, i)) return i;
    }
    return -1;
  }
  function homeTaken(g, suit, except) {
    for (var i = 0; i < 4; i++) if (i !== except && g.home[i].length && g.home[i][0].suit === suit) return true;
    return false;
  }

  function snapshot(g) {
    return JSON.stringify({ cells: g.cells, home: g.home, cols: g.cols, moves: g.moves });
  }

  function remember(g) {
    g.history.push(snapshot(g));
  }

  function undo(g) {
    if (!g.history.length || g.won) return false;
    var s = JSON.parse(g.history.pop());
    g.cells = s.cells;
    g.home = s.home;
    g.cols = s.cols;
    g.moves = s.moves;
    return true;
  }

  /**
   * The cards a move would take from a column, starting at `index`, or null
   * if they are not one run.
   */
  function runFrom(col, index) {
    if (index < 0 || index >= col.length) return null;
    for (var i = col.length - 1; i > index; i--) if (!stacks(col[i], col[i - 1])) return null;
    return col.slice(index);
  }

  /**
   * from: {type: "col", i, index?} | {type: "cell", i}
   * to:   {type: "col", i} | {type: "cell", i} | {type: "home"}
   *
   * A column move without an index takes as many cards as it takes to land:
   * onto a card, the run that ends in the card that fits; into an empty
   * column, the longest run allowed (or one card, with single: true).
   * Returns the number of cards that would move, or 0 if the move is illegal.
   */
  function plan(g, from, to, single) {
    var cards;
    if (from.type === "cell") {
      if (!g.cells[from.i]) return 0;
      cards = [g.cells[from.i]];
    } else {
      var col = g.cols[from.i];
      if (!col.length) return 0;
      if (from.index !== undefined) {
        cards = runFrom(col, from.index);
        if (!cards) return 0;
      } else {
        cards = col.slice(col.length - runLength(col));
      }
    }
    var bottom = cards[cards.length - 1];

    if (to.type === "cell") {
      if (g.cells[to.i] || (from.type === "cell" && from.i === to.i)) return 0;
      if (from.index !== undefined && cards.length !== 1) return 0;
      return 1;
    }
    if (to.type === "home") {
      if (from.index !== undefined && cards.length !== 1) return 0;
      return homeFor(g, bottom) === -1 ? 0 : 1;
    }
    // To a column.
    if (from.type === "col" && from.i === to.i) return 0;
    var dest = g.cols[to.i];
    if (!dest.length) {
      var cap = maxMove(g, true);
      if (from.index !== undefined) return cards.length <= cap ? cards.length : 0;
      return single ? 1 : Math.min(cards.length, cap);
    }
    var onto = top(dest);
    if (from.index !== undefined) {
      return stacks(cards[0], onto) && cards.length <= maxMove(g, false) ? cards.length : 0;
    }
    for (var k = 1; k <= cards.length; k++) {
      if (stacks(cards[cards.length - k], onto)) return k <= maxMove(g, false) ? k : 0;
    }
    return 0;
  }

  function take(g, from, count) {
    if (from.type === "cell") {
      var c = g.cells[from.i];
      g.cells[from.i] = null;
      return [c];
    }
    return g.cols[from.i].splice(g.cols[from.i].length - count, count);
  }

  /** Make a move. Returns the number of cards moved (0 if illegal). */
  function move(g, from, to, single) {
    var n = plan(g, from, to, single);
    if (!n) return 0;
    remember(g);
    var cards = take(g, from, n);
    if (to.type === "cell") g.cells[to.i] = cards[0];
    else if (to.type === "home") g.home[homeFor(g, cards[0])].push(cards[0]);
    else Array.prototype.push.apply(g.cols[to.i], cards);
    g.moves++;
    autoHome(g);
    g.won = g.home.every(function (h) {
      return h.length === 13;
    });
    return n;
  }

  /**
   * A card goes home on its own once nothing still in play could be put on
   * it: both opposite-coloured suits are home up to one below it.
   */
  function safeHome(g, card) {
    if (card.rank <= 2) return true;
    var need = card.rank - 1;
    var ok = 0;
    for (var i = 0; i < 4; i++) {
      var t = top(g.home[i]);
      if (t && isRed(t.suit) !== isRed(card.suit) && t.rank >= need) ok++;
    }
    return ok === 2;
  }

  function autoHome(g) {
    var moved = 0;
    var again = true;
    while (again) {
      again = false;
      for (var i = 0; i < 4; i++) {
        var c = g.cells[i];
        if (c && homeFor(g, c) !== -1 && safeHome(g, c)) {
          g.home[homeFor(g, c)].push(c);
          g.cells[i] = null;
          moved++;
          again = true;
        }
      }
      for (var k = 0; k < 8; k++) {
        var b = top(g.cols[k]);
        if (b && homeFor(g, b) !== -1 && safeHome(g, b)) {
          g.home[homeFor(g, b)].push(g.cols[k].pop());
          moved++;
          again = true;
        }
      }
    }
    return moved;
  }

  /** Whether any move at all is left. */
  function hasMoves(g) {
    if (g.won) return false;
    if (g.cells.some(function (c) { return !c; })) return true;
    if (g.cols.some(function (c) { return !c.length; })) return true;
    var bottoms = g.cols.map(top);
    var loose = bottoms.concat(g.cells);
    for (var i = 0; i < loose.length; i++) {
      if (homeFor(g, loose[i]) !== -1) return true;
      for (var k = 0; k < 8; k++) {
        if (k !== i && stacks(loose[i], bottoms[k])) return true;
      }
    }
    return false;
  }

  function cardsLeft(g) {
    return 52 - g.home.reduce(function (n, h) {
      return n + h.length;
    }, 0);
  }

  var rules = {
    msDeal: msDeal,
    newGame: newGame,
    runLength: runLength,
    maxMove: maxMove,
    plan: plan,
    move: move,
    undo: undo,
    safeHome: safeHome,
    autoHome: autoHome,
    hasMoves: hasMoves,
    cardsLeft: cardsLeft,
  };
  Win95.rules = Win95.rules || {};
  Win95.rules.freecell = rules;

  // ---------------------------------------------------------------- game window

  var ICON =
    '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">' +
    '<path d="M1 1h14v14H1z" fill="#008000"/><path d="M2 2h5v6H2zM9 2h5v6H9z" fill="none" stroke="#004000"/>' +
    '<path d="M3.5 9.5h7v6h-7z" fill="#fff" stroke="#000"/><path d="M7 11l1.5 2L7 15l-1.5-2z" fill="#d40000"/>' +
    '<path d="M6 3h4v1H6z" fill="#ff0"/></svg>';

  function kingSVG(happy) {
    return (
      '<svg viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">' +
      '<path d="M8 4h2v2h2V3h2v3h4V3h2v3h2V4h2v8H8z" fill="#ffd800" stroke="#000" stroke-width=".8"/>' +
      '<path d="M9 12h14v9q0 5-7 6-7-1-7-6z" fill="#ffd0a0" stroke="#000" stroke-width=".8"/>' +
      '<path d="M18 15h3v2h-3z" fill="#000"/><path d="M21 15h1v1h-1z" fill="#fff"/>' +
      (happy
        ? '<path d="M14 21q4 4 8 0" fill="none" stroke="#c00000" stroke-width="1.4"/>'
        : '<path d="M15 22h6" stroke="#c00000" stroke-width="1.4"/>') +
      '<path d="M9 20q0 9 7 9t7-9q-3 4-7 4t-7-4z" fill="#fff" stroke="#000" stroke-width=".8"/>' +
      '<path d="M13 8h2v2h-2zM19 8h2v2h-2z" fill="#c00000"/></svg>'
    );
  }

  function createGame(win) {
    var store = Win95.store;
    var stats = store.get("freecell.stats", { won: 0, lost: 0, streak: 0, streakType: "", bestWins: 0, bestLosses: 0 });
    var session = { won: 0, lost: 0 };
    var g;
    var sel = null; // {type: "col"|"cell", i}
    var lay = null;
    var lookLeft = true;
    var ended = false; // a win or a loss has been counted for this game

    win.body.innerHTML = '<div class="card-host"><div class="card-board fc"></div></div>';
    var host = win.body.querySelector(".card-host");
    var board = host.querySelector(".card-board");

    function start(n) {
      g = newGame(n);
      sel = null;
      ended = false;
      win.setTitle("FreeCell Game #" + n);
      render();
    }

    function randomGame() {
      return 1 + Math.floor(Math.random() * 32000);
    }

    function inProgress() {
      return g && g.moves > 0 && !g.won && !ended;
    }

    function record(won) {
      if (ended) return;
      ended = true;
      if (won) {
        stats.won++;
        session.won++;
      } else {
        stats.lost++;
        session.lost++;
      }
      var type = won ? "won" : "lost";
      stats.streak = stats.streakType === type ? stats.streak + 1 : 1;
      stats.streakType = type;
      if (won) stats.bestWins = Math.max(stats.bestWins, stats.streak);
      else stats.bestLosses = Math.max(stats.bestLosses, stats.streak);
      store.set("freecell.stats", stats);
    }

    // Leaving a game you have started counts as a loss, once you agree to it.
    function resignThen(next) {
      if (!inProgress()) return next();
      win.message("Do you want to resign this game?", {
        title: "FreeCell",
        icon: "question",
        buttons: [
          { label: "<u>Y</u>es", value: "yes", isDefault: true },
          { label: "<u>N</u>o", value: "no", isCancel: true },
        ],
        onClose: function (v) {
          if (v !== "yes") return;
          record(false);
          setTimeout(next, 0);
        },
      });
    }

    // ---- layout

    function layout() {
      var fit = Cards.fitBoard(host, board, 622, 380);
      var W = fit.width;
      var gap = Math.max(6, Math.min(30, (W - 8 * 71) / 9));
      return {
        fit: fit,
        cellX: function (i) {
          return i * 72;
        },
        homeX: function (i) {
          return Math.round(W - (4 - i) * 72);
        },
        colX: function (i) {
          return Math.round(gap + i * (71 + gap));
        },
        top: 0,
        colY: 96 + 22,
        width: W,
        height: fit.height,
      };
    }

    function render() {
      lay = layout();
      var L = lay;
      var html = [];

      for (var i = 0; i < 4; i++) {
        var c = g.cells[i];
        var x = L.cellX(i);
        html.push(Cards.slotHTML(x, L.top, ' data-hit="f' + i + '" data-target="f' + i + '"', "fc-cell"));
        if (c) {
          html.push(
            Cards.cardHTML(c, {
              x: x,
              y: L.top,
              z: 2,
              cls: sel && sel.type === "cell" && sel.i === i ? "selected" : "",
              attrs: ' data-hit="f' + i + '"',
            }),
          );
        }
      }
      for (var h = 0; h < 4; h++) {
        var hx = L.homeX(h);
        html.push(Cards.slotHTML(hx, L.top, ' data-hit="h' + h + '" data-target="h' + h + '"', "fc-cell"));
        var home = g.home[h];
        if (home.length > 1) html.push(Cards.cardHTML(home[home.length - 2], { x: hx, y: L.top, z: 1 }));
        if (home.length) html.push(Cards.cardHTML(top(home), { x: hx, y: L.top, z: 2, attrs: ' data-hit="h' + h + '"' }));
      }
      // The king between the cells, looking toward the side you are on.
      var kx = Math.round((L.cellX(3) + 71 + L.homeX(0)) / 2 - 18);
      html.push(
        '<div class="fc-king' + (lookLeft ? "" : " right") + '" style="left:' + kx + 'px;top:' + (L.top + 30) + 'px">' +
          kingSVG(g.won) +
          "</div>",
      );

      g.cols.forEach(function (col, i) {
        var x = L.colX(i);
        var step = 19;
        var room = L.height - L.colY - 96 - 4;
        if ((col.length - 1) * step > room && col.length > 1) step = Math.max(6, room / (col.length - 1));
        html.push(
          '<div class="col-hit" data-hit="c' + i + '-slot" data-target="c' + i + '" style="left:' + x + "px;top:" + L.colY +
            "px;height:" + Math.max(96, L.height - L.colY) + 'px"></div>',
        );
        if (!col.length) html.push(Cards.slotHTML(x, L.colY, "", "fc-empty"));
        col.forEach(function (card, j) {
          var isBottom = j === col.length - 1;
          html.push(
            Cards.cardHTML(card, {
              x: x,
              y: Math.round(L.colY + j * step),
              z: j + 2,
              cls: isBottom && sel && sel.type === "col" && sel.i === i ? "selected" : "",
              attrs: ' data-hit="c' + i + "-" + j + '" data-pile="c' + i + '" data-index="' + j + '"',
            }),
          );
        });
      });

      board.innerHTML = html.join("");
      win.setMenuInfo("Cards Left: " + cardsLeft(g));
    }

    // ---- moves

    function parse(hit) {
      if (!hit) return null;
      var m = /^c(\d)(?:-(\d+|slot))?$/.exec(hit);
      if (m) return { type: "col", i: Number(m[1]), index: m[2] && m[2] !== "slot" ? Number(m[2]) : undefined };
      m = /^([fh])(\d)$/.exec(hit);
      if (m) return { type: m[1] === "f" ? "cell" : "home", i: Number(m[2]) };
      return null;
    }

    function notAllowed() {
      win.message("That move is not allowed.", { title: "FreeCell", icon: "info" });
    }

    function afterMove() {
      sel = null;
      render();
      if (g.won) {
        record(true);
        win.message("Congratulations, you win!<br/><br/>Do you want to play again?", {
          title: "Game Over",
          icon: "info",
          buttons: [
            { label: "<u>Y</u>es", value: "yes", isDefault: true },
            { label: "<u>N</u>o", value: "no", isCancel: true },
          ],
          onClose: function (v) {
            if (v === "yes") setTimeout(function () { start(randomGame()); }, 0);
          },
        });
      } else if (!hasMoves(g)) {
        record(false);
        win.message("There are no more legal moves.<br/><br/>Do you want to play again?", {
          title: "Game Over",
          icon: "info",
          buttons: [
            { label: "<u>Y</u>es", value: "yes", isDefault: true },
            { label: "<u>N</u>o", value: "no", isCancel: true },
          ],
          onClose: function (v) {
            if (v === "yes") setTimeout(function () { start(randomGame()); }, 0);
          },
        });
      }
    }

    function tryMove(from, to) {
      // Into an empty column, a run of more than one card could move whole
      // or alone; Windows asked, and so does this.
      if (to.type === "col" && !g.cols[to.i].length && from.type === "col" && plan(g, from, to) > 1) {
        win.dialog({
          title: "Move to Empty Column",
          body: '<p class="dlg-text">Move the column, or just one card?</p>',
          buttons: [
            { label: "Move <u>c</u>olumn", value: "col", isDefault: true },
            { label: "Move <u>s</u>ingle card", value: "one" },
            { label: "Cancel", value: "cancel", isCancel: true },
          ],
          onClose: function (v) {
            if (v === "cancel" || v === null) {
              sel = null;
              render();
              return;
            }
            move(g, from, to, v === "one");
            setTimeout(afterMove, 0);
          },
        });
        return;
      }
      if (move(g, from, to)) afterMove();
      else {
        sel = null;
        render();
        notAllowed();
      }
    }

    function onClick(el) {
      if (g.won) return;
      var at = el && parse(el.getAttribute("data-hit"));
      if (!at) {
        sel = null;
        render();
        return;
      }
      if (!sel) {
        if (at.type === "col" && g.cols[at.i].length) sel = { type: "col", i: at.i };
        else if (at.type === "cell" && g.cells[at.i]) sel = { type: "cell", i: at.i };
        render();
        return;
      }
      if (at.type === sel.type && at.i === sel.i) {
        sel = null;
        render();
        return;
      }
      var from = { type: sel.type, i: sel.i };
      if (at.type === "cell" && g.cells[at.i]) {
        sel = { type: "cell", i: at.i };
        render();
        return;
      }
      tryMove(from, { type: at.type, i: at.i });
    }

    // A double click sends a column's bottom card to a free cell.
    function onDouble(el) {
      if (g.won) return;
      var at = el && parse(el.getAttribute("data-hit"));
      sel = null;
      if (!at || at.type !== "col" || !g.cols[at.i].length) return render();
      var free = g.cells.indexOf(null);
      if (free === -1) {
        render();
        return notAllowed();
      }
      move(g, { type: "col", i: at.i }, { type: "cell", i: free });
      afterMove();
    }

    var drag = Cards.dragController(board, {
      scale: function () {
        return lay ? lay.fit.scale : 1;
      },
      pick: function (el) {
        if (g.won) return null;
        var at = parse(el.getAttribute("data-hit"));
        if (!at) return null;
        if (at.type === "cell" && g.cells[at.i] && el.classList.contains("card")) {
          return { els: [el], payload: { type: "cell", i: at.i } };
        }
        if (at.type === "col" && at.index !== undefined) {
          if (!runFrom(g.cols[at.i], at.index)) return null;
          var els = Array.prototype.slice
            .call(board.querySelectorAll('[data-pile="c' + at.i + '"]'))
            .filter(function (c) {
              return Number(c.getAttribute("data-index")) >= at.index;
            });
          return { els: els, payload: { type: "col", i: at.i, index: at.index } };
        }
        return null;
      },
      drop: function (from, rect) {
        var target = Cards.bestTarget(board, rect, function (id) {
          var to = parse(id);
          return !!plan(g, from, to.type === "home" ? { type: "home" } : { type: to.type, i: to.i });
        });
        if (!target) return false;
        var to = parse(target);
        sel = null;
        move(g, from, to.type === "home" ? { type: "home" } : { type: to.type, i: to.i });
        afterMove();
        return true;
      },
      click: onClick,
      dblclick: onDouble,
    });

    board.addEventListener("pointermove", function (e) {
      var r = board.getBoundingClientRect();
      var left = e.clientX < r.left + r.width / 2;
      if (left !== lookLeft) {
        lookLeft = left;
        var k = board.querySelector(".fc-king");
        if (k) k.classList.toggle("right", !left);
      }
    });

    // ---- dialogs

    function selectGame() {
      resignThen(function () {
        win.dialog({
          title: "Game Number",
          body:
            '<div class="dlg-form"><label><span>Select a game number<br/>from 1 to 32000:</span>' +
            '<input class="field95" type="number" min="1" max="32000" value="' + randomGame() + '"/></label></div>',
          buttons: [
            { label: "OK", value: "ok", isDefault: true },
            { label: "Cancel", value: "cancel", isCancel: true },
          ],
          onClose: function (v, d) {
            if (v !== "ok") return;
            var n = Math.floor(Number(d.querySelector("input").value));
            if (!(n >= 1 && n <= 32000)) n = randomGame();
            setTimeout(function () { start(n); }, 0);
          },
        });
      });
    }

    function showStats() {
      var total = stats.won + stats.lost;
      var pct = function (w, t) {
        return t ? Math.round((100 * w) / t) + "%" : "0%";
      };
      var body =
        '<table class="dlg-table">' +
        "<tr><th>This session:</th><td>" + pct(session.won, session.won + session.lost) + "</td><td>" + session.won + " won, " + session.lost + " lost</td></tr>" +
        "<tr><th>Total:</th><td>" + pct(stats.won, total) + "</td><td>" + stats.won + " won, " + stats.lost + " lost</td></tr>" +
        "<tr><th>Streaks:</th><td></td><td>Wins: " + stats.bestWins + ", Losses: " + stats.bestLosses + "</td></tr>" +
        "<tr><th>Current:</th><td></td><td>" + stats.streak + " " + (stats.streakType === "won" ? (stats.streak === 1 ? "win" : "wins") : stats.streak === 1 ? "loss" : "losses") + "</td></tr>" +
        "</table>";
      win.dialog({
        title: "FreeCell Statistics",
        body: body,
        buttons: [
          { label: "OK", value: "ok", isDefault: true, isCancel: true },
          { label: "<u>C</u>lear", value: "clear" },
        ],
        onClose: function (v) {
          if (v !== "clear") return;
          stats = { won: 0, lost: 0, streak: 0, streakType: "", bestWins: 0, bestLosses: 0 };
          session = { won: 0, lost: 0 };
          store.set("freecell.stats", stats);
          setTimeout(showStats, 0);
        },
      });
    }

    function about() {
      win.message(
        "<b>FreeCell</b><br/><br/>Move every card to the four home cells, building each suit up from the Ace. " +
          "On the table, build down in alternating colours. The four free cells each hold one card.<br/><br/>" +
          "Click a column, then where it should go -- or drag. Double-click a card to put it in a free cell.<br/><br/>" +
          "Part of docxDiff. Everything runs in this browser.",
        { title: "About FreeCell" },
      );
    }

    win.setMenus([
      {
        label: "<u>G</u>ame",
        items: function () {
          return [
            { label: "<u>N</u>ew Game", key: "F2", action: function () { resignThen(function () { start(randomGame()); }); } },
            { label: "<u>S</u>elect Game…", key: "F3", action: selectGame },
            { label: "<u>R</u>estart Game", disabled: !g.moves, action: function () { start(g.game); } },
            "-",
            { label: "S<u>t</u>atistics…", key: "F4", action: showStats },
            { label: "<u>U</u>ndo", key: "F10", disabled: !g.history.length || g.won, action: function () { if (undo(g)) { sel = null; render(); } } },
            "-",
            { label: "E<u>x</u>it", action: function () { win.close(); } },
          ];
        },
      },
      { label: "<u>H</u>elp", items: [{ label: "<u>A</u>bout FreeCell…", key: "F1", action: about }] },
    ]);

    start(randomGame());

    return {
      onResize: function () {
        if (!drag.busy()) render();
      },
      onKey: function (e) {
        var k = e.key;
        if (k === "F2") {
          e.preventDefault();
          resignThen(function () { start(randomGame()); });
        } else if (k === "F3") {
          e.preventDefault();
          selectGame();
        } else if (k === "F4") {
          e.preventDefault();
          showStats();
        } else if (k === "F10" || ((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z"))) {
          e.preventDefault();
          if (undo(g)) {
            sel = null;
            render();
          }
        } else if (k === "F1") {
          e.preventDefault();
          about();
        }
      },
      destroy: function () {
        drag.cancel();
      },
      state: function () {
        return g;
      },
    };
  }

  if (Win95.registerGame) {
    Win95.registerGame({
      id: "freecell",
      title: "FreeCell",
      icon: ICON,
      width: 680,
      height: 500,
      minWidth: 320,
      minHeight: 260,
      create: createGame,
    });
  }
})();
