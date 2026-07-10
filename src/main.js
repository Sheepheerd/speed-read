import "./style.css";
import { tokenize, sentenceStartBefore, sentenceStartAfter } from "./tokenize.js";
import { Reader } from "./reader.js";
import { extractSections, sectionsFromText } from "./extract.js";

const $ = (id) => document.getElementById(id);

const els = {
  library: $("screen-library"),
  reader: $("screen-reader"),
  dropzone: $("dropzone"),
  fileInput: $("file-input"),
  pasteArea: $("paste-area"),
  pasteGo: $("paste-go"),
  shelf: $("shelf"),
  shelfList: $("shelf-list"),
  loadStatus: $("load-status"),
  progress: $("progress"),
  progressFill: $("progress-fill"),
  bookTitle: $("book-title"),
  clock: $("clock"),
  stage: $("stage"),
  stageHint: $("stage-hint"),
  wordPre: $("word-pre"),
  wordOrp: $("word-orp"),
  wordPost: $("word-post"),
  btnPlay: $("btn-play"),
  btnPrev: $("btn-prev"),
  btnNext: $("btn-next"),
  btnBack: $("btn-back"),
  btnChapters: $("btn-chapters"),
  btnPara: $("btn-para"),
  wpmUp: $("wpm-up"),
  wpmDown: $("wpm-down"),
  wpmValue: $("wpm-value"),
  pauseRange: $("pause-range"),
  pauseValue: $("pause-value"),
  overlay: $("overlay"),
  panelTitle: $("panel-title"),
  panelBody: $("panel-body"),
  panelClose: $("panel-close"),
};

// ---------- persistence ----------
// Shelf entries: { id, title, words, index, addedAt }. Sections are stored
// separately under text:<id> as JSON so the index stays small.
const SHELF_KEY = "lectern.shelf";
const WPM_KEY = "lectern.wpm";
const PAUSE_KEY = "lectern.sentencePause";

const loadShelf = () => JSON.parse(localStorage.getItem(SHELF_KEY) ?? "[]");
const saveShelf = (shelf) => localStorage.setItem(SHELF_KEY, JSON.stringify(shelf));

function saveBook(title, sections) {
  const shelf = loadShelf();
  const id = `b${Date.now().toString(36)}`;
  shelf.unshift({ id, title, words: 0, index: 0, addedAt: Date.now() });
  try {
    localStorage.setItem(`lectern.text:${id}`, JSON.stringify({ v: 2, sections }));
  } catch {
    // Book too large for localStorage: keep it session-only.
    shelf[0].ephemeral = true;
    ephemeralTexts.set(id, sections);
  }
  saveShelf(shelf.slice(0, 20));
  return shelf[0];
}

const ephemeralTexts = new Map();

function bookSections(entry) {
  if (entry.ephemeral) return ephemeralTexts.get(entry.id);
  const raw = localStorage.getItem(`lectern.text:${entry.id}`);
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      return JSON.parse(raw).sections;
    } catch {
      /* fall through: treat as plain text */
    }
  }
  return sectionsFromText(raw); // books saved by the v1 format
}

function rememberPosition() {
  if (!current) return;
  const shelf = loadShelf();
  const entry = shelf.find((b) => b.id === current.id);
  if (entry) {
    entry.index = reader.index;
    entry.words = reader.tokens.length;
    saveShelf(shelf);
  }
}

// ---------- reader ----------
let current = null; // active shelf entry
let chapters = [];
let paragraphs = [];
let hintDismissed = false;

const reader = new Reader({
  onWord(token, index, total) {
    renderWord(token.text, token.orp);
    const pct = total > 1 ? (index / (total - 1)) * 100 : 100;
    els.progressFill.style.width = pct + "%";
    els.progress.setAttribute("aria-valuenow", Math.round(pct));
    if ((index & 15) === 0) updateClock();
  },
  onState(playing) {
    els.btnPlay.textContent = playing ? "Pause" : "Resume";
    els.reader.classList.toggle("is-playing", playing);
    if (playing && !hintDismissed) {
      hintDismissed = true;
      els.stageHint.classList.add("gone");
    }
    if (!playing) rememberPosition();
  },
  onDone() {
    els.btnPlay.textContent = "Read again";
    rememberPosition();
  },
});

reader.setWpm(Number(localStorage.getItem(WPM_KEY)) || 300);
els.wpmValue.textContent = reader.wpm;

