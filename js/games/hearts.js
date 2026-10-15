/*
 * Hearts, as Windows 95 shipped it: you against three computer players,
 * passing three cards left, right, across, then keeping; the Two of Clubs
 * leads; no points on the first trick; hearts cannot be led until they are
 * broken; the Queen of Spades is 13; shooting the moon gives everyone else 26;
 * the game ends when someone reaches 100, and the lowest score wins.
 *
 * The rules and the computer players are plain functions over a state object
 * (Win95.rules.hearts), so the tests can play thousands of hands.
 */
(function () {
  "use strict";

  var Win95 = (window.Win95 = window.Win95 || {});
  var Cards = Win95.Cards;

  // ---------------------------------------------------------------- rules

  // Seats, in the order play goes round (clockwise): you, then West, North, East.
  var NAMES = ["You", "Pauline", "Michele", "Ben"];
  var PASS = ["left", "right", "across", "none"];
  var SUIT_ORDER = { C: 0, D: 1, S: 2, H: 3 };

  function value(card) {
    return card.rank === 1 ? 14 : card.rank;
  }
  function isQS(card) {
    return card.suit === "S" && card.rank === 12;
  }
  function points(card) {
    return card.suit === "H" ? 1 : isQS(card) ? 13 : 0;
  }
  function same(a, b) {
    return a.suit === b.suit && a.rank === b.rank;
  }
  function sortHand(hand) {
    return hand.sort(function (a, b) {
      return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || value(a) - value(b);
    });
  }

  function passTarget(p, dir) {
    return dir === "left" ? (p + 1) % 4 : dir === "right" ? (p + 3) % 4 : dir === "across" ? (p + 2) % 4 : p;
  }

  function shuffled(rand) {
    rand = rand || Math.random;
    var deck = [];
    ["C", "D", "H", "S"].forEach(function (suit) {
      for (var r = 1; r <= 13; r++) deck.push({ rank: r, suit: suit });
    });
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    return deck;
  }

  function newHand(handNo, rand) {
    var deck = shuffled(rand);
    var hands = [0, 1, 2, 3].map(function (p) {
      return sortHand(deck.slice(p * 13, p * 13 + 13));
    });
    var dir = PASS[handNo % 4];
    return {
      handNo: handNo,
      passDir: dir,
      hands: hands,
      taken: [[], [], [], []],
      played: [],
      trick: [],
      leader: -1,
      turn: -1,
      trickNo: 0,
      heartsBroken: false,
      phase: dir === "none" ? "play" : "pass",
    };
  }

  /** picks[p] is the three cards seat p passes. Returns what each seat received. */
  function applyPass(s, picks) {
    var received = [[], [], [], []];
    picks.forEach(function (cards, p) {
      cards.forEach(function (c) {
        var idx = s.hands[p].findIndex(function (h) {
          return same(h, c);
        });
        if (idx === -1) throw new Error("seat " + p + " does not hold that card");
        s.hands[p].splice(idx, 1);
      });
    });
    picks.forEach(function (cards, p) {
      var to = passTarget(p, s.passDir);
      cards.forEach(function (c) {
        s.hands[to].push({ rank: c.rank, suit: c.suit });
        received[to].push({ rank: c.rank, suit: c.suit });
      });
    });
    s.hands.forEach(sortHand);
    s.phase = "play";
    return received;
  }

  function startPlay(s) {
    for (var p = 0; p < 4; p++) {
      if (s.hands[p].some(function (c) { return c.suit === "C" && c.rank === 2; })) {
        s.leader = s.turn = p;
      }
    }
    s.phase = "play";
  }

  /** The cards seat p may play now. */
  function legalPlays(s, p) {
    var hand = s.hands[p];
    if (!s.trick.length) {
      if (s.trickNo === 0) {
        return hand.filter(function (c) {
          return c.suit === "C" && c.rank === 2;
        });
      }
      if (!s.heartsBroken) {
        var nonHearts = hand.filter(function (c) {
          return c.suit !== "H";
        });
        if (nonHearts.length) return nonHearts;
      }
      return hand.slice();
    }
    var led = s.trick[0].card.suit;
    var follow = hand.filter(function (c) {
      return c.suit === led;
    });
    if (follow.length) return follow;
    if (s.trickNo === 0) {
      // No points on the first trick, unless there is nothing else to play.
      var clean = hand.filter(function (c) {
        return !points(c);
      });
      if (clean.length) return clean;
    }
    return hand.slice();
  }

  /** Why a card cannot be played, for the status bar; null if it can. */
  function whyNot(s, p, card) {
    if (legalPlays(s, p).some(function (c) { return same(c, card); })) return null;
    if (!s.trick.length) {
      if (s.trickNo === 0) return "You must lead the two of clubs.";
      return "Hearts have not been broken yet.";
    }
    var led = s.trick[0].card.suit;
    if (s.hands[p].some(function (c) { return c.suit === led; })) return "You must follow suit.";
    return "You can't play points on the first trick.";
  }

  function play(s, p, card) {
    if (s.phase !== "play" || s.turn !== p || s.trick.length === 4) throw new Error("not seat " + p + "'s turn");
    if (!legalPlays(s, p).some(function (c) { return same(c, card); })) throw new Error("illegal play");
    var idx = s.hands[p].findIndex(function (c) {
      return same(c, card);
    });
    var c = s.hands[p].splice(idx, 1)[0];
    s.trick.push({ p: p, card: c });
    s.played.push(c);
    if (c.suit === "H") s.heartsBroken = true;
    s.turn = (p + 1) % 4;
  }

  function trickWinner(trick) {
    var led = trick[0].card.suit;
    var best = trick[0];
    trick.forEach(function (t) {
      if (t.card.suit === led && value(t.card) > value(best.card)) best = t;
    });
    return best.p;
  }

  /** Gather a finished trick. Returns the winner. */
  function collect(s) {
    var w = trickWinner(s.trick);
    s.trick.forEach(function (t) {
      s.taken[w].push(t.card);
    });
    s.trick = [];
    s.leader = s.turn = w;
    s.trickNo++;
    if (s.trickNo === 13) s.phase = "done";
    return w;
  }

  /** Points for the hand, with the moon shot: { points: [4], moon: seat or -1 }. */
  function handScore(s) {
    var pts = s.taken.map(function (cards) {
      return cards.reduce(function (n, c) {
        return n + points(c);
      }, 0);
    });
    var moon = pts.indexOf(26);
    if (moon !== -1) {
      pts = pts.map(function (v, p) {
        return p === moon ? 0 : 26;
      });
    }
    return { points: pts, moon: moon };
  }

  function gameOver(scores) {
    return scores.some(function (v) {
      return v >= 100;
    });
  }

  function winners(scores) {
    var low = Math.min.apply(null, scores);
    return scores
      .map(function (v, p) {
        return v === low ? p : -1;
      })
      .filter(function (p) {
        return p !== -1;
      });
  }

  // ---- the computer players

  function choosePass(hand) {
    var spades = hand.filter(function (c) {
      return c.suit === "S";
    }).length;
    function danger(c) {
      var v = value(c);
      var inSuit = hand.filter(function (h) {
        return h.suit === c.suit;
      }).length;
      if (isQS(c)) return 200;
      if (c.suit === "S") return v > 12 ? (spades <= 4 ? 150 + v : 40 + v) : v - 20;
      if (c.suit === "C" && c.rank === 2) return -100;
      return v * 3 - inSuit * 2 + (c.suit === "H" ? 6 : 0);
    }
    return hand
      .slice()
      .sort(function (a, b) {
        return danger(b) - danger(a);
      })
      .slice(0, 3);
  }

  function maxBy(cards, f) {
    return cards.reduce(function (a, b) {
      return f(b) > f(a) ? b : a;
    });
  }
  function minBy(cards, f) {
    return cards.reduce(function (a, b) {
      return f(b) < f(a) ? b : a;
    });
  }

  function choosePlay(s, p) {
    var legal = legalPlays(s, p);
    if (legal.length === 1) return legal[0];
    var hand = s.hands[p];
    var queenOut = !s.played.some(isQS) && !hand.some(isQS);
    var holdQueen = hand.some(isQS);
    var notQ = function (cards) {
      var rest = cards.filter(function (c) {
        return !isQS(c);
      });
      return rest.length ? rest : cards;
    };

    if (!s.trick.length) {
      // Lead low, in a suit that will not come back to bite.
      return minBy(legal, function (c) {
        var cost = value(c);
        if (c.suit === "H") cost += 20;
        if (c.suit === "S" && (holdQueen || (queenOut && value(c) > 12))) cost += 30;
        if (isQS(c)) cost += 100;
        return cost;
      });
    }

    var led = s.trick[0].card.suit;
    var winning = s.trick.reduce(function (best, t) {
      return t.card.suit === led && value(t.card) > best ? value(t.card) : best;
    }, 0);
    var trickPts = s.trick.reduce(function (n, t) {
      return n + points(t.card);
    }, 0);
    var follow = legal.filter(function (c) {
      return c.suit === led;
    });

    if (follow.length) {
      var under = follow.filter(function (c) {
        return value(c) < winning;
      });
      // Duck with the highest card that still loses (the Queen, if she can).
      if (under.length) return maxBy(under, value);
      if (s.trick.length === 3 && trickPts === 0) return maxBy(notQ(follow), value);
      return minBy(notQ(follow), value);
    }

    // Nothing in the suit led: unload.
    var qs = legal.find(isQS);
    if (qs) return qs;
    if (queenOut) {
      var big = legal.filter(function (c) {
        return c.suit === "S" && value(c) > 12;
      });
      if (big.length) return maxBy(big, value);
    }
    var hearts = legal.filter(function (c) {
      return c.suit === "H";
    });
    if (hearts.length) return maxBy(hearts, value);
    return maxBy(legal, function (c) {
      var inSuit = hand.filter(function (h) {
        return h.suit === c.suit;
      }).length;
      return value(c) * 2 - inSuit;
    });
  }

  var rules = {
    NAMES: NAMES,
    passTarget: passTarget,
    newHand: newHand,
    applyPass: applyPass,
    startPlay: startPlay,
    legalPlays: legalPlays,
    whyNot: whyNot,
    play: play,
    trickWinner: trickWinner,
    collect: collect,
    handScore: handScore,
    gameOver: gameOver,
    winners: winners,
    choosePass: choosePass,
    choosePlay: choosePlay,
    points: points,
  };
  Win95.rules = Win95.rules || {};
  Win95.rules.hearts = rules;

  // ---------------------------------------------------------------- game window

  var ICON =
    '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">' +
    '<path d="M2.5 2.5h8v11h-8z" fill="#fff" stroke="#000"/>' +
    '<path d="M8 4c1-2 4-2 5 0s0 4-5 8c-5-4-6-6-5-8s4-2 5 0z" fill="#d40000" stroke="#000" stroke-width=".7"/></svg>';

  function createGame(win) {
    var s = null;
    var scores = [0, 0, 0, 0];
    var sheet = []; // points per hand
    var picks = []; // the three cards you have chosen to pass
    var received = []; // the cards passed to you, shown raised until you accept
    var aiPicks = null;
    var accepting = false;
    var token = 0; // invalidates pending timers on a new game
    var timers = [];
    var lay = null;
    var message = "";
    // Play moves round the table on one chain of timers. Your card is taken
    // only when that chain has stopped to wait for it; a click in the pause
    // after a trick would otherwise start a second chain.
    var yourTurn = false;

    win.body.innerHTML = '<div class="card-host"><div class="card-board hearts"></div></div>';
    var host = win.body.querySelector(".card-host");
    var board = host.querySelector(".card-board");
    var status = win.statusBar(1);

    function later(fn, ms) {
      var t = token;
      timers.push(
        setTimeout(function () {
          if (t === token) fn();
        }, ms),
      );
    }
    function cancelTimers() {
      token++;
      timers.forEach(clearTimeout);
      timers = [];
    }

    function say(text) {
      message = text;
      status[0].textContent = text;
    }

    function newGame() {
      cancelTimers();
      yourTurn = false;
      scores = [0, 0, 0, 0];
      sheet = [];
      startHand(0);
    }

    function startHand(n) {
      s = newHand(n);
      yourTurn = false;
      picks = [];
      received = [];
      accepting = false;
      if (s.passDir === "none") {
        startPlay(s);
        say("There is no passing this hand.");
        render();
        later(step, 900);
        return;
      }
      aiPicks = [null, 1, 2, 3].map(function (p) {
        return p === null ? null : choosePass(s.hands[p]);
      });
      say("Select three cards to pass " + (s.passDir === "across" ? "across" : "to the " + s.passDir) + ".");
      render();
    }

    function passLabel() {
      return { left: "Pass Left", right: "Pass Right", across: "Pass Across" }[s.passDir];
    }

    // ---- layout

    function layout() {
      var fit = Cards.fitBoard(host, board, 600, 440);
      var W = fit.width;
      var H = fit.height;
      var cx = W / 2;
      // Midway between North's hand and yours.
      var cy = (10 + 96 + 4 + (H - 96 - 10 - 18)) / 2;
      return {
        fit: fit,
        W: W,
        H: H,
        cx: cx,
        cy: cy,
        // Where each seat's card lands in the middle.
        trick: [
          [cx - 35.5, cy + 2],
          [cx - 35.5 - 80, cy - 48],
          [cx - 35.5, cy - 98],
          [cx - 35.5 + 80, cy - 48],
        ],
      };
    }

    function render() {
      lay = layout();
      var L = lay;
      var html = [];

      // Your hand, along the bottom.
      var mine = s.hands[0];
      var step = Math.min(28, (L.W - 120 - 71) / Math.max(1, mine.length - 1));
      var x0 = (L.W - ((mine.length - 1) * step + 71)) / 2;
      var baseY = L.H - 96 - 10;
      mine.forEach(function (c, i) {
        var up =
          picks.some(function (p) { return same(p, c); }) ||
          received.some(function (r) { return same(r, c); });
        html.push(
          Cards.cardHTML(c, {
            x: Math.round(x0 + i * step),
            y: baseY - (up ? 18 : 0),
            z: i + 1,
            attrs: ' data-hit="h' + i + '"',
          }),
        );
      });

      // The others' hands, face down: West and East sideways, North across the top.
      var n = s.hands[2].length;
      var nx0 = (L.W - ((n - 1) * 13 + 71)) / 2;
      for (var k = 0; k < n; k++) {
        html.push(Cards.cardHTML(s.hands[2][k], { x: Math.round(nx0 + k * 13), y: 10, z: k + 1, faceDown: true, back: "weave" }));
      }
      [1, 3].forEach(function (p) {
        var cnt = s.hands[p].length;
        var y0 = L.cy - ((cnt - 1) * 13 + 71) / 2 + 12;
        for (var j = 0; j < cnt; j++) {
          // A card turned on its side: the box is 96 wide and 71 high.
          var x = p === 1 ? 14 : L.W - 14 - 96;
          html.push(
            Cards.cardHTML(s.hands[p][j], {
              x: Math.round(x + 12.5),
              y: Math.round(y0 + j * 13 - 12.5),
              z: j + 1,
              faceDown: true,
              back: "weave",
              cls: "sideways",
            }),
          );
        }
      });

      // Names.
      var handRight = x0 + (mine.length - 1) * step + 71;
      html.push('<div class="hn-name" style="left:' + Math.round(handRight + 10) + "px;top:" + (baseY + 40) + 'px;text-align:left">' + nameWithScore(0) + "</div>");
      html.push('<div class="hn-name" style="left:' + (14 + 96 + 10) + "px;top:" + (L.cy - 8) + 'px;text-align:left">' + nameWithScore(1) + "</div>");
      html.push('<div class="hn-name" style="left:' + Math.round(nx0 + (n - 1) * 13 + 71 + 10) + 'px;top:50px;text-align:left">' + nameWithScore(2) + "</div>");
      html.push('<div class="hn-name" style="left:' + (L.W - 14 - 96 - 10 - 120) + "px;top:" + (L.cy - 8) + 'px;text-align:right">' + nameWithScore(3) + "</div>");

      // The trick.
      s.trick.forEach(function (t, i) {
        var at = L.trick[t.p];
        html.push(Cards.cardHTML(t.card, { x: Math.round(at[0]), y: Math.round(at[1]), z: 100 + i }));
      });

      // The pass / accept button.
      if (s.phase === "pass" || accepting) {
        var label = accepting ? "OK" : passLabel();
        var ready = accepting || picks.length === 3;
        html.push(
          '<button class="btn95 hn-pass' + (ready ? " default" : "") + '" style="left:' + (L.cx - 50) + "px;top:" + (L.cy - 12) + 'px"' +
            (ready ? "" : " disabled") + '><span class="btn-label">' + label + "</span></button>",
        );
      }

      board.innerHTML = html.join("");
      status[0].textContent = message;
    }

    function nameWithScore(p) {
      return Win95.esc(NAMES[p]) + '<span class="hn-score">' + scores[p] + "</span>";
    }

    // ---- play

    function step() {
      if (s.phase === "done") return endHand();
      if (s.trick.length === 4) {
        later(function () {
          var w = collect(s);
          say(w === 0 ? "You won the trick." : NAMES[w] + " won the trick.");
          render();
          later(step, s.phase === "done" ? 400 : 350);
        }, 1000);
        return;
      }
      if (s.turn === 0) {
        yourTurn = true;
        if (s.trickNo === 0 && !s.trick.length) say("Click the two of clubs to begin.");
        else if (!s.trick.length) say("It's your lead.");
        else say("It's your turn.");
        render();
        return;
      }
      later(function () {
        play(s, s.turn, choosePlay(s, s.turn));
        render();
        step();
      }, 420);
    }

    function endHand() {
      var res = handScore(s);
      sheet.push(res.points);
      scores = scores.map(function (v, p) {
        return v + res.points[p];
      });
      render();
      var note =
        res.moon === -1
          ? ""
          : '<p class="dlg-text"><b>' + (res.moon === 0 ? "You shot the moon!" : Win95.esc(NAMES[res.moon]) + " shot the moon!") + "</b></p><br/>";
      showSheet(note, function () {
        if (gameOver(scores)) {
          var ws = winners(scores);
          var who = ws.map(function (p) { return NAMES[p]; });
          var text =
            ws.length === 1 && ws[0] === 0
              ? "You win!"
              : ws.indexOf(0) !== -1
                ? "You tie for the win with " + who.filter(function (n) { return n !== "You"; }).join(" and ") + "."
                : who.join(" and ") + (ws.length === 1 ? " wins." : " win.");
          win.message(text + "<br/><br/>Do you want to play again?", {
            title: "Game Over",
            icon: ws.indexOf(0) !== -1 ? "info" : "warning",
            buttons: [
              { label: "<u>Y</u>es", value: "yes", isDefault: true },
              { label: "<u>N</u>o", value: "no", isCancel: true },
            ],
            onClose: function (v) {
              if (v === "yes") setTimeout(newGame, 0);
              else say("Game over. Press F2 for a new game.");
            },
          });
        } else {
          startHand(s.handNo + 1);
        }
      });
    }

    function showSheet(note, then) {
      var head = "<tr><th></th>" + NAMES.map(function (n) { return "<th>" + Win95.esc(n) + "</th>"; }).join("") + "</tr>";
      var rows = sheet
        .map(function (pts, i) {
          return "<tr><td>Hand " + (i + 1) + "</td>" + pts.map(function (v) { return "<td>" + v + "</td>"; }).join("") + "</tr>";
        })
        .join("");
      var total = "<tr class=\"total\"><td>Total</td>" + scores.map(function (v) { return "<td>" + v + "</td>"; }).join("") + "</tr>";
      win.dialog({
        title: "Score",
        body: (note || "") + '<div class="hn-sheet"><table class="dlg-table">' + head + rows + total + "</table></div>",
        buttons: [{ label: "OK", value: "ok", isDefault: true, isCancel: true }],
        onClose: function () {
          if (then) setTimeout(then, 0);
        },
      });
    }

    function onBoardClick(e) {
      if (e.target.closest(".hn-pass")) {
        var btn = e.target.closest(".hn-pass");
        if (btn.disabled) return;
        if (accepting) {
          accepting = false;
          received = [];
          startPlay(s);
          render();
          step();
          return;
        }
        received = applyPass(s, [picks].concat(aiPicks.slice(1)))[0];
        picks = [];
        accepting = true;
        say("Click OK to accept the cards passed to you.");
        render();
        return;
      }
      var el = e.target.closest("[data-hit]");
      if (!el) return;
      var card = s.hands[0][Number(el.getAttribute("data-hit").slice(1))];
      if (!card) return;
      if (s.phase === "pass" && !accepting) {
        var at = picks.findIndex(function (p) { return same(p, card); });
        if (at !== -1) picks.splice(at, 1);
        else if (picks.length < 3) picks.push(card);
        render();
        return;
      }
      if (!yourTurn || s.phase !== "play" || accepting || s.turn !== 0 || s.trick.length === 4) return;
      var why = whyNot(s, 0, card);
      if (why) {
        say(why);
        return;
      }
      yourTurn = false;
      play(s, 0, card);
      say("");
      render();
      step();
    }

    board.addEventListener("click", onBoardClick);

    function about() {
      win.message(
        "<b>Hearts</b><br/><br/>Avoid taking hearts (1 point each) and the Queen of Spades (13). " +
          "Take all of them and everyone else gets 26 instead. The game ends when someone reaches 100; " +
          "the lowest score wins.<br/><br/>Pauline, Michele and Ben are played by this page.<br/><br/>" +
          "Part of docxDiff. Everything runs in this browser.",
        { title: "About Hearts" },
      );
    }

    win.setMenus([
      {
        label: "<u>G</u>ame",
        items: [
          { label: "<u>N</u>ew Game", key: "F2", action: newGame },
          "-",
          { label: "<u>S</u>core…", key: "F4", action: function () { showSheet("", null); } },
          "-",
          { label: "E<u>x</u>it", action: function () { win.close(); } },
        ],
      },
      { label: "<u>H</u>elp", items: [{ label: "<u>A</u>bout Hearts…", key: "F1", action: about }] },
    ]);

    newGame();

    return {
      onResize: function () {
        render();
      },
      onKey: function (e) {
        if (e.key === "F2") {
          e.preventDefault();
          newGame();
        } else if (e.key === "F4") {
          e.preventDefault();
          showSheet("", null);
        } else if (e.key === "F1") {
          e.preventDefault();
          about();
        }
      },
      destroy: cancelTimers,
      state: function () {
        return s;
      },
    };
  }

  if (Win95.registerGame) {
    Win95.registerGame({
      id: "hearts",
      title: "Hearts",
      icon: ICON,
      width: 700,
      height: 540,
      minWidth: 320,
      minHeight: 280,
      create: createGame,
    });
  }
})();
