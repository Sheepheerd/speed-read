// Turn extracted sections into display tokens plus chapter and paragraph
// indexes. A token: { text, orp, w, punct, paraEnd, sentenceStart, para }.
//
// w is a multiplier on the base per-word duration (60000 / wpm ms) for
// intrinsic difficulty (long or numeric words). Punctuation pauses are NOT
// baked in here — the reader adds them at play time, so the user can tune
// how long a "." holds.

const SENTENCE_END = /[.!?…]["')\]»”’]*$/;
const HARD_END = /[!?…]["')\]»”’]*$/;
const CLAUSE_END = /[,;:—–]["')\]»”’]*$/;
const HAS_DIGIT = /\d/;

// Words whose trailing "." is an abbreviation, not a full stop. Titles are
// never sentence ends ("Mr. Smith"); the ambiguous ones ("etc.", "Jr.") end
// a sentence only when the next word starts a capitalized one.
const TITLE_ABBREVS = new Set([
  "mr", "mrs", "ms", "mx", "dr", "prof", "rev", "hon", "fr", "st", "mt",
  "gen", "col", "maj", "lt", "sgt", "capt", "cmdr", "gov", "sen", "rep",
]);
const OTHER_ABBREVS = new Set([
  "sr", "jr", "etc", "vs", "cf", "ca", "approx", "no", "fig", "figs",
  "vol", "vols", "pp", "ed", "eds", "al", "inc", "ltd", "co", "corp",
  "dept", "est", "ave", "blvd", "rd",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

// Does this word actually end a sentence? nextWord is undefined at
// paragraph end.
function endsSentence(word, nextWord) {
  if (HARD_END.test(word)) return true;
  if (!SENTENCE_END.test(word)) return false;
  // Strip surrounding quotes/brackets, drop the final period.
  const core = word.replace(/["')\]»”’]+$/, "").replace(/^["'(\[«“‘]+/, "");
  if (!core.endsWith(".")) return true; // period was inside the quotes
  const base = core.slice(0, -1);
  if (/^[A-Z]$/.test(base)) return false; // initial: "J. R. R. Tolkien"
  const dotted = /^([A-Za-z]\.)+[A-Za-z]?$/.test(core); // "U.S.", "e.g.", "a.m."
  const lower = base.toLowerCase();
  if (TITLE_ABBREVS.has(lower)) return false;
  if (dotted || OTHER_ABBREVS.has(lower)) {
    // Sentence over only if something capitalized (or nothing) follows.
    return nextWord === undefined || /^["'(\[«“‘]*[A-Z0-9]/.test(nextWord);
  }
  return true;
}

export const PUNCT_NONE = 0;
export const PUNCT_CLAUSE = 1;
export const PUNCT_SENTENCE = 2;

// Optimal Recognition Point: the letter the eye fixates on. Slightly left
// of center, per Spritz-style RSVP conventions.
function orpIndex(word) {
  const len = word.replace(/["'()\[\]«»“”‘’.,;:!?…]+$/, "").length || word.length;
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

function baseWeight(word) {
  let w = 1;
  if (word.length >= 9) w += 0.3;
  if (word.length >= 13) w += 0.3;
  if (HAS_DIGIT.test(word)) w += 0.5;
  return w;
}

// sections: [{ title, text }] — returns { tokens, chapters, paragraphs }
// chapters: [{ title, start }]   paragraphs: [{ start, count }]
export function tokenize(sections) {
  const tokens = [];
  const chapters = [];
  const paragraphs = [];
  let sentenceStart = true;

  for (const [si, section] of sections.entries()) {
    const paras = section.text
      .replace(/\r\n?/g, "\n")
      .split(/\n\s*\n+/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (!paras.length) continue;

    chapters.push({ title: section.title || `Section ${si + 1}`, start: tokens.length });

    for (const para of paras) {
      const words = para.split(" ").filter(Boolean);
      const paraIndex = paragraphs.length;
      paragraphs.push({ start: tokens.length, count: words.length });
      words.forEach((word, i) => {
        const isParaEnd = i === words.length - 1;
        const sentenceEnd = endsSentence(word, words[i + 1]);
        tokens.push({
          text: word,
          orp: orpIndex(word),
          w: baseWeight(word),
          punct: sentenceEnd
            ? PUNCT_SENTENCE
            : CLAUSE_END.test(word)
              ? PUNCT_CLAUSE
              : PUNCT_NONE,
          paraEnd: isParaEnd,
          sentenceStart,
          para: paraIndex,
        });
        sentenceStart = sentenceEnd || isParaEnd;
      });
    }
  }
  return { tokens, chapters, paragraphs };
}

// Index of the first word of the sentence containing tokens[i].
export function sentenceStartBefore(tokens, i) {
  for (let j = Math.min(i, tokens.length - 1); j > 0; j--) {
    if (tokens[j].sentenceStart) return j;
  }
  return 0;
}

export function sentenceStartAfter(tokens, i) {
  for (let j = i + 1; j < tokens.length; j++) {
    if (tokens[j].sentenceStart) return j;
  }
  return tokens.length - 1;
}
