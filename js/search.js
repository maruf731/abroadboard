// Typo-tolerant search for the board and Buy and Sell (FC-43).
// Every query word is matched against the words of each post: an exact word
// scores highest, then a word starting with it, then one containing it, then
// one within one or two typing mistakes. Posts that match every word come
// first; if none do, the closest posts are shown instead.

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const words = (s) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const isCJK = (s) => /[぀-ヿ㐀-鿿가-힯]/.test(s);

// Edit distance with a cut-off: returns max + 1 as soon as it is exceeded.
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i), before = prev;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // A swapped pair of letters ("baminton" / "badmniton") counts as one mistake.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], before[j - 2] + 1);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    before = prev; prev = cur;
  }
  return prev[b.length];
}
const allowed = (term) => (term.length >= 7 ? 2 : term.length >= 4 ? 1 : 0);

// How well one query word matches a list of words (0 = not at all).
function termScore(term, docWords, docText) {
  if (isCJK(term)) return docText.includes(term) ? 3 : 0;
  let best = 0;
  const max = allowed(term);
  for (const w of docWords) {
    if (w === term) return 3;
    if (w.startsWith(term)) best = Math.max(best, 2.5);
    else if (term.length >= 3 && w.includes(term)) best = Math.max(best, 2);
    else if (max && best < 1.5) {
      const d = distance(term, w.slice(0, term.length + max), max);
      const full = distance(term, w, max);
      if (full <= max) best = Math.max(best, full === 1 ? 1.5 : 1);
      else if (d <= max && w.length > term.length) best = Math.max(best, 1); // typo in a prefix
    }
  }
  return best;
}

// list: items; textOf(item) returns all searchable text for it.
// Returns { items, close } where close = true when nothing matched every word.
export function search(list, query, textOf) {
  const terms = words(query).filter((w) => w.length > 1 || isCJK(w));
  if (!terms.length) return { items: list, close: false };
  const scored = list.map((item) => {
    const text = norm(textOf(item));
    const ws = words(text);
    const scores = terms.map((term) => termScore(term, ws, text));
    return { item, all: scores.every((s) => s > 0), score: scores.reduce((a, b) => a + b, 0) };
  });
  const full = scored.filter((s) => s.all);
  if (full.length) return { items: full.sort((a, b) => b.score - a.score).map((s) => s.item), close: false };
  // Nothing matched every word: show the posts that matched most of it.
  const need = terms.length > 1 ? 1.5 : 1;
  const near = scored.filter((s) => s.score >= need).sort((a, b) => b.score - a.score).slice(0, 12);
  return { items: near.map((s) => s.item), close: near.length > 0 };
}

// Suggestions under the search box: a corrected query ("Did you mean"),
// and up to five post titles that match what has been typed so far.
export function suggest(list, query, textOf, titleOf, extraWords = []) {
  const typed = words(query);
  if (!typed.length || norm(query).trim().length < 2) return { didYouMean: "", titles: [] };

  const vocab = new Map();
  const add = (w) => { if (w.length > 2 && !/^\d+$/.test(w)) vocab.set(w, (vocab.get(w) || 0) + 1); };
  list.forEach((item) => words(textOf(item)).forEach(add));
  extraWords.forEach((s) => words(s).forEach(add));

  let changed = false;
  const fixed = typed.map((w) => {
    if (vocab.has(w) || isCJK(w) || w.length < 4) return w;
    if ([...vocab.keys()].some((v) => v.startsWith(w))) return w; // still typing
    let best = null, bestD = Infinity, bestN = 0;
    const max = allowed(w);
    for (const [v, n] of vocab) {
      const d = distance(w, v, max);
      if (d <= max && (d < bestD || (d === bestD && n > bestN))) { best = v; bestD = d; bestN = n; }
    }
    if (best) { changed = true; return best; }
    return w;
  });

  const q = changed ? fixed.join(" ") : query;
  const { items } = search(list, q, titleOf);
  const titles = [...new Set(items.slice(0, 5).map(titleOf))];
  return { didYouMean: changed ? fixed.join(" ") : "", titles };
}
