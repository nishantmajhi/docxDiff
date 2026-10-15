# docxDiff

Compare two Word documents side by side and see what changed, word by word.

Open `index.html` in a browser. There is no build step, no install, and no
server.

## Why this rather than an online diff tool

**The documents never leave the machine.** The page reads both files with the
browser's own file API, unzips them in memory, and renders the comparison.
Nothing is uploaded, and nothing is fetched: the one library it uses is in
`vendor/`, so the page makes no network request at all and works with the
network off entirely. A test asserts that — `tests/app.test.js` fails if a
remote URL or a `fetch` ever appears in the page.

That matters because the documents people most want to compare are the ones
they are least able to paste into a website: contracts under negotiation,
drafts under embargo, anything with a client's name in it.

## What it compares

Word stores a `.docx` as a zip of XML parts, and most of the document is not in
the part people expect. docxDiff reads:

|                     |                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Body text           | paragraphs, headings, lists                                                                   |
| Tables              | every row, including tables nested inside cells                                               |
| Headers and footers | each one, labelled                                                                            |
| Footnotes           | with the reference and the note linked to each other                                          |
| Comments            | with the author's name                                                                        |
| Content controls    | the `w:sdt` wrappers Word puts around a table of contents, form fields and templated sections |
| Text boxes          | callouts and sidebars, both the VML and DrawingML kinds                                       |
| Images              | shown inline, and compared — a replaced picture is a change                                   |
| Hyperlinks          | the target is compared, not just the visible text                                             |
| Tracked changes     | insertions and deletions are shown as such, with the author                                   |

It does **not** compare: the styles themselves (only how a paragraph ends up
looking), section and page setup, embedded objects other than images,
numbering definitions, or document properties.

## How the comparison works

Both documents are flattened into a list of **blocks** — one per paragraph, and
one per table row. Each block gets two strings: the text it will be aligned on,
and the markup it will be drawn with.

The two lists are aligned with a longest-common-subsequence diff, which gives
four kinds of row:

- **equal** — same text, same formatting.
- **formatting changed** — same text, different markup. Shown in amber.
- **removed** / **added** — a block that exists on only one side.
- **modified** — a removed block and an added block that line up, which then
  gets a second, word-level diff inside it so the actual wording change is
  visible rather than the whole paragraph being highlighted.

The counts in the status bar are of rows, not of words.

Images and footnote references have no text of their own, so each is given a
marked token in the text used for alignment — an image by a fingerprint of its
bytes, so the _same_ picture in both documents compares equal and a different
one does not. The tokens are drawn back as the picture or the marker when the
row is rendered.

### Size

The straightforward LCS table costs `n × m` cells, which is fine for a report
and fatal for a book: 20,000 blocks a side would be 1.6 GB. Above four million
cells the comparison switches to Myers' algorithm, whose cost depends on how
much the two documents _differ_ rather than on how long they are — so two
revisions of a long document, which is the case that matters, are fast. Two
20,000-block documents with eighty edits between them take a few milliseconds.

Below that limit the original table is used unchanged, so ordinary documents
diff exactly as they always did. If even Myers runs past its budget — two large
documents with almost nothing in common — the comparison stops searching for
the shortest answer and pairs the two sides off in order instead. The result is
still a correct rendering of both documents, just a coarser one. It never
hangs.

## Using it

1. Open `index.html`. It looks like a Windows 95 desktop with two DiffPad
   windows side by side: the original document on the left, the updated one
   on the right.
2. Drop a `.docx` on each window, or click to browse. `.docm` works too.
3. The comparison appears as soon as both are loaded. Each window's status
   bar shows its count: removed on the left, added or changed and
   formatting-only on the right.
4. The **swap** button in either title bar reverses the two sides. In a
   window's **File** menu, **Open…** loads a different document into that
   window and **Close** empties it. **Start over**, in the taskbar's Start
   menu, clears both.
5. **Export diff**, in either window's File menu, saves the comparison as a
   standalone HTML file with the styling inlined, so it can be sent to
   someone who does not have this page.
6. **Help > About docxDiff**, or F1, says what is compared.

The Start menu also has the four games Windows 95 came with — **FreeCell**,
**Hearts**, **Minesweeper** and **Solitaire** — each in a window of its own
above the two DiffPad windows, with minimize, maximize and close buttons, a
taskbar button, and its own menus. They are complete games: Minesweeper's
levels, custom field, chording and best times; Solitaire's Draw One or Three,
Standard and Vegas scoring, Undo, card backs and the bouncing cards when you
win; FreeCell's numbered deals (game #1 is the same game #1 Windows dealt),
supermoves, Undo and statistics; Hearts against three computer players,
passing, and shooting the moon. Best times, statistics and settings are kept
in the browser's local storage, and the games play without it.

## Layout

```
index.html                 the page: desktop, taskbar, Start menu, About box
favicon.svg                the browser tab's icon, the Start button's flag
css/style.css              the Windows 95 look and the DiffPad windows
css/games.css              the game windows, dialogs, cards and games
js/app.js                  the parser, diff engine, renderer and DiffPad UI
js/desktop.js              the Start menu, and windows for the games
js/games/cards.js          card faces and backs, and dragging cards
js/games/*.js              Minesweeper, Solitaire, FreeCell and Hearts
vendor/jszip.min.js        the unzipper, kept locally so the page needs no
                           network (MIT; licence alongside it)
tests/                     the test suite
tests/fixtures/*.docx      a real before-and-after pair used by the tests
```

There is no build step on purpose — the folder can be copied to a USB stick,
opened from a file:// URL on a machine with no toolchain, and it will work.
Every file is referenced by a relative path, so `favicon.svg`, `css/`, `js/`
and `vendor/` have to travel with `index.html`. The page uses only system fonts
and local icons, so the look needs no network either.

## Tests

```
npm test
```

No dependencies to install; the suite runs on `node --test` alone. 169 checks.

The tests load the real `js/app.js` into a `node:vm` context and call its
internals directly — see `tests/harness.js`, which also explains how. The
browser globals the page needs are supplied by `tests/xml.js` (a small XML DOM
matching what `DOMParser` gives for the properties the parser uses) and
`tests/zip.js` (a zip reader and writer, plus a stand-in for the slice of JSZip
the page calls). `tests/docx.js` builds `.docx` fixtures, so a test can
construct a document with a nested table or a hostile author name rather than
hoping one of the samples happens to have one.

`tests/vendor.test.js` does not use the stand-in: it loads the real vendored
JSZip the way a `<script>` tag would and drives the whole application through
it, which is what confirms the vendored copy actually works.

`tests/games.test.js` drives the games' rules, which each game file keeps
apart from its window: FreeCell's deals against Microsoft's own, Solitaire's
scoring, Minesweeper's first click, and 500 hands of Hearts played by the
computer players with every card checked. `npm run test:browser` opens the
page in headless Chrome and also opens, plays, minimizes, maximizes and
closes the games.

`tests/original.test.js` is the unusual one. It loads `index.html` out of the
baseline commit, when the whole application was still one file, and asserts
that each bug this project was fixed for is _present_ there. Its job is to keep the rest of the suite honest: a regression
test that also passes against the unfixed code was never testing anything.

## Licence

Free for personal, non-commercial use. You may use, study and modify this
software for yourself, but you may not use it commercially, and you may not
share or publish it, in its original form or modified. See [LICENSE](LICENSE)
for the full terms.

JSZip, in `vendor/`, keeps its own licence, which is beside it.
