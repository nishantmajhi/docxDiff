# docxDiff — review and remediation record

First reviewed 2026-09-04. Remediated 2026-09-19 on branch `cleanup/2026-09-19`.
Reworked by the author on 2026-10-04 into a Windows 95 desktop with games; see
the last two sections. 169 tests, `npm test`, and 19 browser checks,
`npm run test:browser`, all passing.

Everything up to "Original column's scrollbar" describes the single-file page
as it was then. Where it names `index.html` as the application, the same code
is now `js/app.js`; the fixes themselves carried over unchanged.

---

## Corrections to the first review

Three of its claims were wrong, and the first is the one that matters.

**1. "The escaping in particular is done consistently … No injection issues
found." This is wrong. There were four injection sinks, and two of them had no
escaping at all.**

`escapeHtml` escaped `&`, `<` and `>` — but not `"`. Document content is put
into attribute values in six places (`title=`, `data-href=`, `id=`, `href=`),
so a double quote in any of them closed the attribute and everything after it
became markup. The review checked the insert and delete render paths, which are
element content, and generalised from there.

Worse, two values never went through `escapeHtml` at all. A run colour was
interpolated straight into `style="color:#…"`, and a table cell's shading
straight into `style="background:#…"`. Both come from the document.

Reproduced against the original, all four:

| Source | Output from the original code |
| --- | --- |
| `w:color/@w:val` | `<span style="color:#red" onmouseover="alert(1);">` |
| `w:shd/@w:fill` | `<div class="row-cell" style="background:#fff;"><img src=x onerror="alert(1);">` |
| `w:ins/@w:author` | `title="Tracked insertion by X" onmouseover="alert(1)"` |
| hyperlink `Target` | `data-href="https://x/" onmouseover="alert(1)"` |

These are in `tests/original.test.js`. The exported HTML file carries the same
markup, so a hostile document produced a file that ran script wherever it was
later opened — in a tool whose entire selling point is that documents stay on
your machine.

**2. Finding 4, "Only `word/document.xml` is read. Headers, footers, comments
and tracked changes live in other parts of the package and are silently
excluded", is wrong.** The original already read `word/header*.xml`,
`word/footer*.xml`, `word/footnotes.xml` and `word/comments.xml`, resolving each
through the relationship part, and rendered tracked changes with their authors.
The status bar in the original says so. Nothing needed doing here.

What *was* silently excluded is content controls, text boxes and nested tables —
which the review did not mention, and which is the same failure it was reaching
for. See below.

**3. The P1 memory table is right in shape and wrong in scale.** Its column is
headed "Tokens per document" and its conclusion is that "a forty-page report is
roughly twenty thousand words", so the tool "fails on the documents someone
would actually want to compare". But the table is allocated over **blocks** —
paragraphs and table rows — not words. The two sample documents are 27 blocks.
A forty-page report is a few hundred blocks, which is under a megabyte and
about 25 ms; measured here, 4,000 blocks a side was 64 MB and 2.5 seconds.

The problem is real but it starts at a book, a long table, or — the case the
review's own numbers actually describe — a single paragraph of twenty thousand
words, because the same function does the word-level diff inside a changed
paragraph. It is fixed either way.

---

## Fixed

Each of these was reproduced against the baseline commit first; the
reproductions are kept in `tests/original.test.js`, which asserts the bug is
*present* in the original so that no regression test here can quietly stop
testing anything.

### P1 — a document could inject markup into the page and into the export

`escapeHtml` now escapes both kinds of quote as well as the angle brackets.
Colours are not escaped but **validated**: `w:color/@w:val` and `w:shd/@w:fill`
are six hex digits in OOXML, so anything that is not six hex digits is
discarded rather than interpolated. That is the archive's rule — check against
the set of good values, never against a description of the bad ones — and it
also quietly disposed of `auto`, which the original special-cased by name.

