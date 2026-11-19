// Voice input (Web Speech API; works in Chrome / Edge on https or localhost) and voice output (speechSynthesis).
export class Voice {
  constructor({ onFinal, onInterim, onState }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    this.onFinal = onFinal; this.onInterim = onInterim; this.onState = onState;
    this.listening = false; this.speaking = false;
    this.lang = 'en-US';
    this.speakOn = true;
    if (!SR) return;
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript; else interim += res[0].transcript;
      }
      if (interim) this.onInterim && this.onInterim(interim);
      if (final) this.onFinal && this.onFinal(final.trim());
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.listening = false; this.onState && this.onState('denied');
      }
    };
    r.onend = () => {
      if (this.listening) { try { r.start(); } catch (_) { /* already started */ } }
      else this.onState && this.onState('off');
    };
    this.rec = r;
  }

  start() {
    if (!this.supported) return false;
    this.rec.lang = this.lang;
    this.listening = true;
    try { this.rec.start(); } catch (_) { /* already running */ }
    this.onState && this.onState('on');
    return true;
  }
  stop() {
    this.listening = false;
    if (this.rec) try { this.rec.stop(); } catch (_) { /* noop */ }
    this.onState && this.onState('off');
  }
  toggle() { return this.listening ? (this.stop(), false) : this.start(); }

  say(text, onEnd) {
    if (!this.speakOn || !('speechSynthesis' in window)) { onEnd && setTimeout(onEnd, 0); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 1.0; u.pitch = 1.0;
    u.onstart = () => { this.speaking = true; };
    u.onend = () => { this.speaking = false; onEnd && onEnd(); };
    u.onerror = () => { this.speaking = false; onEnd && onEnd(); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
  cancelSpeech() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
}

