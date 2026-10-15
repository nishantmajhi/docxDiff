"use strict";

// The games in the Start menu: Minesweeper, Solitaire, FreeCell and Hearts.
//
// Each game file keeps its rules apart from its window, as plain functions on
// Win95.rules.<game>. The files are loaded here into a node:vm context with a
// bare `window` and no document, which is all the rules need; the windows
// themselves are driven in tests/browser/driver.js.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { ROOT } = require("./harness.js");

const FILES = ["cards", "minesweeper", "solitaire", "freecell", "hearts"];

function load(extra) {
  const window = Object.assign({}, extra || {});
  const ctx = vm.createContext({ window, Math, JSON, Error, Promise, Object, Array, String, Number });
  window.window = window;
  for (const f of FILES) {
    const file = path.join(ROOT, "js", "games", f + ".js");
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  }
  return window.Win95;
}

const W = load();
const MS = W.rules.minesweeper;
const SOL = W.rules.solitaire;
const FC = W.rules.freecell;
const HE = W.rules.hearts;

// Values built inside the vm context have that context's Array and Object,
// which deepStrictEqual tells apart from this one's; compare them as data.
const plain = (x) => JSON.parse(JSON.stringify(x));
const eq = (actual, expected, message) => assert.deepStrictEqual(plain(actual), plain(expected), message);

// A repeatable stand-in for Math.random.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const card = (text) => {
  const m = /^(10|[2-9AJQKT])([CDHS])$/.exec(text);
  const rank = { A: 1, T: 10, J: 11, Q: 12, K: 13 }[m[1]] || Number(m[1]);
  return { rank, suit: m[2] };
};
const named = (c) => (({ 1: "A", 10: "T", 11: "J", 12: "Q", 13: "K" })[c.rank] || String(c.rank)) + c.suit;

// ---------------------------------------------------------------- registration

test("every game registers itself with an id, a title, an icon and a window", () => {
  const defs = [];
  load({ Win95: { registerGame: (d) => defs.push(d) } });
  eq(defs.map((d) => d.id).sort(), ["freecell", "hearts", "minesweeper", "solitaire"]);
  for (const d of defs) {
    assert.ok(d.title && typeof d.title === "string", d.id);
    assert.ok(/^<svg[\s\S]*<\/svg>$/.test(d.icon), d.id + " has an inline icon");
    assert.strictEqual(typeof d.create, "function", d.id);
  }
  assert.strictEqual(defs.find((d) => d.id === "minesweeper").resizable, false, "Minesweeper's window fits its field");
});

test("the Start menu lists every game, with Start over below them", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const menu = html.slice(html.indexOf('id="start-menu"'), html.indexOf('id="game-tasks"'));
  const games = [...menu.matchAll(/data-game="(\w+)"/g)].map((m) => m[1]);
  eq(games, ["freecell", "hearts", "minesweeper", "solitaire"]);
  assert.ok(menu.indexOf('id="reset-btn"') > menu.lastIndexOf("data-game="), "Start over comes last");
});

// ---------------------------------------------------------------- cards

test("every card face is a complete SVG at 71 by 96", () => {
  for (const suit of W.Cards.SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      const svg = W.Cards.faceSVG({ rank, suit });
      assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 71 96"'), named({ rank, suit }));
      assert.ok(svg.endsWith("</svg>"));
      assert.strictEqual((svg.match(/<svg/g) || []).length, (svg.match(/<\/svg>/g) || []).length);
    }
  }
});

test("a deck is 52 different cards, and a shuffle keeps them all", () => {
  const deck = W.Cards.shuffle(W.Cards.newDeck(), seeded(7));
  assert.strictEqual(deck.length, 52);
  assert.strictEqual(new Set(deck.map(named)).size, 52);
});

// ---------------------------------------------------------------- Minesweeper

test("Minesweeper has the three Windows levels", () => {
  eq(
    Object.entries(MS.LEVELS).map(([k, v]) => [k, v.w, v.h, v.m]),
    [["beginner", 9, 9, 10], ["intermediate", 16, 16, 40], ["expert", 30, 16, 99]],
  );
});

test("the custom field is held to the dialog's limits", () => {
  eq(MS.clampCustom(2, 100, 5000), { w: 30, h: 9, m: 8 * 29 });
  eq(MS.clampCustom(30, 5, 1), { w: 9, h: 24, m: 10 });
  eq(MS.clampCustom("abc", "", "x"), { w: 9, h: 9, m: 10 });
});