The tests for this do not pattern-match on payloads. Each renders the same
document twice, once with a hostile string and once with an inert one, and
requires the two outputs to have the same elements with the same attributes in
the same order. Content that cannot change the shape of the markup cannot
inject anything, whatever it says, and a new payload needs no new assertion.

### P1 — any document with footnotes differed from itself

`extractDocxStructured` mints a random `docId` per call and bakes it into the
anchor ids of footnote references, so that the two panes do not collide in the
DOM. But those ids are part of `b.html`, and `b.html` is what `buildRows`
compared to decide "formatting changed".

So two reads of the *same file* produced different markup for every paragraph
containing a footnote. `report_v1.docx` compared with itself reported two
formatting changes. Every document with footnotes was noisy, always, and the
noise was in the one column a reader trusts to be quiet.

Blocks now also carry `fmtKey` — the same markup with the per-read id removed —
and that is what the comparison uses. `report_v1.docx` against itself is now
0 removed, 0 added, 0 formatting.

### P1 — whole sections of a document were never read

`extractBlocksFromContainer` looked only at the *direct children* of the body
for `w:p` and `w:tbl`. Anything wrapped in something else was dropped without a
word:

- **Content controls (`w:sdt`).** Word wraps a table of contents, form fields,
  citations, cover-page fields and whole templated sections in these.
- **Nested tables.** A cell's paragraphs were read with `childrenLocal(tc, "p")`,
  so a table inside a cell contributed nothing.
- **Text boxes.** A run's children were matched against a fixed list, and
  `w:pict` was not on it, so callouts and sidebars — VML and DrawingML alike —
  came out empty.

A diff tool that cannot read a section reports it as unchanged. That is the one
answer it must never give, and it gave it silently.

The container walk now recurses through anything that is not itself a paragraph
or a table; cells collect their descendant paragraphs; and a run walks into
children it does not recognise. Text-box paragraphs are flattened into the
paragraph that anchors the box, which is where they sit in the reading order.

### P1 — the diff exhausted memory on large documents

`lcsDiff` allocated the full `(n+1) × (m+1)` table of 32-bit cells every time.

It now allocates that table only below four million cells — where it is the
same code as before, producing byte-identical output, which 1,500 random pairs
assert against the original. Above the limit it trims the common head and tail
and runs Myers' algorithm, whose cost depends on how much the documents differ
rather than how long they are. Past a budget on that too, it pairs the two
sides off in order: coarser, still correct, and immediate.

Measured here, on the case that matters — two 20,000-block documents with 82
edits between them:

| | before | after |
| --- | --- | --- |
| memory | 1.6 GB | 13 MB |
| time | ~60-80 s | 3 ms |

The "before" figures are extrapolated, because that case cannot actually be
run: the allocation fails first. They come from measuring the original at
1,000, 2,000, 3,000 and 4,000 blocks (201 ms, 630 ms, 1.6 s, 2.6 s) and scaling
by n squared, which those four points fit closely. The memory figure is exact
arithmetic: 20,001 squared cells at four bytes.

2,000 random pairs assert that the new path returns a *shortest* edit script,
checked against an independently written LCS length rather than against the
app's own.

### P2 — an image beside a word printed its own internal token

Images are diffed as a token: U+FFFC followed by a fingerprint of the bytes.
The word tokeniser split on whitespace and on footnote tokens, but had no rule
for image tokens — so `fig<image>one` was one word, matched nothing in the token
map, and was printed verbatim. The page showed
`fig￼1892:AABJRU5ErkJggg==one`.

Both token kinds are now closed by a second marker, so a token ends where its
own marker is rather than at the next space, and both are built by one helper
used by the text and by the map so the two cannot drift. Marker characters
occurring in a document's own text are dropped from the alignment text so they
cannot forge one.

### P2 — run properties that were switched off were read as on

In OOXML a toggle is on when present *unless* its `w:val` says otherwise, and
Word writes `<w:b w:val="0"/>` whenever a run turns off something its paragraph
style switched on. The original tested for presence, so text the document says
is not bold rendered bold; likewise `<w:u w:val="none"/>` and
`<w:i w:val="false"/>`. Since markup is what "formatting changed" compares,
this was also a source of wrong verdicts. There is now an `onOff` helper.

