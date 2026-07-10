// RSVP scheduler: fires onWord(token, index) for each token, spacing words
// by 60000/wpm ms scaled by the token's weight plus punctuation pauses.
// setTimeout-based so weights apply per word; drift doesn't matter at these
// timescales.

import { PUNCT_SENTENCE, PUNCT_CLAUSE } from "./tokenize.js";

export class Reader {
  constructor({ onWord, onState, onDone }) {
    this.onWord = onWord;
    this.onState = onState;
    this.onDone = onDone;
    this.tokens = [];
    this.index = 0;
    this.wpm = 300;
    // Extra multiples of the base word time added at punctuation.
    // sentence is user-tunable ("how long does a period hold").
    this.pauses = { sentence: 1.7, clause: 0.6, paragraph: 1.2 };
    this.playing = false;
    this._timer = null;
  }

  load(tokens, startIndex = 0) {
    this.pause();
    this.tokens = tokens;
    this.index = Math.min(startIndex, Math.max(0, tokens.length - 1));
    this._show();
  }

  setWpm(wpm) {
    this.wpm = Math.min(1200, Math.max(60, wpm));
    return this.wpm;
  }

  // total = how many base word-times a sentence-ending word occupies (>= 1).
  setSentencePause(total) {
    this.pauses.sentence = Math.min(5, Math.max(1, total)) - 1;
    return this.pauses.sentence + 1;
  }

  delayFor(t) {
    let m = t.w;
    if (t.punct === PUNCT_SENTENCE) m += this.pauses.sentence;
    else if (t.punct === PUNCT_CLAUSE) m += this.pauses.clause;
    if (t.paraEnd) m += this.pauses.paragraph;
    return (60000 / this.wpm) * m;
  }

  play() {
    if (this.playing || !this.tokens.length) return;
    if (this.index >= this.tokens.length - 1 && this.tokens.length > 1) {
      this.index = 0; // finished: replay from the top
    }
    this.playing = true;
    this.onState?.(true);
    this._step();
  }

  pause() {
    clearTimeout(this._timer);
    this._timer = null;
    if (this.playing) {
      this.playing = false;
      this.onState?.(false);
    }
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(index) {
    this.index = Math.min(this.tokens.length - 1, Math.max(0, index));
    this._show();
    if (this.playing) {
      clearTimeout(this._timer);
      this._step();
    }
  }

  // Estimated ms remaining from the current position at current settings.
  remainingMs() {
    let sum = 0;
    for (let i = this.index; i < this.tokens.length; i++) {
      sum += this.delayFor(this.tokens[i]);
    }
    return sum;
  }

  _show() {
    const t = this.tokens[this.index];
    if (t) this.onWord?.(t, this.index, this.tokens.length);
  }

  _step() {
    this._show();
    const t = this.tokens[this.index];
    if (!t) return this.pause();
    if (this.index >= this.tokens.length - 1) {
      this.playing = false;
      this.onState?.(false);
      this.onDone?.();
      return;
    }
    this._timer = setTimeout(() => {
      this.index++;
      this._step();
    }, this.delayFor(t));
  }
}
