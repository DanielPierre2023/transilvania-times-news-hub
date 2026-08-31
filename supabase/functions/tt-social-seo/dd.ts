const stripDia = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '')
   .replace(/ș/g, 's').replace(/ț/g, 't')
   .replace(/ş/g, 's').replace(/ţ/g, 't');

/** Trim to a hard character budget at a word boundary, never mid-word. */
function clampWords(text: string, max: number): string {
  const t = (text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.…-]+$/, '') + '…';
}

/** "Curtea de Conturi" -> "#CurteaDeConturi". Diacritics removed: a hashtag
 *  with ș or ț is not clickable as the same tag people actually type. */
function hashtagize(raw: string): string {
  const words = stripDia(String(raw || ''))
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean).slice(0, 4);
  if (!words.length) return '';
  const joined = words.map(w => w[0].toUpperCase() + w.slice(1)).join('');
  return joined.length > 2 ? '#' + joined : '';
}

/**
 * Remove sentences that already appeared earlier in the same post.
 *
 * WHY: every caption here is assembled from SEPARATE model fields — a hook, a
 * body, a closing question — and the model very often puts the hook back at the
 * top of the body, or answers "caption" with the headline it already gave as
 * "hooks[0]". Concatenating them then prints the same sentence twice, which is
 * what shipped: the Facebook post repeated its own closing question, and the
 * Instagram caption repeated the headline.
 *
 * A prompt cannot guarantee this away — the fields genuinely overlap in meaning.
 * So it is enforced in code, after generation, like every other per-platform
 * rule in this file.
 *
 * Comparison is diacritic- and punctuation-insensitive, so "Opt morți, 17
 * dispăruți — căpitanul…" and "Opt morti 17 disparuti - capitanul…" count as
 * the same sentence. Hashtag and URL lines are passed through untouched.
 */
function dedupeSentences(parts: string[]): string[] {
  const seen: string[] = [];
  const key = (x: string) =>
    stripDia(x).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const isSkippable = (line: string) =>
    !line.trim() || /^#|^https?:\/\//.test(line.trim()) || line.trim().split(/\s+/).every(w => w.startsWith('#'));

  return parts.map((part) => {
    if (part === undefined || part === null) return part;
    const text = String(part);
    if (isSkippable(text)) return text;

    const keptLines = text.split('\n').map((line) => {
      if (isSkippable(line)) return line;
      // Split into sentences but keep their terminators.
      const sentences = line.match(/[^.!?…]+[.!?…]*\s*/g) || [line];
      const kept = sentences.filter((sen) => {
        const k = key(sen);
        if (k.length < 12) return true;             // too short to judge
        // Exact repeat, or fully contained in something already printed.
        if (seen.some(prev => prev === k || prev.includes(k))) return false;
        seen.push(k);
        return true;
      });
      return kept.join('').trim();
    });

    const body = keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!body) return '';
    // Preserve the part's own leading/trailing whitespace: the composers use a
    // leading '\n' on the closing question to create the paragraph break, and
    // trimming it here would silently glue the question onto the body.
    const lead = (text.match(/^\s*/) || [''])[0];
    const tail = (text.match(/\s*$/) || [''])[0];
    return lead + body + tail;
  });
}


export { dedupeSentences };