### P2 — a wholly deleted paragraph never matched its own copy

A paragraph with no accepted text but visible markup is given a synthetic key so
it cannot be confused with a blank one. The key used a counter — which ran
across *both* documents, so the same paragraph got a different key on each side
and always came out as one removal plus one addition. The key is now the markup
itself, which keeps the original intent (it still cannot collide with an
unrelated blank) and drops the guaranteed false difference.

### P2 — the file picker swallowed every error

`showDropzoneError` returns immediately if it is not given an element, and the
`onchange` handlers called `handleFile` without one. Dropping a bad file showed
a message; **choosing the same file through the browse dialog did nothing at
all** — no message, no spinner, no change on screen. Both routes now pass the
dropzone.

### P2 — JSZip was fetched from a CDN with no integrity attribute

The review asked for a subresource-integrity hash. That was not possible here:
computing one means having the exact bytes cdnjs serves for 3.10.1, and a wrong
hash breaks the page completely.

The library is vendored instead, at `vendor/jszip.min.js` (3.10.2, unmodified,
MIT, licence alongside it). This is strictly better than a hash for this
project. The page's promise is that documents never leave the machine, and a
page that fetches its unzipper from someone else's server on every load cannot
make that promise — whoever serves that file can read every document opened
here. It also means the tool works with no network at all, which is the other
half of the same claim, and it is now true rather than aspirational.

`tests/vendor.test.js` loads the vendored file the way a `<script>` tag would
and drives the whole application through it, so the copy is known to work
rather than assumed to. `tests/app.test.js` fails if any remote URL or network
call ever reappears in the page.

### P3 — `.docm` was refused

Same package, macros allowed inside. Nothing here runs them; only
`word/document.xml` and its relations are read. Accepted now. The file input's
`accept` list was widened to match — see "One UI-adjacent change" below.

### P3 — the export raced its own download

The anchor was never put in the document, which Firefox requires for a
programmatic click to count, and `URL.revokeObjectURL` was called on the line
after `click()`, which can revoke the blob before the browser has taken it. The
anchor is now appended and removed, and the revoke is deferred a second.

---

## One UI-adjacent change, flagged

`CLAUDE.md` says business logic only. Accepting `.docm` required widening the
file input's `accept` attribute from `.docx` to `.docx,.docm`; leaving it would
have meant the validation accepted a file the picker would not offer. It is one
attribute and it follows the review's own P3 request. Nothing else about the
layout, styling, copy or interaction was touched — the error messages are the
ones that were already there, and the fix was making them appear at all.

---

## Deliberately not done

**~~The single-file structure is kept.~~ Superseded 2026-10-04: the author's
rework split the page into `index.html`, `css/` and `js/`.** The first review
suggested splitting parser / diff / render into modules with a build step that
inlines them again, and that was not done, because being one file that opens
from a USB stick with no toolchain is a real feature of this tool. The rework
keeps that feature another way. There is still no build step, every file is
loaded by a relative path, and the folder still opens from `file://`. Only now
the whole folder has to travel, not just `index.html` and `vendor/`.

**No LICENSE was added.** The review asked for one. Choosing a licence is the
author's decision, not a cleanup decision, so `package.json` deliberately
asserts none. JSZip's own licence is in `vendor/`.

**Every header and footer part is shown separately.** Word can store up to
three of each in one section — first page, even, odd — and where it does, a
document will show what is largely the same header more than once. Both sample
documents have a single header and a single footer, so this was not observed
here; it is noted because the code plainly does it and because de-duplicating
would mean guessing which of the three the reader meant. Faithful to the
package is the safer default for a diff tool.

**Styles are not resolved.** Bold that comes from a paragraph style rather than
from a run is not seen, so a formatting change made by editing the style is
missed. Fixing it means reading `word/styles.xml` and walking the inheritance
chain, which is a real piece of work and was not in the review.

