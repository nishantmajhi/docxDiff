/*
 * The desktop around docxDiff: the Start menu, and the game windows it opens.
 *
 * Each game is a separate script that calls Win95.registerGame() with a
 * definition, and this file gives it a real window: one that can be dragged
 * by its title bar, resized from its edges, minimized to the taskbar,
 * maximized over the desktop and closed. Game windows live in their own layer
 * above the two DiffPad windows, so the diff underneath is never disturbed.
 *
 * Nothing here touches the diff. js/app.js owns #app, the DiffPad taskbar
 * buttons and Start over; this file owns #game-layer, #game-tasks and the
 * rest of the Start menu.
 */
(function () {
  "use strict";

  var Win95 = (window.Win95 = window.Win95 || {});
  var defs = {};

  Win95.registerGame = function (def) {
    defs[def.id] = def;
    var slot =
      typeof document !== "undefined" &&
      document.querySelector(
        '#start-menu [data-game="' + def.id + '"] .sm-icon',
      );
    if (slot) slot.innerHTML = def.icon;
  };

  // Settings and high scores. Storage can be missing or refuse a write (a
  // private window, blocked site data), and a game must still play then.
  Win95.store = {
    get: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem("docxdiff." + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem("docxdiff." + key, JSON.stringify(value));
      } catch (e) {
        /* the setting simply is not remembered */
      }
    },
  };

  Win95.esc = function (s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  if (typeof document === "undefined") return;

  var layer = document.getElementById("game-layer");
  var taskList = document.getElementById("game-tasks");
  var startBtn = document.getElementById("start-btn");
  var startMenu = document.getElementById("start-menu");
  if (!layer || !taskList) return;

  var GLYPH = {
    min: '<svg class="g-min" viewBox="0 0 6 2" aria-hidden="true"><path d="M0 0h6v2H0z"/></svg>',
    max:
      '<svg class="g-max" viewBox="0 0 9 9" aria-hidden="true">' +
      '<path fill-rule="evenodd" d="M0 0h9v9H0zM1 2v6h7V2z"/></svg>',
    restore:
      '<svg class="g-max" viewBox="0 0 8 9" aria-hidden="true">' +
      '<path d="M2 0h6v2H2zM7 2h1v4H7zM6 5h1v1H6zM2 2h1v1H2z"/>' +
      '<path fill-rule="evenodd" d="M0 3h6v6H0zM1 5v3h4V5z"/></svg>',
    close:
      '<svg class="g-close" viewBox="0 0 8 7" aria-hidden="true"><path d="M0 0h2v1h1v1h2V1h1V0h2v1H7v1H6v1H5v1h1v1h1v1h1v1H6V6H5V5H3v1H2v1H0V6h1V5h1V4h1V3H2V2H1V1H0z"/></svg>',
  };

  var MSG_ICON = {
    info:
      '<svg class="dlg-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2C8 2 3 7 3 13c0 5 3 8 7 10l-2 7 8-6c8 0 13-5 13-11S24 2 16 2z" fill="#fff" stroke="#000"/>' +
      '<path d="M14 7h4v3h-4zM14 12h4v9h-4z" fill="#0000c0"/></svg>',
    question:
      '<svg class="dlg-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2C8 2 3 7 3 13c0 5 3 8 7 10l-2 7 8-6c8 0 13-5 13-11S24 2 16 2z" fill="#fff" stroke="#000"/>' +
      '<path d="M11 10c0-3 2-5 5-5s5 2 5 4c0 3-3 3-3 6v1h-4v-2c0-3 3-4 3-5 0-1-1-1-1-1-1 0-1 1-1 2z M14 18h4v3h-4z" fill="#0000c0"/></svg>',
    warning:
      '<svg class="dlg-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2L31 29H1z" fill="#ff0" stroke="#000"/>' +
      '<path d="M14 10h4l-1 11h-2zM14 23h4v3h-4z"/></svg>',
    error:
      '<svg class="dlg-icon" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="#f00" stroke="#800000" stroke-width="2"/>' +
      '<path d="M10 10l12 12M22 10L10 22" stroke="#fff" stroke-width="4"/></svg>',
  };

  var wins = []; // open game windows, bottom to top
  var active = null; // the active game window, or null when a DiffPad window is
  var cascade = 0;

  function topVisible(except) {
    for (var i = wins.length - 1; i >= 0; i--) {
      if (wins[i] !== except && !wins[i].minimized) return wins[i];
    }
    return null;
  }

  function restack() {
    wins.forEach(function (w, i) {
      w.el.style.zIndex = String(10 + i * 2);
      w.dialogs.forEach(function (d) {
        d.el.style.zIndex = String(11 + i * 2);
      });
    });
  }

  // Win95 shows exactly one active window. When it is a game, the DiffPad
  // windows' title bars go grey; when it is neither, they decide for
  // themselves (js/app.js).
  function setActive(win) {
    active = win;
    wins.forEach(function (w) {
      var on = w === win;
      w.el.classList.toggle("inactive", !on || w.dialogs.length > 0);
      w.dialogs.forEach(function (d, i) {
        d.el.classList.toggle("inactive", !on || i !== w.dialogs.length - 1);
      });
      w.task.classList.toggle("on", on && !w.minimized);
      if (!on) closeMenus(w);
    });
    document.body.classList.toggle("game-focus", !!win);
  }

  function focusWin(win) {
    if (!win || win.minimized) return;
    wins.splice(wins.indexOf(win), 1);
    wins.push(win);
    restack();
    setActive(win);
  }

  function layerSize() {
    return { w: layer.clientWidth, h: layer.clientHeight };
  }

  // The Win95 caption animation: an outline that flies between a window and
  // its taskbar button.
  function zoom(from, to) {
    var z = document.createElement("div");
    z.className = "wm-zoom";
    function place(r) {
      z.style.left = r.left + "px";
      z.style.top = r.top + "px";
      z.style.width = r.width + "px";
      z.style.height = r.height + "px";
    }
    place(from);
    document.body.appendChild(z);
    // Read layout once so the starting position is committed before moving.
    void z.offsetWidth;
    place(to);
    setTimeout(function () {
      if (z.parentNode) z.parentNode.removeChild(z);
    }, 200);
  }

  function closeMenus(win) {
    var any = false;
    win.menubar.querySelectorAll(".menu.open").forEach(function (m) {
      m.classList.remove("open");
      any = true;
    });
    return any;
  }

  function openMenu(win, menuEl) {
    closeMenus(win);
    var spec = win.menus[Number(menuEl.getAttribute("data-menu"))];
    var items = typeof spec.items === "function" ? spec.items() : spec.items;
    menuEl.querySelector(".menu-list").innerHTML = items
      .map(function (it, j) {
        if (it === "-") return '<div class="menu-sep"></div>';
        var checked =
          typeof it.checked === "function" ? it.checked() : it.checked;
        var disabled =
          typeof it.disabled === "function" ? it.disabled() : it.disabled;
        return (
          '<button class="menu-item' +
          (checked ? " checked" : "") +
          '" role="menuitem" data-item="' +
          j +
          '"' +
          (disabled ? " disabled" : "") +
          '><span class="mi-label">' +
          it.label +
          "</span>" +
          (it.key ? '<span class="mi-key">' + it.key + "</span>" : "") +
          "</button>"
        );
      })
      .join("");
    menuEl._items = items;
    menuEl.classList.add("open");
  }

  function launch(id) {
    var def = defs[id];
    if (!def) return null;
    for (var i = 0; i < wins.length; i++) {
      if (wins[i].id === id) {
        restore(wins[i]);
        focusWin(wins[i]);
        return wins[i];
      }
    }
    return makeWindow(def);
  }

  function makeWindow(def) {
    var resizable = def.resizable !== false;
    var el = document.createElement("section");
    el.className = "window game-window" + (resizable ? " resizable" : "");
    el.setAttribute("role", "dialog");
    el.setAttribute("data-game", def.id);
    el.innerHTML =
      '<div class="titlebar">' +
      '<span class="title-icon">' +
      def.icon +
      "</span>" +
      '<span class="title-text"></span>' +
      '<span class="wm-buttons">' +
      '<button class="title-btn" data-wm="min" title="Minimize" aria-label="Minimize">' +
      GLYPH.min +
      "</button>" +
      '<button class="title-btn" data-wm="max" title="Maximize" aria-label="Maximize"' +
      (resizable ? "" : " disabled") +
      ">" +
      GLYPH.max +
      "</button>" +
      '<button class="title-btn close" data-wm="close" title="Close" aria-label="Close">' +
      GLYPH.close +
      "</button></span></div>" +
      '<div class="menubar game-menubar" role="menubar"></div>' +
      '<div class="game-body"></div>' +
      (resizable
        ? ["n", "s", "e", "w", "ne", "nw", "se", "sw"]
            .map(function (d) {
              return '<div class="rz rz-' + d + '" data-rz="' + d + '"></div>';
            })
            .join("")
        : "");
    layer.appendChild(el);

    var task = document.createElement("button");
    task.className = "task";
    task.setAttribute("data-game", def.id);
    task.innerHTML = def.icon + '<span class="task-text"></span>';
    taskList.appendChild(task);

    var win = {
      id: def.id,
      def: def,
      el: el,
      task: task,
      body: el.querySelector(".game-body"),
      menubar: el.querySelector(".game-menubar"),
      resizable: resizable,
      minimized: false,
      maximized: false,
      dialogs: [],
      menus: [],
      instance: null,
    };

    win.setTitle = function (text) {
      el.querySelector(".title-text").textContent = text;
      task.querySelector(".task-text").textContent = text;
      task.title = text;
      el.setAttribute("aria-label", text);
    };
    win.setMenus = function (menus) {
      win.menus = menus;
      win.menubar.innerHTML =
        menus
          .map(function (m, i) {
            return (
              '<div class="menu" data-menu="' +
              i +
              '"><button class="menu-title" aria-haspopup="true">' +
              m.label +
              '</button><div class="menu-list" role="menu"></div></div>'
            );
          })
          .join("") + '<span class="menu-info"></span>';
    };
    win.setMenuInfo = function (html) {
      var info = win.menubar.querySelector(".menu-info");
      if (info) info.innerHTML = html;
    };
    win.statusBar = function (count) {
      var bar = el.querySelector(".statusbar");
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "statusbar";
        el.insertBefore(bar, win.body.nextSibling);
      }
      var cells = [];
      bar.innerHTML = "";
      for (var i = 0; i < count; i++) {
        var span = document.createElement("span");
        span.className = i === 0 ? "sb-main" : "sb-cell";
        bar.appendChild(span);
        cells.push(span);
      }
      return cells;
    };
    // A fixed-size window takes the size of its content, as Minesweeper's does
    // when the level changes.
    win.fit = function () {
      if (win.resizable) return;
      var s = layerSize();
      var x = Math.max(0, Math.min(el.offsetLeft, s.w - el.offsetWidth));
      var y = Math.max(0, Math.min(el.offsetTop, s.h - el.offsetHeight));
      el.style.left = x + "px";
      el.style.top = y + "px";
    };
    win.isActive = function () {
      return active === win && !win.minimized;
    };
    win.dialog = function (opts) {
      return dialog(win, opts);
    };
    win.message = function (text, opts) {
      opts = opts || {};
      return dialog(win, {
        title: opts.title,
        icon: opts.icon || "info",
        body: '<p class="dlg-text">' + text + "</p>",
        buttons: opts.buttons || [
          { label: "OK", value: "ok", isDefault: true, isCancel: true },
        ],
        onClose: opts.onClose,
      });
    };
    win.close = function () {
      closeWin(win);
    };

    wireWindow(win);

    // Place it: cascaded from the top left, and clamped to the desktop.
    var s = layerSize();
    var k = cascade++ % 6;
    if (resizable) {
      var w = Math.min(def.width || 640, s.w - 8);
      var h = Math.min(def.height || 480, s.h - 8);
      el.style.width = w + "px";
      el.style.height = h + "px";
      el.style.left = Math.max(0, Math.min(40 + 26 * k, s.w - w)) + "px";
      el.style.top = Math.max(0, Math.min(24 + 26 * k, s.h - h)) + "px";
    } else {
      el.style.left = 40 + 26 * k + "px";
      el.style.top = 24 + 26 * k + "px";
    }

    wins.push(win);
    win.setTitle(def.title);
    win.instance = def.create(win) || {};
    win.fit();
    // A phone has no room for a window beside anything; start maximized.
    if (resizable && s.w < 640) toggleMax(win);
    restack();
    focusWin(win);

    if (typeof ResizeObserver === "function") {
      win.observer = new ResizeObserver(function () {
        if (win.instance.onResize) win.instance.onResize();
      });
      win.observer.observe(win.body);
    }
    return win;
  }

  function wireWindow(win) {
    var el = win.el;

    el.addEventListener("mousedown", function () {
      if (active !== win && !win.dialogs.length) focusWin(win);
    });
    el.addEventListener(
      "touchstart",
      function () {
        if (active !== win && !win.dialogs.length) focusWin(win);
      },
      { passive: true },
    );

    el.addEventListener("click", function (e) {
      var t = e.target;
      var wm = t.closest("[data-wm]");
      if (wm) {
        if (wm.disabled) return;
        var what = wm.getAttribute("data-wm");
        if (what === "min") minimize(win);
        else if (what === "max") toggleMax(win);
        else closeWin(win);
        return;
      }
      var title = t.closest(".menu-title");
      if (title) {
        var menu = title.parentNode;
        if (menu.classList.contains("open")) closeMenus(win);
        else openMenu(win, menu);
        return;
      }
      var item = t.closest(".menu-item[data-item]");
      if (item && !item.disabled) {
        var items = item.closest(".menu")._items;
        var spec = items[Number(item.getAttribute("data-item"))];
        closeMenus(win);
        if (spec && spec.action) spec.action();
      }
    });

    win.menubar.addEventListener("mouseover", function (e) {
      var title = e.target.closest(".menu-title");
      if (!title || !win.menubar.querySelector(".menu.open")) return;
      var menu = title.parentNode;
      if (!menu.classList.contains("open")) openMenu(win, menu);
    });

    var bar = el.querySelector(".titlebar");
    bar.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button") || e.button !== 0 || win.maximized) return;
      drag(win, e);
    });
    bar.addEventListener("dblclick", function (e) {
      if (!e.target.closest("button")) toggleMax(win);
    });

    el.querySelectorAll("[data-rz]").forEach(function (h) {
      h.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 || win.maximized) return;
        resize(win, h.getAttribute("data-rz"), e);
      });
    });

    win.task.addEventListener("click", function () {
      if (active === win && !win.minimized) {
        minimize(win);
      } else {
        restore(win);
        focusWin(win);
        var d = win.dialogs[win.dialogs.length - 1];
        if (d) d.focus();
      }
    });
  }

  function track(onMove, onUp) {
    function move(e) {
      onMove(e);
    }
    function up(e) {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.body.classList.remove("wm-busy");
      if (onUp) onUp(e);
    }
    document.body.classList.add("wm-busy");
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  }

  function drag(win, e) {
    e.preventDefault();
    var el = win.el;
    var sx = e.clientX,
      sy = e.clientY,
      ox = el.offsetLeft,
      oy = el.offsetTop;
    var s = layerSize();
    var w = el.offsetWidth;
    track(function (ev) {
      // Keep enough of the title bar on screen to grab it again.
      var x = Math.max(60 - w, Math.min(s.w - 60, ox + ev.clientX - sx));
      var y = Math.max(0, Math.min(s.h - 20, oy + ev.clientY - sy));
      el.style.left = x + "px";
      el.style.top = y + "px";
    });
  }

  function resize(win, dir, e) {
    e.preventDefault();
    e.stopPropagation();
    var el = win.el;
    var r = {
      x: el.offsetLeft,
      y: el.offsetTop,
      w: el.offsetWidth,
      h: el.offsetHeight,
    };
    var minW = win.def.minWidth || 240;
    var minH = win.def.minHeight || 180;
    var sx = e.clientX,
      sy = e.clientY;
    track(function (ev) {
      var dx = ev.clientX - sx,
        dy = ev.clientY - sy;
      var x = r.x,
        y = r.y,
        w = r.w,
        h = r.h;
      if (dir.indexOf("e") !== -1) w = Math.max(minW, r.w + dx);
      if (dir.indexOf("s") !== -1) h = Math.max(minH, r.h + dy);
      if (dir.indexOf("w") !== -1) {
        w = Math.max(minW, r.w - dx);
        x = r.x + r.w - w;
      }
      if (dir.indexOf("n") !== -1) {
        h = Math.max(minH, r.h - dy);
        y = Math.max(0, r.y + r.h - h);
        h = r.y + r.h - y;
      }
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.style.width = w + "px";
      el.style.height = h + "px";
    });
  }

  function minimize(win) {
    if (win.minimized) return;
    closeMenus(win);
    zoom(win.el.getBoundingClientRect(), win.task.getBoundingClientRect());
    win.minimized = true;
    win.el.classList.add("minimized");
    win.dialogs.forEach(function (d) {
      d.el.classList.add("minimized");
    });
    if (win.instance.onMinimize) win.instance.onMinimize();
    if (active === win) setActive(topVisible(win));
    else setActive(active);
  }

  function restore(win) {
    if (!win.minimized) return;
    win.minimized = false;
    win.el.classList.remove("minimized");
    win.dialogs.forEach(function (d) {
      d.el.classList.remove("minimized");
    });
    zoom(win.task.getBoundingClientRect(), win.el.getBoundingClientRect());
    if (win.instance.onRestore) win.instance.onRestore();
  }

  function toggleMax(win) {
    if (!win.resizable) return;
    win.maximized = !win.maximized;
    win.el.classList.toggle("maximized", win.maximized);
    var btn = win.el.querySelector('[data-wm="max"]');
    btn.innerHTML = win.maximized ? GLYPH.restore : GLYPH.max;
    btn.title = win.maximized ? "Restore" : "Maximize";
    btn.setAttribute("aria-label", btn.title);
  }

  function closeWin(win) {
    win.dialogs.slice().forEach(function (d) {
      d.close(null, true);
    });
    if (win.instance && win.instance.destroy) win.instance.destroy();
    if (win.observer) win.observer.disconnect();
    win.el.parentNode.removeChild(win.el);
    win.task.parentNode.removeChild(win.task);
    wins.splice(wins.indexOf(win), 1);
    restack();
    setActive(active === win ? topVisible() : active);
  }

  // ---------------------------------------------------------------- dialogs

  // A Win95 dialog box, modal to its game window only: the window behind it
  // ignores the mouse until the dialog is closed, and the rest of the desktop
  // carries on.
  function dialog(win, opts) {
    var d = document.createElement("div");
    d.className = "window game-dialog";
    d.setAttribute("role", "dialog");
    d.innerHTML =
      '<div class="titlebar"><span class="title-text"></span>' +
      '<span class="wm-buttons"><button class="title-btn close" data-dlg-close aria-label="Close">' +
      GLYPH.close +
      "</button></span></div>" +
      '<div class="dlg-main">' +
      (opts.icon ? MSG_ICON[opts.icon] : "") +
      '<div class="dlg-body"></div></div>' +
      '<div class="dlg-buttons"></div>';
    var titleText = opts.title || win.def.title;
    d.querySelector(".title-text").textContent = titleText;
    d.setAttribute("aria-label", titleText);
    var body = d.querySelector(".dlg-body");
    if (typeof opts.body === "string") body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);

    var buttons = opts.buttons || [
      { label: "OK", value: "ok", isDefault: true, isCancel: true },
    ];
    var btnBox = d.querySelector(".dlg-buttons");
    if (opts.buttonsBeside) d.classList.add("buttons-beside");
    buttons.forEach(function (b, i) {
      var btn = document.createElement("button");
      btn.className = "btn95" + (b.isDefault ? " default" : "");
      btn.type = "button";
      btn.setAttribute("data-btn", String(i));
      btn.innerHTML = '<span class="btn-label">' + b.label + "</span>";
      btnBox.appendChild(btn);
    });

    var blocker = document.createElement("div");
    blocker.className = "wm-blocker";
    win.el.appendChild(blocker);
    layer.appendChild(d);

    var rec = {
      el: d,
      body: body,
      close: closeDialog,
      focus: function () {
        var target =
          d.querySelector("input, select") ||
          d.querySelector(".btn95.default") ||
          d.querySelector(".btn95");
        if (target) {
          target.focus();
          if (target.select) target.select();
        }
      },
    };
    win.dialogs.push(rec);

    // Centred on its window, and kept on the desktop.
    var s = layerSize();
    var wr = {
      x: win.el.offsetLeft,
      y: win.el.offsetTop,
      w: win.el.offsetWidth,
      h: win.el.offsetHeight,
    };
    if (win.maximized) wr = { x: 0, y: 0, w: s.w, h: s.h };
    var x = wr.x + (wr.w - d.offsetWidth) / 2;
    var y = wr.y + Math.max(30, (wr.h - d.offsetHeight) / 2);
    d.style.left =
      Math.round(Math.max(0, Math.min(x, s.w - d.offsetWidth))) + "px";
    d.style.top =
      Math.round(Math.max(0, Math.min(y, s.h - d.offsetHeight))) + "px";

    restack();
    if (win.minimized) restore(win);
    focusWin(win);
    setActive(win);
    rec.focus();

    function value(i) {
      return buttons[i] ? buttons[i].value : null;
    }
    function cancelValue() {
      for (var i = 0; i < buttons.length; i++)
        if (buttons[i].isCancel) return buttons[i].value;
      return null;
    }

    function closeDialog(v, silent) {
      if (!d.parentNode) return;
      if (!silent && opts.onClose && opts.onClose(v, d) === false) return;
      d.parentNode.removeChild(d);
      if (blocker.parentNode) blocker.parentNode.removeChild(blocker);
      win.dialogs.splice(win.dialogs.indexOf(rec), 1);
      if (wins.indexOf(win) !== -1) {
        restack();
        setActive(active);
        if (!win.dialogs.length && win.instance && win.instance.onDialogClosed)
          win.instance.onDialogClosed();
      }
    }

    d.addEventListener("click", function (e) {
      var b = e.target.closest("[data-btn]");
      if (b) closeDialog(value(Number(b.getAttribute("data-btn"))));
      else if (e.target.closest("[data-dlg-close]")) closeDialog(cancelValue());
    });
    d.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeDialog(cancelValue());
      } else if (e.key === "Enter" && !e.target.closest(".dlg-buttons")) {
        // Enter presses the default button, unless focus is on one of the
        // dialog's push buttons, which Enter presses instead.
        e.preventDefault();
        e.stopPropagation();
        for (var i = 0; i < buttons.length; i++) {
          if (buttons[i].isDefault) return closeDialog(buttons[i].value);
        }
      }
    });
    d.addEventListener("mousedown", function () {
      if (active !== win) focusWin(win);
    });
    d.querySelector(".titlebar").addEventListener("pointerdown", function (e) {
      if (e.target.closest("button") || e.button !== 0) return;
      e.preventDefault();
      var sx = e.clientX,
        sy = e.clientY,
        ox = d.offsetLeft,
        oy = d.offsetTop;
      track(function (ev) {
        d.style.left =
          Math.max(
            60 - d.offsetWidth,
            Math.min(s.w - 60, ox + ev.clientX - sx),
          ) + "px";
        d.style.top =
          Math.max(0, Math.min(s.h - 20, oy + ev.clientY - sy)) + "px";
      });
    });
    // A click on the blocked window brings its dialog back to attention.
    blocker.addEventListener("mousedown", function (e) {
      e.preventDefault();
      focusWin(win);
      rec.focus();
      d.classList.remove("flash");
      void d.offsetWidth;
      d.classList.add("flash");
    });
    return rec;
  }

  // ---------------------------------------------------------------- Start menu

  function setStart(open) {
    if (!startMenu || !startBtn) return;
    startMenu.hidden = !open;
    startBtn.classList.toggle("on", open);
    if (open) {
      var first = startMenu.querySelector(".menu-item:not(:disabled)");
      if (first) first.focus();
    }
  }

  if (startBtn && startMenu) {
    startBtn.addEventListener("click", function () {
      setStart(startMenu.hidden);
    });
    startMenu.addEventListener("click", function (e) {
      var item = e.target.closest(".menu-item");
      if (!item || item.disabled) return;
      setStart(false);
      var game = item.getAttribute("data-game");
      if (game) launch(game);
    });
    startMenu.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      var items = Array.prototype.slice.call(
        startMenu.querySelectorAll(".menu-item:not(:disabled)"),
      );
      var i = items.indexOf(document.activeElement);
      var next = e.key === "ArrowDown" ? i + 1 : i - 1;
      items[(next + items.length) % items.length].focus();
    });
  }

  document.addEventListener("mousedown", function (e) {
    var t = e.target;
    if (startMenu && !startMenu.hidden && !t.closest(".start")) setStart(false);
    wins.forEach(function (w) {
      if (!w.el.contains(t)) closeMenus(w);
    });
    // A click on a DiffPad window, or on its taskbar button, makes it the
    // active window again.
    if (t.closest("#app") || t.closest("#tasks")) setActive(null);
  });

  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey && e.key === "Escape") {
      e.preventDefault();
      setStart(startMenu.hidden);
      return;
    }
    if (e.key === "Escape" && startMenu && !startMenu.hidden) {
      setStart(false);
      startBtn.focus();
      return;
    }
    var win = active;
    if (!win || win.minimized || win.dialogs.length) return;
    if (e.key === "Escape" && closeMenus(win)) return;
    if (win.instance.onKey) win.instance.onKey(e);
  });

  Win95.openGame = launch;
  Win95.gameWindows = function () {
    return wins.slice();
  };
})();