const savedPause = Number(localStorage.getItem(PAUSE_KEY)) || 2.7;
els.pauseRange.value = savedPause;
applySentencePause(savedPause);

function applySentencePause(total) {
  const applied = reader.setSentencePause(total);
  els.pauseValue.textContent = "×" + applied.toFixed(2).replace(/\.?0+$/, "");
  localStorage.setItem(PAUSE_KEY, applied);
  updateClock();
}

function renderWord(word, orp) {
  els.wordPre.textContent = word.slice(0, orp);
  els.wordOrp.textContent = word[orp] ?? "";
  els.wordPost.textContent = word.slice(orp + 1);
}

function updateClock() {
  if (!reader.tokens.length) return;
  const min = Math.ceil(reader.remainingMs() / 60000);
  els.clock.textContent = min > 1 ? `${min} min left` : "under a minute";
}

function openBook(entry) {
  const sections = bookSections(entry);
  if (!sections) {
    setStatus(`"${entry.title}" was only kept for the session it was added in. Load the file again.`);
    return;
  }
  current = entry;
  const book = tokenize(sections);
  chapters = book.chapters;
  paragraphs = book.paragraphs;
  reader.load(book.tokens, entry.index || 0);
  els.bookTitle.textContent = entry.title;
  els.btnPlay.textContent = entry.index > 0 ? "Resume" : "Start";
  els.btnChapters.hidden = chapters.length < 2;
  hintDismissed = false;
  els.stageHint.classList.remove("gone");
  updateClock();
  showScreen("reader");
}

function backToLibrary() {
  closeOverlay();
  reader.pause();
  rememberPosition();
  current = null;
  renderShelf();
  showScreen("library");
}

function showScreen(which) {
  els.library.hidden = which !== "library";
  els.reader.hidden = which !== "reader";
}

// ---------- overlay: chapters & current paragraph ----------
function openOverlay(title) {
  els.panelTitle.textContent = title;
  els.panelBody.replaceChildren();
  els.overlay.hidden = false;
}

function closeOverlay() {
  els.overlay.hidden = true;
}

function currentChapterIndex() {
  let ci = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= reader.index) ci = i;
    else break;
  }
  return ci;
}

function showChapters() {
  reader.pause();
  openOverlay("Chapters");
  const ci = currentChapterIndex();
  const list = document.createElement("ol");
  list.className = "chapter-list";
  chapters.forEach((ch, i) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "chapter-item" + (i === ci ? " current" : "");
    btn.textContent = ch.title;
    btn.addEventListener("click", () => {
      reader.seek(ch.start);
      updateClock();
      closeOverlay();
    });
    li.append(btn);
    list.append(li);
  });
  els.panelBody.append(list);
  list.querySelector(".current")?.scrollIntoView({ block: "center" });
}

function showParagraph() {
  const token = reader.tokens[reader.index];
  if (!token) return;
  reader.pause();
  openOverlay("Where you are");
  const para = paragraphs[token.para];
  const p = document.createElement("p");
  p.className = "para-text";
  for (let i = para.start; i < para.start + para.count; i++) {
    const w = document.createElement("button");
    w.className = "pword" + (i === reader.index ? " current" : "");
    w.textContent = reader.tokens[i].text;
    const target = i;
    w.addEventListener("click", () => {
      reader.seek(target);
      updateClock();
      closeOverlay();
    });
    p.append(w, " ");
  }
  els.panelBody.append(p);
  p.querySelector(".current")?.scrollIntoView({ block: "center" });
  p.querySelector(".current")?.focus();
}

els.panelClose.addEventListener("click", closeOverlay);
els.overlay.addEventListener("click", (e) => {
  if (e.target === els.overlay) closeOverlay();
});

// ---------- library ----------
function setStatus(msg) {
  els.loadStatus.textContent = msg;
}

async function handleFile(file) {
  setStatus(`Reading ${file.name}…`);
  try {
    const sections = await extractSections(file);
    if (!sections?.length) throw new Error("No text found in this file");
    setStatus("");
    const title = file.name.replace(/\.(pdf|epub|txt|md|text)$/i, "");
    openBook(saveBook(title, sections));
  } catch (err) {
    setStatus(`Couldn't read ${file.name}: ${err.message}`);
  }
}