**`w:sectPr`, numbering definitions and document properties are still not
compared.** Out of scope, and now stated in the README rather than left to be
discovered.

---

## Notes for whoever is next

**~~This has never been opened in a browser.~~ It has now — `npm run
test:browser`, added 2026-09-24. Both checks below passed.** The note said
"nothing in this environment can open a page", which was true when it was
written and stopped being true on 2026-09-19, when the MDview pass established
that Chrome runs a page under `--headless=new --dump-dom` with no driver, no
protocol client and no dependency. Left here as written so the correction has
something to correct.

The two checks it asked for, both now automated in `tests/browser/`:

1. **The page opened from a `file://` URL with nothing on the network, and
   diffed the two files in `tests/fixtures/` completely.** This is the
   vendoring change and it was the one worth confirming: `vendor/jszip.min.js`
   is a *relative* reference, and the Node tests read that library by absolute
   path, so a wrong path there would pass all 121 of them and still ship a page
   that does nothing at all. The run asserts `JSZip` is defined, that
   `location.protocol` really is `file:`, and that no `fetch` or
   `XMLHttpRequest` happened at all.
2. **A real download was watched.** `URL.createObjectURL` and the anchor's
   `click()` are intercepted, so the run asserts the file is named
   `docxdiff-export.html`, that the anchor was **in the document** when it was
   clicked — Firefox ignores a click on a detached one — that the exported HTML
   holds both file names and the diff grid, and that the object URL was **not**
   revoked before the click. That last one is the P3 fix above, and nobody had
   watched it.

It also does something the manual check could not: it asserts the counts the
real page produces are the same `{ removed: 10, added: 20, fmt: 3 }` that
`tests/app.test.js` asserts against the fake file and the shim zip reader. That
is the whole Node suite's model of a `File` — `{ name, arrayBuffer() }` — being
checked against a real `File` arriving through a real `<input type="file">`.

The fixtures are handed to the page as base64 in a generated script rather than
fetched, because a `file://` page cannot read its siblings without loosening
Chrome's file access, and loosening it would make the run *less* like the one a
user gets.

**Everything passed, so the suite was shown to be capable of failing.** The
script tag was temporarily pointed at `vendors/jszip.min.js` — one letter, the
exact mistake the check exists to catch — and 6 of the 8 checks failed, the
first naming the cause: *JSZip is undefined: vendor/jszip.min.js did not load
from a file:// URL*. The mutation was reverted.

One trap, found by that mutation and worth knowing before writing another of
these. `--virtual-time-budget` has to exceed the driver's **own** timeouts
added together, not the time a passing run takes. The first version budgeted 20
seconds while the failure path waited 15 then 10, so Chrome dumped the DOM
before the driver published and the runner reported "the page produced no
results" instead of the failure — on exactly the run where the output mattered.
It is 60 seconds now. Virtual time costs nothing.

Nothing else needs a browser: the parser, the diff, the rendering and the error
paths are all covered.

It is a separate script rather than part of `npm test`, so the recorded count
stays **121** and the archive's verify sweep does not acquire a dependency on a
browser. With none installed it exits 0 and says SKIP.

**Read `tests/harness.js` before adding a test.** It unwraps the IIFE in
`js/app.js` (or, for `loadOriginal()`, the inline script of the baseline
`index.html`) so every top-level function lands on the vm context. It asserts on the exact
wrapper text, so if the file is ever restructured the harness fails loudly
instead of silently testing a different thing.

**Two traps that cost time here.**

`assert.deepStrictEqual` compares prototypes, so an array that came out of the
vm context never equals a local literal — the failure reads "Values have same
structure but are not reference-equal", which is baffling until you know. Wrap
the result in `Array.from`.

A test process waits for pending timers. The export's deferred
`revokeObjectURL` held every test file that exported once open for the whole
delay: two files took exactly 60 seconds each and nothing looked wrong. The
harness now `unref`s the timers it hands the page.

