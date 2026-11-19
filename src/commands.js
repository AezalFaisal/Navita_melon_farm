// Natural-language command parser for typed or spoken commands.
// parseCommand(text, places) -> array of command objects (a sentence may contain several: "go to the cafe then run").

const NUM_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };

const DIRS = {
  north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
};

function normalise(t) {
  t = ' ' + t.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9&\- ,.;]/g, ' ') + ' ';
  t = t.replace(/photo (and|&) check[- ]?in/g, 'photo checkin').replace(/check[- ]in/g, 'checkin');
  t = t.replace(/drive[- ]through/g, 'drivethrough');
  t = t.replace(/\bcafe\b|\bcaf\b/g, 'cafe');
  // "information one" -> "information 1"
  t = t.replace(/\b(information|info)\s+(one|two|three|1st|2nd|3rd)\b/g, (m, a, n) => `${a} ${({ one: 1, two: 2, three: 3, '1st': 1, '2nd': 2, '3rd': 3 })[n]}`);
  return t.replace(/\s+/g, ' ');
}

function aliasNorm(a) {
  return normalise(a).trim();
}

export function matchPlace(text, places) {
  const t = ' ' + normalise(text).trim() + ' ';
  let best = null, bl = 0;
  for (const p of places) {
    for (const a of p.aliases || []) {
      const an = aliasNorm(a);
      if (!an) continue;
      if (t.includes(' ' + an + ' ') || t.includes(' ' + an + 's ') || (an.length > 4 && t.includes(an))) {
        if (an.length > bl) { bl = an.length; best = p; }
      }
    }
    const nm = aliasNorm(p.name);
    if (t.includes(nm) && nm.length > bl) { bl = nm.length; best = p; }
  }
  return best;
}

function getMeters(s, dflt = 10) {
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:m\b|meter|metre|meters|metres|steps?)?/);
  if (m && /\d/.test(m[1])) return Math.min(120, parseFloat(m[1]));
  for (const [w, v] of Object.entries(NUM_WORDS)) if (new RegExp(`\\b${w}\\b`).test(s)) return v || dflt;
  return dflt;
}

export function parseCommand(raw, places) {
  const text = normalise(raw).trim();
  if (!text) return [];
  const clauses = text.split(/\b(?:and then|then|after that|afterwards|and)\b|[,.;]/).map((c) => c.trim()).filter(Boolean);
  const out = [];
  for (const c of clauses) {
    const cmd = parseClause(c, places, out);
    if (cmd) out.push(...(Array.isArray(cmd) ? cmd : [cmd]));
  }
  return out;
}