function renderShelf() {
  const shelf = loadShelf();
  els.shelf.hidden = shelf.length === 0;
  els.shelfList.replaceChildren(
    ...shelf.map((entry) => {
      const li = document.createElement("li");
      const open = document.createElement("button");
      open.className = "shelf-book";
      open.innerHTML = `<span class="shelf-title"></span><span class="shelf-meta"></span>`;
      open.querySelector(".shelf-title").textContent = entry.title;
      const pct = entry.words ? Math.round((entry.index / entry.words) * 100) : 0;
      open.querySelector(".shelf-meta").textContent =
        pct > 0 ? `${pct}% read` : "not started";
      open.addEventListener("click", () => openBook(entry));
      const del = document.createElement("button");
      del.className = "shelf-remove";
      del.title = `Remove ${entry.title}`;
      del.textContent = "×";
      del.addEventListener("click", () => {
        localStorage.removeItem(`lectern.text:${entry.id}`);
        saveShelf(loadShelf().filter((b) => b.id !== entry.id));
        renderShelf();
      });
      li.append(open, del);
      return li;
    })
  );
}

// ---------- controls ----------
function nudgeWpm(delta) {
  const wpm = reader.setWpm(reader.wpm + delta);
  els.wpmValue.textContent = wpm;
  localStorage.setItem(WPM_KEY, wpm);
  updateClock();
}

els.btnPlay.addEventListener("click", () => reader.toggle());
els.btnPrev.addEventListener("click", () =>
  reader.seek(sentenceStartBefore(reader.tokens, reader.index - 1))
);
els.btnNext.addEventListener("click", () =>
  reader.seek(sentenceStartAfter(reader.tokens, reader.index))
);
els.btnBack.addEventListener("click", backToLibrary);
els.btnChapters.addEventListener("click", showChapters);
els.btnPara.addEventListener("click", showParagraph);
els.wpmUp.addEventListener("click", () => nudgeWpm(25));
els.wpmDown.addEventListener("click", () => nudgeWpm(-25));
els.pauseRange.addEventListener("input", () =>
  applySentencePause(Number(els.pauseRange.value))
);

els.progress.addEventListener("click", (e) => {
  const rect = els.progress.getBoundingClientRect();
  const frac = (e.clientX - rect.left) / rect.width;
  reader.seek(Math.round(frac * (reader.tokens.length - 1)));
  updateClock();
});

els.stage.addEventListener("click", () => reader.toggle());

document.addEventListener("keydown", (e) => {
  if (els.reader.hidden) return;
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

  if (!els.overlay.hidden) {
    if (e.key === "Escape" || e.key.toLowerCase() === "c" || e.key.toLowerCase() === "t") {
      e.preventDefault();
      closeOverlay();
    }
    return;
  }

  switch (e.key) {
    case " ":
      e.preventDefault();
      reader.toggle();
      break;
    case "ArrowUp":
      e.preventDefault();
      nudgeWpm(25);
      break;
    case "ArrowDown":
      e.preventDefault();
      nudgeWpm(-25);
      break;
    case "ArrowLeft":
      e.preventDefault();
      reader.seek(sentenceStartBefore(reader.tokens, reader.index - 1));
      break;
    case "ArrowRight":
      e.preventDefault();
      reader.seek(sentenceStartAfter(reader.tokens, reader.index));
      break;
    case "c":
    case "C":
      e.preventDefault();
      showParagraph();
      break;
    case "t":
    case "T":
      if (chapters.length > 1) {
        e.preventDefault();
        showChapters();
      }
      break;
    case "Escape":
      backToLibrary();
      break;
  }
});

// ---------- library inputs ----------
els.dropzone.addEventListener("click", () => els.fileInput.click());
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    els.fileInput.click();
  }
});
els.fileInput.addEventListener("change", () => {
  if (els.fileInput.files[0]) handleFile(els.fileInput.files[0]);
  els.fileInput.value = "";
});

for (const evt of ["dragover", "dragenter"]) {
  document.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("dragging");
  });
}
for (const evt of ["dragleave", "drop"]) {
  document.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("dragging");
  });
}
document.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file && !els.library.hidden) handleFile(file);
});

els.pasteGo.addEventListener("click", () => {
  const text = els.pasteArea.value.trim();
  if (!text) return;
  const title = text.split(/\s+/).slice(0, 6).join(" ") + "…";
  els.pasteArea.value = "";
  openBook(saveBook(title, sectionsFromText(text)));
});

window.addEventListener("beforeunload", rememberPosition);

renderShelf();
renderWord("Lectern", 1);