**If you are testing anything that assigns to `innerHTML`, steal the shape
check in `tests/escape.test.js`.** Rendering twice — once with a hostile string,
once with an inert one — and comparing the tag-and-attribute shape is about
thirty lines, needs no payload list to be kept up to date, and catches the
class of bug rather than the instance. It found all four sinks here and it
would have found them in the first review.

**`tests/docx.js` builds real OOXML packages.** If you need a document with a
nested table, a text box, a tracked deletion or a hostile author name, build one
rather than hunting for a sample that has one.

## Licence, 2026-10-02

The author chose one licence for all of their projects: free for personal,
non-commercial use, modifiable for the user's own use, and not to be
distributed, original or modified. No standard licence says that, so `LICENSE`
is a short custom text, the same in every project apart from the year and what
it excludes. The README's licence section says the same, and `package.json`
declares `SEE LICENSE IN LICENSE`, npm's form for a licence with no SPDX
identifier. Anything above that calls the licence an open question, or calls
the project MIT, is superseded.

## CI, 2026-10-02

`.github/workflows/ci.yml` runs the node checks and the browser suite as two
jobs on `ubuntu-latest`. Nothing has been pushed, so it has not run on GitHub
yet. Every job was run before committing, from a fresh clone of this branch,
the way a runner would run it: Linux jobs in a throwaway Ubuntu 24.04 (the
image `ubuntu-latest` uses) with the same tool versions. 121 and 8.

The node job fetches full history, which `tests/harness.js` reads; without it
the suite fails (checked). The browser job fails if the runner prints `SKIP`,
which it does when it finds no Chrome; otherwise a missing browser would read
as a pass.

## Original column's scrollbar, 2026-10-04

The author reported that the Original (left) pane showed no scrollbar. The
diff is one grid inside one scroller (`.diff-scroll`), which is what keeps a
row's two sides level and scrolling together. That scroller's only scrollbar
sat at the right edge of the Updated column. Splitting the grid into two
scrollers would have meant equalising row heights by hand to keep the
columns level, and the author asked for the linked scrolling to stay.

So the grid is unchanged. `mountOriginalScrollbar()` adds a thin, empty
scroll track (`.diff-scrollbar-left`, `aria-hidden`) at the Original column's
right edge. It is as tall as the diff and has the same scroll range, and each
of the two follows the other. A `ResizeObserver` keeps its position and range
right through window resizes and late layout changes. It is hidden under
760px, where the grid is a single column and the diff's own scrollbar is
already beside it. Each side ignores the scroll event caused by its own copy,
so an echo cannot pull a smooth scroll back a frame. Its track has 1px of
width, because Chrome does not count a zero-width box as overflow and the bar
would not scroll at all. The browser suite caught that.

The browser suite gains three checks (now 11): the Original column has a
scrollbar beside it with the diff's height and range; moving either one moves
the other; both columns are still in the one scroller. The first two fail
against the old page, which has one scrollbar at x=710–725 and an Original
column that ends at x=339. `--dump-dom` delivers only the first scroll event
of a run, so those checks dispatch the event themselves. The real behaviour
was checked separately in headless Chrome over the DevTools protocol, with
real frames and real input. Wheel input over either column or over the new
bar kept both at the same position (600, 960, 480). Dragging the new thumb
150px moved both to 511. After a resize to 1000×650 the bar moved with the
column (x=457), and at 700px it was hidden. Node suite: 121 of 121.

## Windows 95 desktop and games, 2026-10-04

The author supplied a reworked project as `docxDiff.zip`, and it was put in
this folder over the old tree as one commit, unedited. It is still docxDiff:
the parser, the diff engine and the renderer are the code above, moved out of
the inline script into `js/app.js`. What changed is everything around them.