function parseClause(c, places) {
  const has = (re) => re.test(c);
  // ---- tour control
  if (has(/\btour\b|\bguided\b|\bauto ?pilot\b|\bautomatic\b/)) {
    if (has(/\b(stop|end|cancel|quit|exit)\b/)) return { type: 'tour', action: 'stop' };
    if (has(/\bpause\b/)) return { type: 'tour', action: 'pause' };
    if (has(/\b(resume|continue)\b/)) return { type: 'tour', action: 'resume' };
    return { type: 'tour', action: 'start' };
  }
  if (has(/\b(next)\b.*\b(stop|place|spot)\b|\bskip\b/)) return { type: 'tour', action: 'next' };
  if (has(/\b(previous|last)\b.*\b(stop|place|spot)\b/)) return { type: 'tour', action: 'prev' };

  // ---- facial expressions and gestures (Melon Explorer avatar)
  const em = c.match(/\b(smile|smiling|happy|laugh|laughing|haha|lol|wink|surprised|surprise|wow|sad|cry|crying|angry|mad|relax|relaxed|calm|sleepy)\b/);
  if (em) {
    const map = { smile: 'Happy', smiling: 'Happy', happy: 'Happy', laugh: 'Laugh', laughing: 'Laugh', haha: 'Laugh', lol: 'Laugh', wink: 'Wink', surprised: 'Surprised', surprise: 'Surprised', wow: 'Surprised', sad: 'Sad', cry: 'Sad', crying: 'Sad', angry: 'Angry', mad: 'Angry', relax: 'Relax', relaxed: 'Relax', calm: 'Relax', sleepy: 'Relax' };
    return { type: 'emote', name: map[em[1]] };
  }
  if (has(/\b(wave|waving|hello|say hi|greet)\b/)) return { type: 'gesture', name: 'Wave' };
  if (has(/\b(cheer|celebrate|dance|hooray|yay)\b/)) return { type: 'gesture', name: 'Cheer' };

  // ---- stop
  if (has(/\b(stop|halt|freeze|wait|stay|cancel|enough|stand still)\b/)) return { type: 'stop' };

  // ---- pick up
  if (has(/\b(pick|grab|take|collect|harvest|get)\b.*\b(melon|melons|fruit|fruits)\b|\bmelon\b.*\b(pick|grab|take)\b/)) {
    const m = c.match(/(\d+)\s*(?:melon|fruit)/);
    let n = m ? parseInt(m[1], 10) : 1;
    for (const [w, v] of Object.entries(NUM_WORDS)) if (v > 0 && v < 10 && new RegExp(`\\b${w}\\b.*melon`).test(c)) n = v;
    return { type: 'pick', count: Math.min(n, 5) };
  }

  // ---- labels / misc
  if (has(/\blabels?\b|\bnames?\b|\bsigns?\b/)) {
    if (has(/\b(hide|remove|off|disable|clear)\b/)) return { type: 'labels', show: false };
    if (has(/\b(show|display|on|enable)\b/)) return { type: 'labels', show: true };
  }
  // speed boost: "double speed", "triple speed", "speed 3x", "normal speed"
  if (has(/\b(speed|boost|turbo|fast|faster)\b/) || has(/\b[123]x\b/)) {
    if (has(/\b(triple|thrice|3x|three times|three x)\b|\bspeed 3\b/)) return { type: 'speedSet', value: 3 };
    if (has(/\b(double|twice|2x|two times|two x)\b|\bspeed 2\b/)) return { type: 'speedSet', value: 2 };
    if (has(/\b(normal|regular|1x|reset|default)\b|\bspeed 1\b/)) return { type: 'speedSet', value: 1 };
  }
  if (has(/\b(faster|speed up|hurry up)\b/) && !has(/\brun\b/)) return { type: 'speed', delta: +1 };
  if (has(/\b(slower|slow down|relax)\b/)) return { type: 'speed', delta: -1 };
  if (has(/\bwhere am i\b|\bmy location\b|\bwhere is (?:the )?avatar\b/)) return { type: 'where' };
  if (has(/\bhelp\b|\bwhat can i say\b|\bcommands?\b|\binstructions?\b/)) return { type: 'help' };

  const running = has(/\b(run|jog|sprint|hurry|dash|rush)\b/);
  const gait = running ? 'run' : 'walk';

  // ---- go to a place
  const place = matchPlace(c, places);
  if (place && (has(/\b(go|walk|run|head|move|take|bring|navigate|visit|show|come|reach|proceed|lead|jog|sprint|get|travel|find|where)\b/) || c.split(' ').length <= 5)) {
    return { type: 'goto', place: place.id, gait };
  }

  // ---- turn
  if (has(/\b(turn|face|rotate|look)\b/)) {
    if (has(/\baround\b|\bback\b|\bu-?turn\b/)) return { type: 'turn', deg: 180 };
    if (has(/\bleft\b/)) return { type: 'turn', deg: -90 };
    if (has(/\bright\b/)) return { type: 'turn', deg: +90 };
    for (const d of Object.keys(DIRS)) if (has(new RegExp(`\\b${d}\\b`))) return { type: 'face', dir: d };
  }

  // ---- move by direction
  const dm = c.match(/\b(north|south|east|west|forward|forwards|ahead|straight|back|backward|backwards|left|right)\b/);
  if (dm && has(/\b(go|walk|run|move|head|step|jog|sprint|continue|proceed)\b/)) {
    return { type: 'move', dir: dm[1], meters: getMeters(c, 12), gait };
  }

  // ---- plain gait
  if (running) return { type: 'gait', gait: 'run' };
  if (has(/\b(walk|move|go|continue|forward|ahead)\b/)) return { type: 'gait', gait: 'walk' };
  return { type: 'unknown', text: c };
}

export { DIRS };

