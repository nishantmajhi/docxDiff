/*
 * Minesweeper, as Windows 95 shipped it: three levels and a custom field, a
 * safe first click, flags and question marks, chording with both buttons (or
 * the middle one), the LED counters and the face, and best times per level.
 *
 * The rules are plain functions over a state object (Win95.rules.minesweeper)
 * so the tests can drive them without a page.
 */
(function () {
  "use strict";

  var Win95 = (window.Win95 = window.Win95 || {});

  // ---------------------------------------------------------------- rules

  var LEVELS = {
    beginner: { w: 9, h: 9, m: 10, name: "Beginner" },
    intermediate: { w: 16, h: 16, m: 40, name: "Intermediate" },
    expert: { w: 30, h: 16, m: 99, name: "Expert" },
  };

  /** The limits of the Custom Field dialog. */
  function clampCustom(h, w, m) {
    h = Math.max(9, Math.min(24, Math.floor(Number(h)) || 9));
    w = Math.max(9, Math.min(30, Math.floor(Number(w)) || 9));
    m = Math.max(10, Math.min((h - 1) * (w - 1), Math.floor(Number(m)) || 10));
    return { w: w, h: h, m: m };
  }

  function create(w, h, m) {
    var cells = [];
    for (var i = 0; i < w * h; i++) cells.push({ mine: false, adj: 0, open: false, mark: 0 });
    // mark: 0 none, 1 flag, 2 question mark
    return { w: w, h: h, m: m, cells: cells, placed: false, over: false, won: false, opened: 0, flags: 0, exploded: -1 };
  }

  function neighbors(s, i) {
    var x = i % s.w;
    var y = (i - x) / s.w;
    var out = [];
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = x + dx;
        var ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < s.w && ny < s.h) out.push(ny * s.w + nx);
      }
    }
    return out;
  }

  // Mines are laid on the first click, never under it.
  function placeMines(s, safe, rand) {
    rand = rand || Math.random;
    var pool = [];
    for (var i = 0; i < s.cells.length; i++) if (i !== safe) pool.push(i);
    for (var k = 0; k < s.m; k++) {
      var j = k + Math.floor(rand() * (pool.length - k));
      var t = pool[k];
      pool[k] = pool[j];
      pool[j] = t;
      s.cells[pool[k]].mine = true;
    }
    s.cells.forEach(function (c, idx) {
      c.adj = neighbors(s, idx).filter(function (n) {
        return s.cells[n].mine;
      }).length;
    });
    s.placed = true;
  }

  function checkWin(s) {
    if (s.opened !== s.w * s.h - s.m) return;
    s.won = true;
    s.over = true;
    s.cells.forEach(function (c) {
      if (c.mine) c.mark = 1;
    });
    s.flags = s.m;
  }

  /** Open a cell. Returns "boom", "ok", or "noop" when nothing happened. */
  function reveal(s, i, rand) {
    if (s.over) return "noop";
    var c = s.cells[i];
    if (c.open || c.mark === 1) return "noop";
    if (!s.placed) placeMines(s, i, rand);
    if (c.mine) {
      c.open = true;
      s.over = true;
      s.exploded = i;
      return "boom";
    }
    var stack = [i];
    while (stack.length) {
      var j = stack.pop();
      var cell = s.cells[j];
      if (cell.open || cell.mark === 1) continue;
      cell.open = true;
      cell.mark = 0;
      s.opened++;
      if (cell.adj === 0) stack.push.apply(stack, neighbors(s, j));
    }
    checkWin(s);
    return "ok";
  }

  /** Right click: flag, then question mark (if marks are on), then nothing. */
  function toggleMark(s, i, marks) {
    var c = s.cells[i];
    if (s.over || c.open) return false;
    if (c.mark === 0) {
      c.mark = 1;
      s.flags++;
    } else if (c.mark === 1) {
      c.mark = marks ? 2 : 0;
      s.flags--;
    } else {
      c.mark = 0;
    }
    return true;
  }

  /**
   * Both buttons on an open number: when the flags around it match the
   * number, open everything else around it -- including a mine, if a flag
   * is wrong.
   */
  function chord(s, i, rand) {
    var c = s.cells[i];
    if (s.over || !c.open || c.adj === 0) return "noop";
    var around = neighbors(s, i);
    var flags = around.filter(function (n) {
      return s.cells[n].mark === 1;
    }).length;
    if (flags !== c.adj) return "noop";
    var result = "noop";
    around.forEach(function (n) {
      if (s.over) return;
      var r = reveal(s, n, rand);
      if (r !== "noop") result = r;
    });
    return result;
  }

  var rules = {
    LEVELS: LEVELS,
    clampCustom: clampCustom,
    create: create,
    neighbors: neighbors,
    placeMines: placeMines,
    reveal: reveal,
    toggleMark: toggleMark,
    chord: chord,
  };
  Win95.rules = Win95.rules || {};
  Win95.rules.minesweeper = rules;

  // ---------------------------------------------------------------- pictures

  var SEG = {
    a: "2,1 11,1 9,3 4,3",
    b: "12,2 12,11 10,10 10,4",
    c: "12,12 12,21 10,19 10,13",
    d: "2,22 11,22 9,20 4,20",
    e: "1,12 3,13 3,19 1,21",
    f: "1,2 3,4 3,10 1,11",
    g: "2,11.5 4,10.5 9,10.5 11,11.5 9,12.5 4,12.5",
  };
  var DIGIT = {
    0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc",
    5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g",
  };

  function ledHTML(n) {
    var text;
    if (n < 0) text = "-" + String(Math.min(99, -n)).padStart(2, "0");
    else text = String(Math.min(999, n)).padStart(3, "0");
    return text
      .split("")
      .map(function (ch) {
        var on = DIGIT[ch];
        return (
          '<svg viewBox="0 0 13 23" class="ms-digit" aria-hidden="true">' +
          Object.keys(SEG)
            .map(function (k) {
              return '<polygon points="' + SEG[k] + '" fill="' + (on.indexOf(k) !== -1 ? "#ff0000" : "#400000") + '"/>';
            })
            .join("") +
          "</svg>"
        );
      })
      .join("");
  }

  var FACES = {
    smile: '<path d="M5 11q3.5 3 7 0" fill="none" stroke="#000"/><path d="M6 6h1v2H6zM10 6h1v2h-1z"/>',
    oh: '<circle cx="8.5" cy="12" r="1.8" fill="none" stroke="#000"/><path d="M5.5 5.5h2v2h-2zM9.5 5.5h2v2h-2z"/>',
    dead: '<path d="M5 13q3.5-3 7 0" fill="none" stroke="#000"/><path d="M5 5l3 3M8 5L5 8M9 5l3 3M12 5l-3 3" stroke="#000"/>',
    cool:
      '<path d="M5 11q3.5 3 7 0" fill="none" stroke="#000"/>' +
      '<path d="M2.5 6h12v1h-1v1q0 1-1 1h-2q-1 0-1-1V7h-1v1q0 1-1 1h-2q-1 0-1-1V7h-1z"/>',
  };

  function faceHTML(kind) {
    return (
      '<svg viewBox="0 0 17 17" class="ms-smiley" aria-hidden="true">' +
      '<circle cx="8.5" cy="8.5" r="8" fill="#ffff00" stroke="#000"/>' +
      FACES[kind] +
      "</svg>"
    );
  }

  var ICON =
    '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">' +
    '<path d="M1 1h14v14H1z" fill="#c0c0c0"/><path d="M1 1h14v1H2v13H1z" fill="#fff"/><path d="M15 1v14H1v-1h13V1z" fill="#808080"/>' +
    '<path d="M7 3h2v1h2v1h1v2h1v2h-1v2h-1v1H9v1H7v-1H5v-1H4V9H3V7h1V5h1V4h2z"/>' +
    '<path d="M6 6h2v2H6z" fill="#fff"/><path d="M8 2h0v12M2 8h12" stroke="#000"/></svg>';

  // ---------------------------------------------------------------- game window

  function createGame(win) {
    var store = Win95.store;
    var settings = store.get("minesweeper.settings", { level: "beginner", custom: LEVELS.beginner, marks: true });
    var best = store.get("minesweeper.best", null) || defaultBest();
    var s, timer = null, time = 0, running = false;
    var faceKind = "smile";

    function defaultBest() {
      return {
        beginner: { time: 999, name: "Anonymous" },
        intermediate: { time: 999, name: "Anonymous" },
        expert: { time: 999, name: "Anonymous" },
      };
    }

    win.body.innerHTML =
      '<div class="ms">' +
      '<div class="ms-top">' +
      '<div class="ms-led" data-led="mines"></div>' +
      '<button class="ms-face" aria-label="New game"></button>' +
      '<div class="ms-led" data-led="time"></div>' +
      "</div>" +
      '<div class="ms-grid" role="grid"></div>' +
      "</div>";
    var grid = win.body.querySelector(".ms-grid");
    var faceBtn = win.body.querySelector(".ms-face");
    var minesLed = win.body.querySelector('[data-led="mines"]');
    var timeLed = win.body.querySelector('[data-led="time"]');
    var cellEls = [];
    var drawn = [];

    function dims() {
      return settings.level === "custom" ? settings.custom : LEVELS[settings.level];
    }

    function stopTimer() {
      if (timer) clearInterval(timer);
      timer = null;
    }
    function startTimer() {
      stopTimer();
      timer = setInterval(function () {
        if (time < 999) time++;
        timeLed.innerHTML = ledHTML(time);
      }, 1000);
    }

    function newGame() {
      var d = dims();
      s = create(d.w, d.h, d.m);
      stopTimer();
      running = false;
      time = 0;
      faceKind = "smile";
      grid.style.gridTemplateColumns = "repeat(" + d.w + ", 16px)";
      var html = [];
      for (var i = 0; i < d.w * d.h; i++) html.push('<div class="ms-cell c" data-i="' + i + '"></div>');
      grid.innerHTML = html.join("");
      cellEls = Array.prototype.slice.call(grid.children);
      drawn = cellEls.map(function () {
        return "c";
      });
      render();
      win.fit();
    }

    var pressed = []; // cells drawn pushed in while a button is held

    function cellState(i) {
      var c = s.cells[i];
      if (s.over && !s.won) {
        if (i === s.exploded) return "o mine boom";
        if (c.mine && c.mark !== 1) return "o mine";
        if (!c.mine && c.mark === 1) return "o mine wrong";
      }
      if (c.open) return "o n" + c.adj;
      if (c.mark === 1) return "c f";
      if (pressed.indexOf(i) !== -1) return c.mark === 2 ? "o q" : "o";
      if (c.mark === 2) return "c q";
      return "c";
    }

    function render() {
      for (var i = 0; i < cellEls.length; i++) {
        var st = cellState(i);
        if (drawn[i] === st) continue;
        drawn[i] = st;
        cellEls[i].className = "ms-cell " + st;
        var n = /^o n([1-8])$/.exec(st);
        cellEls[i].textContent = n ? n[1] : "";
      }
      minesLed.innerHTML = ledHTML(s.m - s.flags);
      timeLed.innerHTML = ledHTML(time);
      faceBtn.innerHTML = faceHTML(faceKind);
    }

    function afterMove(result) {
      if (!running && s.placed && !s.over) {
        running = true;
        time = 1;
        startTimer();
      }
      if (result === "boom") {
        stopTimer();
        faceKind = "dead";
      } else if (s.won) {
        stopTimer();
        faceKind = "cool";
      }
      render();
      if (s.won) recordWin();
    }

    function recordWin() {
      var level = settings.level;
      if (level === "custom" || time >= best[level].time) return;
      var form =
        '<p class="dlg-text">You have the fastest time for ' +
        LEVELS[level].name.toLowerCase() +
        " level.<br/>Please type your name:</p>" +
        '<input class="field95" type="text" maxlength="32" value="Anonymous" aria-label="Your name"/>';
      win.dialog({
        title: "Congratulations",
        body: form,
        buttons: [{ label: "OK", value: "ok", isDefault: true, isCancel: true }],
        onClose: function (v, d) {
          var input = d.querySelector("input");
          best[level] = { time: time, name: (input.value || "Anonymous").trim().slice(0, 32) || "Anonymous" };
          store.set("minesweeper.best", best);
          setTimeout(showBest, 0);
        },
      });
    }

    function showBest() {
      var rows = ["beginner", "intermediate", "expert"]
        .map(function (k) {
          return (
            "<tr><td>" + LEVELS[k].name + ":</td><td>" + best[k].time + " seconds</td><td>" +
            Win95.esc(best[k].name) + "</td></tr>"
          );
        })
        .join("");
      win.dialog({
        title: "Fastest Mine Sweepers",
        body: '<table class="dlg-table">' + rows + "</table>",
        buttons: [
          { label: "<u>R</u>eset Scores", value: "reset" },
          { label: "OK", value: "ok", isDefault: true, isCancel: true },
        ],
        onClose: function (v) {
          if (v === "reset") {
            best = defaultBest();
            store.set("minesweeper.best", best);
            setTimeout(showBest, 0);
          }
        },
      });
    }

    function showCustom() {
      var d = dims();
      var form =
        '<div class="dlg-form">' +
        '<label><span><u>H</u>eight:</span><input class="field95" type="number" name="h" min="9" max="24" value="' + d.h + '"/></label>' +
        '<label><span><u>W</u>idth:</span><input class="field95" type="number" name="w" min="9" max="30" value="' + d.w + '"/></label>' +
        '<label><span><u>M</u>ines:</span><input class="field95" type="number" name="m" min="10" value="' + d.m + '"/></label>' +
        "</div>";
      win.dialog({
        title: "Custom Field",
        body: form,
        buttonsBeside: true,
        buttons: [
          { label: "OK", value: "ok", isDefault: true },
          { label: "Cancel", value: "cancel", isCancel: true },
        ],
        onClose: function (v, dlg) {
          if (v !== "ok") return;
          var get = function (n) {
            return dlg.querySelector('[name="' + n + '"]').value;
          };
          settings.custom = clampCustom(get("h"), get("w"), get("m"));
          setLevel("custom");
        },
      });
    }

    function setLevel(level) {
      settings.level = level;
      store.set("minesweeper.settings", settings);
      newGame();
    }

    function about() {
      win.message(
        "<b>Minesweeper</b><br/><br/>Find the mines without setting one off. " +
          "Numbers count the mines around a square; right-click to flag one, " +
          "and press both buttons on a number to clear around it.<br/><br/>" +
          "Part of docxDiff. Everything runs in this browser.",
        { title: "About Minesweeper" },
      );
    }

    win.setMenus([
      {
        label: "<u>G</u>ame",
        items: function () {
          return [
            { label: "<u>N</u>ew", key: "F2", action: newGame },
            "-",
            { label: "<u>B</u>eginner", checked: settings.level === "beginner", action: function () { setLevel("beginner"); } },
            { label: "<u>I</u>ntermediate", checked: settings.level === "intermediate", action: function () { setLevel("intermediate"); } },
            { label: "<u>E</u>xpert", checked: settings.level === "expert", action: function () { setLevel("expert"); } },
            { label: "<u>C</u>ustom…", checked: settings.level === "custom", action: showCustom },
            "-",
            {
              label: "<u>M</u>arks (?)",
              checked: settings.marks,
              action: function () {
                settings.marks = !settings.marks;
                store.set("minesweeper.settings", settings);
              },
            },
            "-",
            { label: "Best <u>T</u>imes…", action: showBest },
            "-",
            { label: "E<u>x</u>it", action: function () { win.close(); } },
          ];
        },
      },
      { label: "<u>H</u>elp", items: [{ label: "<u>A</u>bout Minesweeper…", key: "F1", action: about }] },
    ]);

    // ---- mouse: left opens, right flags, both (or middle) chord
    var mouse = { left: false, right: false, chord: false, hover: -1 };

    function cellIndexAt(x, y) {
      var el = document.elementFromPoint(x, y);
      var cell = el && el.closest && el.closest(".ms-cell");
      return cell && grid.contains(cell) ? Number(cell.getAttribute("data-i")) : -1;
    }

    function showPress() {
      pressed = [];
      if (s.over || mouse.hover < 0) return;
      var around = mouse.chord ? [mouse.hover].concat(neighbors(s, mouse.hover)) : [mouse.hover];
      pressed = around.filter(function (i) {
        var c = s.cells[i];
        return !c.open && c.mark !== 1;
      });
    }

    function onMouseDown(e) {
      if (s.over && e.target.closest(".ms-grid")) return;
      if (e.button === 0) mouse.left = true;
      else if (e.button === 2) mouse.right = true;
      else if (e.button === 1) {
        mouse.chord = true;
        e.preventDefault();
      }
      mouse.hover = cellIndexAt(e.clientX, e.clientY);
      if (e.button === 2 && !mouse.left) {
        if (mouse.hover >= 0 && toggleMark(s, mouse.hover, settings.marks)) render();
        return;
      }
      if (mouse.left && mouse.right) mouse.chord = true;
      faceKind = "oh";
      showPress();
      render();
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    }

    function onMouseMove(e) {
      mouse.hover = cellIndexAt(e.clientX, e.clientY);
      showPress();
      render();
    }

    function onMouseUp(e) {
      var wasChord = mouse.chord;
      var i = cellIndexAt(e.clientX, e.clientY);
      if (e.button === 0) mouse.left = false;
      if (e.button === 2) mouse.right = false;
      if (e.button === 1) mouse.chord = false;
      if (!mouse.left && !mouse.right) {
        mouse.chord = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      }
      pressed = [];
      if (!s.over) faceKind = "smile";
      var result = "noop";
      if (i >= 0 && (wasChord || e.button === 1)) {
        result = chord(s, i);
        mouse.chord = false;
        // The other button's release ends the chord; it opens nothing.
        mouse.left = mouse.right = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      } else if (i >= 0 && e.button === 0) {
        result = s.cells[i].open ? chord(s, i) : reveal(s, i);
      }
      afterMove(result);
    }

    grid.addEventListener("mousedown", onMouseDown);
    grid.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });

    // ---- touch: tap opens (or chords a number), a long press flags
    var touch = null;
    grid.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        var t = e.touches[0];
        var i = cellIndexAt(t.clientX, t.clientY);
        if (i < 0 || s.over) return;
        touch = { i: i, x: t.clientX, y: t.clientY, flagged: false };
        mouse.hover = i;
        showPress();
        faceKind = "oh";
        render();
        touch.timer = setTimeout(function () {
          if (!touch) return;
          touch.flagged = true;
          pressed = [];
          faceKind = "smile";
          toggleMark(s, touch.i, settings.marks);
          if (navigator.vibrate) navigator.vibrate(20);
          render();
        }, 380);
      },
      { passive: false },
    );
    grid.addEventListener(
      "touchmove",
      function (e) {
        if (!touch) return;
        var t = e.touches[0];
        if (Math.abs(t.clientX - touch.x) + Math.abs(t.clientY - touch.y) > 12) {
          clearTimeout(touch.timer);
          touch = null;
          pressed = [];
          faceKind = "smile";
          render();
        }
      },
      { passive: true },
    );
    grid.addEventListener("touchend", function (e) {
      if (!touch) return;
      e.preventDefault();
      clearTimeout(touch.timer);
      var t = touch;
      touch = null;
      pressed = [];
      if (!s.over) faceKind = "smile";
      if (t.flagged) return render();
      afterMove(s.cells[t.i].open ? chord(s, t.i) : reveal(s, t.i));
    });

    faceBtn.addEventListener("mousedown", function () {
      faceBtn.classList.add("down");
    });
    faceBtn.addEventListener("mouseleave", function () {
      faceBtn.classList.remove("down");
    });
    faceBtn.addEventListener("click", function () {
      faceBtn.classList.remove("down");
      newGame();
    });

    newGame();

    return {
      onKey: function (e) {
        if (e.key === "F2") {
          e.preventDefault();
          newGame();
        } else if (e.key === "F1") {
          e.preventDefault();
          about();
        }
      },
      // Win95 stops the clock while Minesweeper is minimized.
      onMinimize: function () {
        stopTimer();
      },
      onRestore: function () {
        if (running && !s.over) startTimer();
      },
      destroy: function () {
        stopTimer();
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      },
      state: function () {
        return s;
      },
    };
  }

  if (Win95.registerGame) {
    Win95.registerGame({
      id: "minesweeper",
      title: "Minesweeper",
      icon: ICON,
      resizable: false,
      create: createGame,
    });
  }
})();