- **The page is a Windows 95 desktop.** Each document sits in its own
  "DiffPad" window, original on the left and updated on the right, with a
  title bar, a File and Help menu and a status bar. The status bar replaces
  the old single one and the menus replace the old button row: Open and Close
  per window, Export diff in File, About in Help or F1. Start over is in the
  taskbar's Start menu. The linked scrolling and the Original column's
  scrollbar from the section above are kept.
- **The Start menu has FreeCell, Hearts, Minesweeper and Solitaire**, each in
  a window that can be minimized, maximized and closed, with a taskbar button.
  The rules are kept apart from the windows in each `js/games/*.js` so they
  can be tested in Node. Settings, best times and statistics go in
  `localStorage`, and the games still play when it is unavailable.
- **The page is split into files:** `css/style.css`, `css/games.css`,
  `js/app.js`, `js/desktop.js` and `js/games/`. `index.html` holds only the
  desktop, taskbar, Start menu and About box.

The tests came in the zip too. `tests/harness.js` now unwraps `js/app.js`, and
still reads the inline script out of the baseline commit for
`tests/original.test.js`, so the check that each fixed bug is present in the
original still runs. `tests/app.test.js` drives the window menus where it used
to click the old buttons. It also checks that the page loads only its own
relative files and that no remote URL or `fetch` appears in any of them.
`tests/games.test.js` is new: FreeCell deals against Microsoft's numbering,
Solitaire scoring, Minesweeper's safe first click, and 500 computer-played
hands of Hearts with every card checked. The browser suite copies `css/` and
`js/` into its scratch directory and gains checks that open, play, minimize,
maximize and close the games.

Run here before committing: **165 of 165** in the Node suite and **18 of 18**
in headless Chrome 154, from a `file://` URL with no network request.

In the same commit series, the comments in `tests/docx.js`, `tests/xml.js`,
`tests/zip.js` and `tests/vendor.test.js` that still called `index.html` the
application, or said JSZip came from a CDN, were corrected. That was the
only change made to the author's files.

**Not done.** The games were not given the review the docx code had. The
suite above passes and they were checked to load nothing over the network,
but nobody has read them hunting for bugs. That is the obvious next pass if
the project is picked up again.

## A favicon, 2026-10-06

**Where it ended up.** The page has a favicon, `favicon.svg`, linked from
`index.html`. It draws the Start button's four-colour flag, and it is the
browser tab's icon and nothing else. The DiffPad windows keep their document
icon in the title bar and on the taskbar button, drawn inline in `js/app.js`
exactly as before. The Start button keeps its own inline copy of the flag.

**How it got there, because the history has three commits in it.** The
author's first request was read as "make the title bar icon the favicon". The
page had no favicon then. No version of `index.html` ever linked one, and
GitHub Pages is not enabled on the repository (checked with `gh api`), so it
inherited none. So `favicon.svg` was made from the document icon, and the
title bars and taskbar buttons were switched to draw that file (`a21b8dd`).
The author then asked for the Start button's flag instead, and that was read
as applying to the windows too (`65f79d0`). It did not: the author wanted the
flag in the tab only. The third commit put the windows' icon back.
`js/app.js` is byte-identical to `875e27b`, from before any of this.

Tests, each confirmed to fail against the commit before it:

- `index.html` links a favicon that is a local file and exists.
- `favicon.svg` draws the same five shapes as the Start button, compared
  shape by shape. This records the author's choice and does not protect
  anything in the code. If the favicon should ever differ from the Start
  button, delete the test.
- Both title bars, before and after a diff, and both taskbar buttons show the
  inline document icon and do not reference the favicon. The taskbar test
  needed `#tasks` registered in `tests/harness.js`. Without it,
  `renderTasks()` returned early under Node, so the taskbar had never been
  rendered by a test before.
- In the browser suite, the favicon loads from its relative path on a
  `file://` page. Pointing the link at `favicons.svg` made it fail and name
  the missing file. The runner copies `favicon.svg` into its scratch
  directory so that path is really exercised.

`favicon.svg` is also in the no-remote-reference sweep, since an SVG can load
things. 169 of 169 and 19 of 19.
