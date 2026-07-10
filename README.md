# Lectern

A speed-reading (RSVP) app: load a book, and it presents one word at a time
with the optimal-recognition-point letter fixed in place, so your eyes never
move. Built to train reading speed without losing comprehension.

## Features

- **Formats**: PDF, EPUB, TXT/Markdown, or pasted text — all parsed locally
  in the browser; nothing leaves your machine.
- **Adjustable speed**: 60–1200 wpm in 25 wpm steps.
- **Comprehension-aware pacing**: sentence ends (`.` `!` `?`) hold longer —
  adjustable from ×1 to ×5 with the "pause at ." slider — clause punctuation
  and paragraph breaks pause too, and long or numeric words get extra dwell
  time. Abbreviations like "Mr.", "Dr.", initials, and acronyms ("U.S.",
  "e.g.") are recognized and don't trigger the sentence pause.
- **Chapters**: jump between chapters from the EPUB table of contents, the
  PDF outline (bookmarks), or Markdown `#` headings.
- **Paragraph view**: pop up the paragraph you're in and click any word to
  jump straight to it.
- **ORP alignment**: each word is positioned so the same letter column hits
  the reading rail's tick, Spritz-style; that pivot letter is tinted amber.
- **Shelf**: books persist in localStorage with your reading position, so you
  can resume where you stopped.

## Keyboard

| Key | Action |
|---|---|
| `Space` | play / pause |
| `↑` / `↓` | faster / slower |
| `←` / `→` | previous / next sentence |
| `C` | show current paragraph (click a word to jump) |
| `T` | chapters |
| `Esc` | close popup / back to shelf |

Click the progress bar to scrub; click the stage to play/pause.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
```

With Nix: `nix develop` provides Node.