test("the first click never finds a mine, however many tries", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const s = MS.create(9, 9, 10);
    const first = (seed * 7) % 81;
    assert.notStrictEqual(MS.reveal(s, first, seeded(seed)), "boom");
    assert.strictEqual(s.cells.filter((c) => c.mine).length, 10);
    assert.ok(!s.cells[first].mine);
  }
});

test("opening a square with no mines around it opens the whole empty region", () => {
  const s = MS.create(9, 9, 10);
  MS.placeMines(s, -1, () => 0); // every mine as far up the board as it goes
  const mines = s.cells.map((c, i) => (c.mine ? i : -1)).filter((i) => i >= 0);
  eq(mines, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.strictEqual(MS.reveal(s, 80), "ok");
  // Everything but the mines and the row of numbers under them is open.
  assert.strictEqual(s.opened, 81 - 10);
  assert.ok(s.won && s.over, "and that was every safe square");
  assert.ok(s.cells.filter((c) => c.mine).every((c) => c.mark === 1), "a win flags every mine");
});

test("a mine ends the game; a flag protects its square", () => {
  const s = MS.create(9, 9, 10);
  MS.placeMines(s, -1, () => 0);
  assert.ok(MS.toggleMark(s, 0, true));
  assert.strictEqual(s.cells[0].mark, 1);
  assert.strictEqual(s.flags, 1);
  s.placed = true;
  assert.strictEqual(MS.reveal(s, 0), "noop", "a flagged square does not open");
  assert.strictEqual(MS.reveal(s, 1), "boom");
  assert.ok(s.over && !s.won);
  assert.strictEqual(s.exploded, 1);
});

test("right clicks go flag, question mark, nothing -- or skip the mark", () => {
  const s = MS.create(9, 9, 10);
  MS.toggleMark(s, 40, true);
  MS.toggleMark(s, 40, true);
  assert.strictEqual(s.cells[40].mark, 2);
  assert.strictEqual(s.flags, 0, "a question mark is not a flag");
  MS.toggleMark(s, 40, true);
  assert.strictEqual(s.cells[40].mark, 0);
  MS.toggleMark(s, 40, false);
  MS.toggleMark(s, 40, false);
  assert.strictEqual(s.cells[40].mark, 0, "with Marks off, a flag goes straight back to nothing");
});

// A 9 x 9 field with mines exactly where given.
function field(mines) {
  const s = MS.create(9, 9, mines.length);
  mines.forEach((i) => (s.cells[i].mine = true));
  s.cells.forEach((c, i) => (c.adj = MS.neighbors(s, i).filter((n) => s.cells[n].mine).length));
  s.placed = true;
  return s;
}

test("chording opens the neighbours once the flags match the number", () => {
  // Mines at the first and third squares of the top row; square 10 sits
  // below and between them.
  const s = field([0, 2]);
  assert.strictEqual(MS.reveal(s, 10), "ok");
  assert.strictEqual(s.cells[10].adj, 2);
  assert.strictEqual(MS.chord(s, 10), "noop", "no flags yet");
  MS.toggleMark(s, 0, true);
  MS.toggleMark(s, 2, true);
  assert.strictEqual(MS.chord(s, 10), "ok");
  for (const i of [1, 9, 11, 18, 19, 20]) assert.ok(s.cells[i].open, "square " + i + " opened");
});

test("chording on a wrong flag sets the mine off", () => {
  const s = field([0, 2]);
  MS.reveal(s, 10);
  MS.toggleMark(s, 0, true);
  MS.toggleMark(s, 1, true); // wrong: 2 is the mine
  assert.strictEqual(MS.chord(s, 10), "boom");
  assert.strictEqual(s.exploded, 2);
});

// ---------------------------------------------------------------- Solitaire

function solGame(opts) {
  return SOL.deal(Object.assign({ draw: 1, scoring: "standard", timed: false }, opts || {}), seeded(3));
}

test("Solitaire deals seven piles of one to seven with the top card up", () => {
  const g = solGame();
  eq(g.tableau.map((p) => p.length), [1, 2, 3, 4, 5, 6, 7]);
  g.tableau.forEach((p) => {
    p.forEach((c, i) => assert.strictEqual(c.up, i === p.length - 1));
  });
  assert.strictEqual(g.stock.length, 24);
  const all = g.stock.concat(...g.tableau);
  assert.strictEqual(new Set(all.map(named)).size, 52);
});

test("Draw Three turns three; the waste turns back over when the stock runs out", () => {
  const g = solGame({ draw: 3 });
  SOL.drawCards(g);
  assert.strictEqual(g.waste.length, 3);
  assert.strictEqual(g.fan, 3);
  for (let i = 0; i < 7; i++) SOL.drawCards(g);
  assert.strictEqual(g.stock.length, 0);
  assert.strictEqual(g.waste.length, 24);
  assert.ok(SOL.canRecycle(g));
  SOL.drawCards(g);
  assert.strictEqual(g.stock.length, 24);
  assert.strictEqual(g.passes, 1);
});

test("Draw One costs 100 points to go through the deck again", () => {
  const g = solGame({ draw: 1 });
  g.score = 150;
  while (g.stock.length) SOL.drawCards(g);
  SOL.drawCards(g);
  assert.strictEqual(g.score, 50);
});

test("Vegas: $52 a deal, $5 a card home, and one pass in Draw One", () => {
  const g = solGame({ scoring: "vegas", draw: 1 });
  assert.strictEqual(g.score, -52);
  while (g.stock.length) SOL.drawCards(g);
  assert.ok(!SOL.canRecycle(g), "no second pass");
  const three = solGame({ scoring: "vegas", draw: 3 });
  for (let pass = 0; pass < 2; pass++) {
    while (three.stock.length) SOL.drawCards(three);
    assert.ok(SOL.canRecycle(three), "pass " + (pass + 2) + " is allowed");
    SOL.drawCards(three);
  }
  while (three.stock.length) SOL.drawCards(three);
  assert.ok(!SOL.canRecycle(three), "but not a fourth");
  const carried = SOL.deal({ scoring: "vegas", carry: 40 }, seeded(1));
  assert.strictEqual(carried.score, -12, "Keep score carries the total into the next deal");
});

test("only alternating colours, one lower, stack -- and only a King fills a space", () => {
  assert.ok(SOL.canStack(card("9H"), [{ ...card("TS"), up: true }]));
  assert.ok(!SOL.canStack(card("9C"), [{ ...card("TS"), up: true }]));
  assert.ok(!SOL.canStack(card("8H"), [{ ...card("TS"), up: true }]));
  assert.ok(!SOL.canStack(card("9H"), [{ ...card("TS"), up: false }]));
  assert.ok(SOL.canStack(card("KD"), []));
  assert.ok(!SOL.canStack(card("QD"), []));
  assert.ok(SOL.canFound(card("AS"), []));
  assert.ok(SOL.canFound(card("2S"), [card("AS")]));
  assert.ok(!SOL.canFound(card("2H"), [card("AS")]));
});

test("moves score as Standard scoring says, and Undo takes them back", () => {
  const g = solGame();
  g.tableau = [[{ ...card("AS"), up: true }], [{ ...card("5C"), up: false }, { ...card("KH"), up: true }], [], [], [], [], []];
  g.waste = [{ ...card("QC"), up: true }];
  assert.ok(SOL.move(g, { pile: "waste" }, { pile: "t", i: 1 }));
  assert.strictEqual(g.score, 5, "waste to table");
  assert.ok(SOL.move(g, { pile: "t", i: 0, index: 0 }, { pile: "f", i: 0 }));
  assert.strictEqual(g.score, 15, "table to foundation");
  assert.ok(SOL.move(g, { pile: "t", i: 1, index: 1 }, { pile: "t", i: 0 }), "a King and what is on it move to the space");
  assert.ok(SOL.flip(g, 1));
  assert.strictEqual(g.score, 20, "turning a card over");
  assert.ok(SOL.move(g, { pile: "f", i: 0 }, { pile: "t", i: 2 }) === false, "an Ace cannot go to a space");
  SOL.undo(g);
  SOL.undo(g);
  assert.strictEqual(g.score, 15);
  eq(g.tableau[1].map(named), ["5C", "KH", "QC"]);
});

test("right-click sends everything possible home, as one step to undo", () => {
  const g = solGame();
  g.tableau = [[{ ...card("AH"), up: true }], [{ ...card("2H"), up: true }], [{ ...card("3H"), up: true }], [], [], [], []];
  g.waste = [{ ...card("AC"), up: true }];
  assert.strictEqual(SOL.autoPlay(g), 4);
  eq(g.foundations.map((f) => f.length).sort(), [0, 0, 1, 3]);
  SOL.undo(g);
  assert.strictEqual(g.foundations.every((f) => !f.length), true);
});

test("a timed Standard game loses 2 points every 10 seconds, and wins a bonus", () => {
  const g = solGame({ timed: true });
  g.score = 100;
  for (let i = 0; i < 30; i++) SOL.tick(g);
  assert.strictEqual(g.score, 94);
  assert.strictEqual(SOL.bonus(g), Math.round(700000 / 30));
  const quick = solGame({ timed: true });
  quick.time = 29;
  assert.strictEqual(SOL.bonus(quick), 0, "no bonus under 30 seconds");
});

test("the game is won when all four foundations are full", () => {
  const g = solGame();
  g.foundations = ["C", "D", "H", "S"].map((s) => Array.from({ length: 13 }, (_, r) => ({ rank: r + 1, suit: s, up: true })));
  const k = g.foundations[3].pop();
  g.tableau = [[k], [], [], [], [], [], []];
  assert.ok(!g.won);
  assert.ok(SOL.sendHome(g, { pile: "t", i: 0, index: 0 }));
  assert.ok(g.won);
});

// ---------------------------------------------------------------- FreeCell

function layout(cols) {
  const rows = [];
  for (let r = 0; r < 7; r++) {
    const row = cols.map((c) => c[r]).filter(Boolean).map(named);
    if (row.length) rows.push(row.join(" "));
  }
  return rows;
}

test("FreeCell deals game #1 exactly as Microsoft's FreeCell does", () => {
  eq(layout(FC.msDeal(1)), [
    "JD 2D 9H JC 5D 7H 7C 5H",
    "KD KC 9S 5S AD QC KH 3H",
    "2S KS 9D QD JS AS AH 3C",
    "4C 5C TS QH 4H AC 4D 7S",
    "3S TD 4S TH 8H 2C JH 7D",
    "6D 8S 8D QS 6C 3D 8C TC",
    "6S 9C 2H 6H",
  ]);
});

test("and game #617", () => {
  eq(layout(FC.msDeal(617)), [
    "7D AD 5C 3S 5S 8C 2D AH",
    "TD 7S QD AC 6D 8H AS KH",
    "TH QC 3H 9D 6S 8D 3D TC",
    "KD 5H 9S 3C 8S 7H 4D JS",
    "4C QS 9C 9H 7C 6H 2C 2S",
    "4S TS 2H 5D JC 6C JH QH",
    "JD KS KC 4H",
  ]);
});

function fcGame(cols, cells) {
  const g = FC.newGame(1);
  g.cols = cols.map((c) => c.map(card));
  while (g.cols.length < 8) g.cols.push([]);
  g.cells = (cells || [null, null, null, null]).map((c) => (c ? card(c) : null));
  return g;
}

test("a supermove can carry (free cells + 1) x 2^(empty columns) cards", () => {
  const g = fcGame([["9S"], ["8H"], ["7C"], ["6D"], ["5S"], ["4H"], ["3C"], ["2D"]]);
  assert.strictEqual(FC.maxMove(g, false), 5);
  g.cols[7] = [];
  assert.strictEqual(FC.maxMove(g, false), 10);
  assert.strictEqual(FC.maxMove(g, true), 5, "moving into the empty column itself does not count it");
});

test("a column move takes the run that lands", () => {
  const g = fcGame([["KS", "8D", "7C", "6H"], ["9C"], ["2D"], ["2H"], ["3D"], ["3H"], ["4D"], ["4H"]]);
  assert.strictEqual(FC.runLength(g.cols[0]), 3);
  assert.strictEqual(FC.plan(g, { type: "col", i: 0 }, { type: "col", i: 1 }), 3, "8D 7C 6H onto 9C");
  assert.strictEqual(FC.move(g, { type: "col", i: 0 }, { type: "col", i: 1 }), 3);
  eq(g.cols[1].map(named), ["9C", "8D", "7C", "6H"]);
});

test("a run longer than the free cells allow does not move", () => {
  const g = fcGame(
    [["KS", "8D", "7C", "6H", "5S"], ["9C"], ["2D"], ["2H"], ["3D"], ["3H"], ["4D"], ["4H"]],
    ["AC", "AD", "AH", null],
  );
  assert.strictEqual(FC.maxMove(g, false), 2);
  assert.strictEqual(FC.plan(g, { type: "col", i: 0 }, { type: "col", i: 1 }), 0);
});

test("into an empty column: the longest run allowed, or a single card", () => {
  const g = fcGame([["KS", "8D", "7C", "6H"], ["9C"], ["2D"], ["2H"], ["3D"], ["3H"], ["4D"], []]);
  assert.strictEqual(FC.plan(g, { type: "col", i: 0 }, { type: "col", i: 7 }), 3);
  assert.strictEqual(FC.plan(g, { type: "col", i: 0 }, { type: "col", i: 7 }, true), 1);
  assert.strictEqual(FC.plan(g, { type: "col", i: 0, index: 2 }, { type: "col", i: 7 }), 2, "a dragged run moves as dragged");
});

test("cards go home on their own only when nothing could be played on them", () => {
  const g = fcGame([["5D", "AC"], ["2C"], ["KH"], ["KS"], ["KD"], ["KC"], ["QH"], ["QS"]]);
  assert.strictEqual(FC.autoHome(g), 2, "the Ace and Two of Clubs");
  g.home = [[card("AC"), card("2C"), card("3C")], [card("AD")], [card("AH")], [card("AS")]];
  assert.ok(!FC.safeHome(g, card("4C")), "a red Three could still want the Four of Clubs");
  g.home[1].push(card("2D"), card("3D"));
  g.home[2].push(card("2H"), card("3H"));
  assert.ok(FC.safeHome(g, card("4C")));
});

test("moving to a free cell, home, and back with Undo", () => {
  const g = fcGame([["KS", "AH"], ["9C"], ["2D"], ["2H"], ["3D"], ["3H"], ["4D"], ["4H"]]);
  g.cols[0] = [card("KS"), card("5H")];
  assert.strictEqual(FC.move(g, { type: "col", i: 0 }, { type: "cell", i: 2 }), 1);
  assert.strictEqual(named(g.cells[2]), "5H");
  assert.strictEqual(FC.move(g, { type: "cell", i: 2 }, { type: "cell", i: 3 }), 1);
  assert.strictEqual(FC.move(g, { type: "col", i: 1 }, { type: "home" }), 0, "a Nine cannot go home");
  assert.ok(FC.undo(g));
  assert.ok(FC.undo(g));
  eq(g.cols[0].map(named), ["KS", "5H"]);
  eq(g.cells, [null, null, null, null]);
});

test("FreeCell sees when no move is left", () => {
  const blocked = fcGame(
    [["2S", "KD"], ["2C", "KH"], ["3S", "QD"], ["3C", "QH"], ["4S", "JD"], ["4C", "JH"], ["5S", "TD"], ["5C", "TH"]],
    ["9D", "9H", "8D", "8H"],
  );
  assert.ok(!FC.hasMoves(blocked));
  blocked.cells[3] = null;
  assert.ok(FC.hasMoves(blocked), "an empty free cell is always a move");
});

// ---------------------------------------------------------------- Hearts

function playOut(s) {
  if (s.phase === "pass") HE.applyPass(s, [0, 1, 2, 3].map((p) => HE.choosePass(s.hands[p])));
  HE.startPlay(s);
  while (s.phase !== "done") {
    while (s.trick.length < 4) HE.play(s, s.turn, HE.choosePlay(s, s.turn));
    HE.collect(s);
  }
  return HE.handScore(s);
}

test("passing goes left, right, across, then not at all", () => {
  eq([0, 1, 2, 3, 4].map((n) => HE.newHand(n, seeded(n)).passDir), ["left", "right", "across", "none", "left"]);
  eq([0, 1, 2, 3].map((p) => HE.passTarget(p, "left")), [1, 2, 3, 0]);
  eq([0, 1, 2, 3].map((p) => HE.passTarget(p, "right")), [3, 0, 1, 2]);
  eq([0, 1, 2, 3].map((p) => HE.passTarget(p, "across")), [2, 3, 0, 1]);
});

test("passed cards arrive, and each hand still has thirteen", () => {
  const s = HE.newHand(0, seeded(9));
  const picks = [0, 1, 2, 3].map((p) => s.hands[p].slice(0, 3));
  const got = HE.applyPass(s, picks);
  eq(got[1].map(named), picks[0].map(named), "your three went to the left");
  assert.ok(s.hands.every((h) => h.length === 13));
});

test("the Two of Clubs leads, and no points go on the first trick", () => {
  const s = HE.newHand(3, seeded(4));
  HE.startPlay(s);
  const leader = s.turn;
  eq(HE.legalPlays(s, leader).map(named), ["2C"]);
  assert.ok(s.hands[leader].some((c) => c.suit === "C" && c.rank === 2));
  // Give the next player no clubs but hearts, the Queen and one diamond.
  const next = (leader + 1) % 4;
  s.hands[next] = ["3H", "4H", "QS", "5D"].map(card);
  HE.play(s, leader, card("2C"));
  eq(HE.legalPlays(s, next).map(named), ["5D"]);
  assert.strictEqual(HE.whyNot(s, next, card("QS")), "You can't play points on the first trick.");
});

test("you must follow suit, and hearts cannot be led until broken", () => {
  const s = HE.newHand(3, seeded(5));
  HE.startPlay(s);
  s.trickNo = 1;
  s.trick = [];
  s.turn = 0;
  s.hands[0] = ["3H", "9H", "4C"].map(card);
  eq(HE.legalPlays(s, 0).map(named), ["4C"]);
  assert.strictEqual(HE.whyNot(s, 0, card("3H")), "Hearts have not been broken yet.");
  s.hands[0] = ["3H", "9H"].map(card);
  eq(HE.legalPlays(s, 0).map(named), ["3H", "9H"], "unless there is nothing else");
  s.trick = [{ p: 3, card: card("8C") }];
  s.hands[0] = ["3H", "4C"].map(card);
  eq(HE.legalPlays(s, 0).map(named), ["4C"]);
  assert.strictEqual(HE.whyNot(s, 0, card("3H")), "You must follow suit.");
});

test("the highest card of the suit led takes the trick", () => {
  const trick = [
    { p: 2, card: card("5D") },
    { p: 3, card: card("AS") },
    { p: 0, card: card("QD") },
    { p: 1, card: card("9D") },
  ];
  assert.strictEqual(HE.trickWinner(trick), 0);
});

test("shooting the moon gives everyone else 26", () => {
  const s = HE.newHand(0, seeded(1));
  s.taken = [[], [], [], []];
  for (let r = 1; r <= 13; r++) s.taken[2].push({ rank: r, suit: "H" });
  s.taken[2].push(card("QS"));
  eq(HE.handScore(s), { points: [26, 26, 0, 26], moon: 2 });
  s.taken[1].push(s.taken[2].pop());
  eq(HE.handScore(s), { points: [0, 13, 13, 0], moon: -1 });
});

test("the game ends at 100 and the lowest score wins", () => {
  assert.ok(!HE.gameOver([99, 40, 12, 60]));
  assert.ok(HE.gameOver([100, 40, 12, 60]));
  eq(HE.winners([104, 40, 12, 12]), [2, 3]);
});

test("the computer players play 500 hands without a wrong card", () => {
  let moons = 0;
  for (let n = 0; n < 500; n++) {
    const s = HE.newHand(n, seeded(1000 + n));
    // play() throws on a card that is not legal, or out of turn.
    const res = playOut(s);
    const total = res.points.reduce((a, b) => a + b, 0);
    if (res.moon >= 0) {
      moons++;
      assert.strictEqual(total, 78);
    } else {
      assert.strictEqual(total, 26);
    }
    assert.ok(s.hands.every((h) => !h.length));
  }
  assert.ok(moons < 50, "the moon is shot rarely, not routinely: " + moons);
});

test("a computer player never keeps the Queen of Spades when it can drop her", () => {
  const s = HE.newHand(3, seeded(2));
  HE.startPlay(s);
  s.trickNo = 3;
  s.heartsBroken = true;
  s.trick = [{ p: 0, card: card("5D") }];
  s.turn = 1;
  s.hands[1] = ["QS", "9H", "2C"].map(card);
  assert.strictEqual(named(HE.choosePlay(s, 1)), "QS");
  eq(HE.choosePass(["QS", "2C", "3C", "4C", "5D", "AH", "KH", "2S", "3S", "4S", "5S", "6S", "7S"].map(card)).map(named)[0], "QS");
});
