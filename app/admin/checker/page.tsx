'use client'

import { useState, useMemo, useCallback } from "react";

// ─── ANALYSIS FUNCTIONS ─────────────────────────────────────────────────────

function normalize(text) {
  return text.toLowerCase().trim()
    .replace(/[„""«»'"\.\,\;\:\!\?\(\)\[\]\{\}—–\-\/]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function getWords(text) {
  return normalize(text).split(' ').filter(w => w.length > 0);
}

function getNgrams(text, n) {
  const words = getWords(text);
  const result = [];
  for (let i = 0; i <= words.length - n; i++) {
    result.push(words.slice(i, i + n).join(' '));
  }
  return result;
}

function ngramOverlap(source, generated, n) {
  const srcSet = new Set(getNgrams(source, n));
  const genNgrams = getNgrams(generated, n);
  if (genNgrams.length === 0) return { pct: 0, matches: 0, total: 0 };
  const matches = genNgrams.filter(ng => srcSet.has(ng)).length;
  return { pct: (matches / genNgrams.length) * 100, matches, total: genNgrams.length };
}

function findCopiedSequences(source, generated, minLen = 5) {
  const srcWords = getWords(source);
  const genWords = getWords(generated);
  const srcSet = new Set();
  for (let n = minLen; n <= Math.min(25, srcWords.length); n++) {
    for (let i = 0; i <= srcWords.length - n; i++) {
      srcSet.add(srcWords.slice(i, i + n).join(' '));
    }
  }
  const found = [];
  let i = 0;
  while (i < genWords.length) {
    let bestLen = 0;
    for (let end = Math.min(i + 25, genWords.length); end >= i + minLen; end--) {
      const chunk = genWords.slice(i, end).join(' ');
      if (srcSet.has(chunk)) { bestLen = end - i; break; }
    }
    if (bestLen >= minLen) {
      found.push({ words: genWords.slice(i, i + bestLen).join(' '), len: bestLen, pos: i });
      i += bestLen;
    } else { i++; }
  }
  return found;
}

function longestCommonSubstring(s1, s2) {
  const w1 = getWords(s1), w2 = getWords(s2);
  let maxLen = 0, best = '';
  for (let i = 0; i < w1.length; i++) {
    for (let j = 0; j < w2.length; j++) {
      let k = 0;
      while (i + k < w1.length && j + k < w2.length && w1[i + k] === w2[j + k]) k++;
      if (k > maxLen) { maxLen = k; best = w1.slice(i, i + k).join(' '); }
    }
  }
  return { len: maxLen, text: best };
}

// ─── AI DETECTION HEURISTICS ────────────────────────────────────────────────

const AI_TRANSITIONS_RO = [
  'în contextul în care', 'pe de altă parte', 'în același timp', 'de asemenea',
  'mai mult', 'în plus', 'cu toate acestea', 'totuși', 'prin urmare',
  'în ceea ce privește', 'în primul rând', 'în al doilea rând', 'cu alte cuvinte',
  'în concluzie', 'în consecință', 'în acest sens', 'este important de menționat',
  'merită subliniat', 'nu în ultimul rând',
];
const AI_TRANSITIONS_EN = [
  'in the context of', 'on the other hand', 'at the same time', 'additionally',
  'moreover', 'furthermore', 'however', 'nevertheless', 'consequently',
  'it is worth noting', 'it is important to note', 'in conclusion',
  'as a result', 'in this regard', 'first and foremost',
];

function analyzeAI(text) {
  const lower = text.toLowerCase();
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
  const words = getWords(text);

  // 1. Sentence length variance (AI tends to be more uniform)
  const sentLengths = sentences.map(s => s.split(/\s+/).length);
  const avgLen = sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length;
  const variance = sentLengths.reduce((a, b) => a + Math.pow(b - avgLen, 2), 0) / sentLengths.length;
  const stdDev = Math.sqrt(variance);
  const coeffOfVar = avgLen > 0 ? stdDev / avgLen : 0;

  // 2. Transition word count
  const allTransitions = [...AI_TRANSITIONS_RO, ...AI_TRANSITIONS_EN];
  const transitionHits = allTransitions.filter(t => lower.includes(t));
  const transitionDensity = transitionHits.length / Math.max(1, sentences.length);

  // 3. Vocabulary diversity (type-token ratio)
  const uniqueWords = new Set(words);
  const ttr = words.length > 0 ? uniqueWords.size / words.length : 0;

  // 4. Paragraph length variance
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);
  const paraLengths = paragraphs.map(p => p.split(/\s+/).length);
  const avgParaLen = paraLengths.reduce((a, b) => a + b, 0) / Math.max(1, paraLengths.length);
  const paraVariance = paraLengths.reduce((a, b) => a + Math.pow(b - avgParaLen, 2), 0) / Math.max(1, paraLengths.length);
  const paraCoV = avgParaLen > 0 ? Math.sqrt(paraVariance) / avgParaLen : 0;

  // 5. Starting word patterns (AI tends to vary starts too systematically)
  const starts = sentences.map(s => s.split(/\s+/)[0]?.toLowerCase() || '');
  const uniqueStarts = new Set(starts);
  const startDiversity = starts.length > 0 ? uniqueStarts.size / starts.length : 0;

  // 6. Attribution pattern regularity
  const attrPatterns = ['potrivit', 'conform', 'according', 'surse politice', 'a declarat', 'a spus', 'said'];
  const attrPositions = [];
  sentences.forEach((s, i) => {
    if (attrPatterns.some(p => s.toLowerCase().includes(p))) attrPositions.push(i);
  });
  let attrRegularity = 0;
  if (attrPositions.length >= 3) {
    const gaps = [];
    for (let i = 1; i < attrPositions.length; i++) gaps.push(attrPositions[i] - attrPositions[i - 1]);
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const gapVar = gaps.reduce((a, b) => a + Math.pow(b - avgGap, 2), 0) / gaps.length;
    attrRegularity = avgGap > 0 ? 1 - Math.min(1, Math.sqrt(gapVar) / avgGap) : 0;
  }

  // Score: 0-100 (higher = more likely AI)
  let score = 0;
  const flags = [];

  // Low sentence variance = AI pattern
  if (coeffOfVar < 0.35) { score += 25; flags.push({ text: `Sentence length too uniform (CoV: ${coeffOfVar.toFixed(2)}, human typically >0.40)`, severity: 'high' }); }
  else if (coeffOfVar < 0.45) { score += 12; flags.push({ text: `Sentence length slightly uniform (CoV: ${coeffOfVar.toFixed(2)})`, severity: 'medium' }); }

  // High transition density = AI
  if (transitionDensity > 0.3) { score += 20; flags.push({ text: `High AI-transition density: ${transitionHits.length} in ${sentences.length} sentences`, severity: 'high' }); }
  else if (transitionDensity > 0.15) { score += 10; flags.push({ text: `Moderate AI-transition usage: ${transitionHits.length} found`, severity: 'medium' }); }

  // Low paragraph variance = AI
  if (paraCoV < 0.25 && paragraphs.length >= 3) { score += 15; flags.push({ text: `Paragraph lengths too uniform (CoV: ${paraCoV.toFixed(2)})`, severity: 'medium' }); }

  // Too-perfect start diversity = AI
  if (startDiversity > 0.95 && sentences.length >= 6) { score += 15; flags.push({ text: `Every sentence starts differently (${(startDiversity * 100).toFixed(0)}% unique) — AI pattern`, severity: 'medium' }); }

  // Regular attribution spacing = AI
  if (attrRegularity > 0.7) { score += 15; flags.push({ text: `Attribution appears at suspiciously regular intervals`, severity: 'medium' }); }

  // Very high TTR with long text = AI (AI tends to avoid word repetition more than humans)
  if (ttr > 0.72 && words.length > 150) { score += 10; flags.push({ text: `Vocabulary diversity unusually high (TTR: ${ttr.toFixed(2)})`, severity: 'low' }); }

  return {
    score: Math.min(100, score),
    flags,
    transitionHits,
    stats: {
      sentences: sentences.length,
      words: words.length,
      avgSentLen: avgLen.toFixed(1),
      sentCoV: coeffOfVar.toFixed(2),
      paragraphs: paragraphs.length,
      paraCoV: paraCoV.toFixed(2),
      ttr: ttr.toFixed(2),
      transitions: transitionHits.length,
      startDiversity: (startDiversity * 100).toFixed(0),
    }
  };
}

// ─── FABRICATION CHECK ──────────────────────────────────────────────────────

function checkFabrications(text) {
  const lower = text.toLowerCase();
  const patterns = [
    { pattern: 'pentru transilvania times', label: 'Claims sources spoke TO TT' },
    { pattern: 'transilvania times a solicitat', label: 'Claims TT contacted someone' },
    { pattern: 'transilvania times a contactat', label: 'Claims TT contacted someone' },
    { pattern: 'transilvania times nu a putut', label: 'Claims TT tried to confirm' },
    { pattern: /consult[aă][tț]i de transilvania times/i, label: 'Claims TT consulted experts' },
    { pattern: 'acordat transilvania times', label: 'Claims interview given to TT' },
    { pattern: 'obținute de transilvania times', label: 'Claims TT obtained info' },
    { pattern: 'contactate telefonic', label: 'Claims TT made phone calls' },
    { pattern: /potrivit unui comunicat(?! (publicat|emis|oficial|al))/i, label: 'Possibly fabricated press release' },
    { pattern: /într-un interviu/i, label: 'Possibly fabricated interview' },
  ];
  const found = [];
  for (const p of patterns) {
    const regex = typeof p.pattern === 'string' ? new RegExp(p.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : p.pattern;
    let m;
    while ((m = regex.exec(lower)) !== null) {
      const start = Math.max(0, m.index - 30);
      const end = Math.min(text.length, m.index + m[0].length + 60);
      found.push({ label: p.label, context: text.slice(start, end).replace(/\n/g, ' ') });
    }
  }
  return found;
}

// ─── HIGHLIGHT HELPER ───────────────────────────────────────────────────────

function highlightCopied(text, sequences) {
  if (!sequences.length) return [{ text, type: 'clean' }];
  const normText = normalize(text);
  const normWords = normText.split(' ');
  const textWords = text.split(/(\s+)/);

  const marks = new Array(normWords.length).fill(false);
  for (const seq of sequences) {
    const seqWords = seq.words.split(' ');
    for (let i = 0; i <= normWords.length - seqWords.length; i++) {
      let match = true;
      for (let j = 0; j < seqWords.length; j++) {
        if (normWords[i + j] !== seqWords[j]) { match = false; break; }
      }
      if (match) {
        for (let j = 0; j < seqWords.length; j++) marks[i + j] = true;
      }
    }
  }

  // Build highlighted segments by walking through original text word by word
  const result = [];
  let currentType = null;
  let currentText = '';
  let wordIdx = 0;

  for (const part of textWords) {
    if (/^\s+$/.test(part)) {
      currentText += part;
    } else {
      const type = wordIdx < marks.length && marks[wordIdx] ? 'copied' : 'clean';
      if (type !== currentType && currentText) {
        result.push({ text: currentText, type: currentType || 'clean' });
        currentText = '';
      }
      currentType = type;
      currentText += part;
      wordIdx++;
    }
  }
  if (currentText) result.push({ text: currentText, type: currentType || 'clean' });
  return result;
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────

export default function ArticleChecker() {
  const [tab, setTab] = useState('plagiarism');
  const [source, setSource] = useState('');
  const [generated, setGenerated] = useState('');
  const [aiText, setAiText] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const [rewriteResult, setRewriteResult] = useState('');

  // Plagiarism analysis
  const plagiarismResult = useMemo(() => {
    if (!source.trim() || !generated.trim()) return null;
    const ngrams = {};
    for (const n of [3, 4, 5, 6, 7]) {
      ngrams[n] = ngramOverlap(source, generated, n);
    }
    const copied = findCopiedSequences(source, generated, 5);
    const lcs = longestCommonSubstring(source, generated);
    const totalCopiedWords = copied.reduce((a, s) => a + s.len, 0);
    const totalWords = getWords(generated).length;
    const fabrications = checkFabrications(generated);
    const highlighted = highlightCopied(generated, copied);

    let verdict = 'clean';
    if (ngrams[5].pct > 15 || totalCopiedWords / totalWords > 0.25) verdict = 'high';
    else if (ngrams[5].pct > 8 || totalCopiedWords / totalWords > 0.12) verdict = 'moderate';
    else if (ngrams[5].pct > 3) verdict = 'low';

    return { ngrams, copied, lcs, totalCopiedWords, totalWords, fabrications, highlighted, verdict };
  }, [source, generated]);

  // AI detection analysis
  const aiInputText = tab === 'ai' ? aiText : generated;
  const aiResult = useMemo(() => {
    if (!aiInputText.trim()) return null;
    return analyzeAI(aiInputText);
  }, [aiInputText]);

  // Rewrite via Anthropic API
  const handleRewrite = useCallback(async () => {
    const text = tab === 'plagiarism' ? generated : aiText;
    if (!text.trim()) return;
    setRewriting(true);
    setRewriteResult('');
    try {
      const issues = [];
      if (plagiarismResult && tab === 'plagiarism') {
        issues.push(`COPIED SEQUENCES DETECTED: ${plagiarismResult.copied.map(s => `"${s.words}"`).join(', ')}`);
      }
      if (aiResult) {
        issues.push(`AI DETECTION FLAGS: ${aiResult.flags.map(f => f.text).join('; ')}`);
        if (aiResult.transitionHits.length > 0) {
          issues.push(`AI TRANSITIONS TO REMOVE: ${aiResult.transitionHits.join(', ')}`);
        }
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          messages: [{
            role: "user",
            content: `Rescrie acest text în română pentru a elimina TOATE tiparele de AI și TOATE secvențele copiate. 

PROBLEME DETECTATE:
${issues.join('\n')}

REGULI DE RESCRIERE:
1. Fiecare propoziție trebuie reconstruită complet — NU parafrazare la nivel de cuvânt.
2. ELIMINĂ toate tranzițiile AI: "în contextul în care", "pe de altă parte", "în același timp", "de asemenea", "mai mult", "cu toate acestea", "totuși".
3. Variază NEREGULAT lungimea propozițiilor — două scurte consecutive, apoi una lungă, apoi una medie. NU alterna mecanic.
4. Schimbă ORDINEA ideilor față de textul original.
5. Inserează ocazional o propoziție fragmentară: "Rezultatul: blocaj." sau "Deci niciun acord."
6. Variază modul de atribuire: "a spus", "a transmis", "a scris pe Facebook", nu mereu "a declarat" sau "potrivit".
7. NU fabrica surse, interviuri sau citate care nu apar în textul original.
8. Păstrează TOATE faptele din text. NU adăuga informații noi.

TEXT DE RESCRIS:
${text}

Răspunde DOAR cu textul rescris, fără explicații sau comentarii.`
          }],
        })
      });
      const data = await response.json();
      const result = data?.content?.[0]?.text || 'Eroare: nu s-a primit răspuns.';
      setRewriteResult(result);
    } catch (err) {
      setRewriteResult(`Eroare: ${err.message}`);
    }
    setRewriting(false);
  }, [tab, generated, aiText, plagiarismResult, aiResult]);

  const tabs = [
    { id: 'plagiarism', label: 'Plagiat', icon: '🔍' },
    { id: 'ai', label: 'AI Detection', icon: '🤖' },
  ];

  const verdictColors = {
    clean: { bg: 'bg-emerald-900/30', border: 'border-emerald-700', text: 'text-emerald-300', label: 'ORIGINAL' },
    low: { bg: 'bg-emerald-900/20', border: 'border-emerald-800', text: 'text-emerald-400', label: 'OVERLAP MINOR' },
    moderate: { bg: 'bg-amber-900/30', border: 'border-amber-700', text: 'text-amber-300', label: 'NECESITĂ REVIZUIRE' },
    high: { bg: 'bg-red-900/30', border: 'border-red-700', text: 'text-red-300', label: 'PLAGIAT — NU PUBLICA' },
  };

  return (
    <div style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif", background: '#0a0a0a', color: '#e5e5e5', minHeight: '100vh' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>

        {/* Header */}
        <div style={{ borderBottom: '1px solid #c41e3a', paddingBottom: 16, marginBottom: 24 }}>
          <h1 style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 }}>
            Transilvania Times — Article Quality Checker
          </h1>
          <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            Plagiat · AI Detection · Rescriere
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid #222' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: tab === t.id ? '#c41e3a' : 'transparent',
                color: tab === t.id ? '#fff' : '#888',
                border: 'none', borderBottom: tab === t.id ? '2px solid #c41e3a' : '2px solid transparent',
              }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* PLAGIARISM TAB */}
        {tab === 'plagiarism' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#666', display: 'block', marginBottom: 6 }}>
                  Text generat AI (de verificat)
                </label>
                <textarea value={generated} onChange={e => setGenerated(e.target.value)}
                  placeholder="Lipește articolul generat de AI Editor..."
                  style={{ width: '100%', height: 200, background: '#111', border: '1px solid #222', color: '#ddd', padding: 12, fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.6 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#666', display: 'block', marginBottom: 6 }}>
                  Text sursă original
                </label>
                <textarea value={source} onChange={e => setSource(e.target.value)}
                  placeholder="Lipește articolul original de pe Aktual24 / Digi24 / etc..."
                  style={{ width: '100%', height: 200, background: '#111', border: '1px solid #222', color: '#ddd', padding: 12, fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.6 }} />
              </div>
            </div>

            {plagiarismResult && (
              <div>
                {/* Verdict banner */}
                <div style={{
                  padding: '16px 20px', marginBottom: 16,
                  background: verdictColors[plagiarismResult.verdict].bg.replace('bg-', ''),
                  border: `1px solid`,
                  borderColor: plagiarismResult.verdict === 'high' ? '#991b1b' : plagiarismResult.verdict === 'moderate' ? '#92400e' : '#065f46',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{
                      fontSize: 15, fontWeight: 700,
                      color: plagiarismResult.verdict === 'high' ? '#fca5a5' : plagiarismResult.verdict === 'moderate' ? '#fcd34d' : '#6ee7b7',
                    }}>
                      {verdictColors[plagiarismResult.verdict].label}
                    </span>
                    <span style={{ fontSize: 12, color: '#999' }}>
                      5-gram: {plagiarismResult.ngrams[5].pct.toFixed(1)}% · Secvențe copiate: {plagiarismResult.totalCopiedWords}/{plagiarismResult.totalWords} cuvinte ({(plagiarismResult.totalCopiedWords / Math.max(1, plagiarismResult.totalWords) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>

                {/* N-gram stats */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                  {[3, 4, 5, 6, 7].map(n => (
                    <div key={n} style={{
                      padding: '8px 14px', background: '#111', border: '1px solid #222', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: plagiarismResult.ngrams[n].pct > 10 ? '#f87171' : plagiarismResult.ngrams[n].pct > 5 ? '#fbbf24' : '#34d399' }}>
                        {plagiarismResult.ngrams[n].pct.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: 10, color: '#666' }}>{n}-gram</div>
                    </div>
                  ))}
                  <div style={{ padding: '8px 14px', background: '#111', border: '1px solid #222', textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: plagiarismResult.lcs.len > 7 ? '#f87171' : '#fbbf24' }}>
                      {plagiarismResult.lcs.len}
                    </div>
                    <div style={{ fontSize: 10, color: '#666' }}>Cea mai lungă secvență</div>
                  </div>
                </div>

                {/* Fabrications */}
                {plagiarismResult.fabrications.length > 0 && (
                  <div style={{ background: '#1a0000', border: '1px solid #7f1d1d', padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fca5a5', marginBottom: 8 }}>⚠️ FABRICĂRI DETECTATE ({plagiarismResult.fabrications.length})</div>
                    {plagiarismResult.fabrications.map((f, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#fca5a5', marginBottom: 6 }}>
                        <strong>{f.label}:</strong> {'"'}...{f.context}...{'"'}
                      </div>
                    ))}
                  </div>
                )}

                {/* Copied sequences list */}
                {plagiarismResult.copied.length > 0 && (
                  <div style={{ background: '#111', border: '1px solid #222', padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#999', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                      Secvențe copiate ({plagiarismResult.copied.length})
                    </div>
                    {plagiarismResult.copied.map((seq, i) => (
                      <div key={i} style={{
                        fontSize: 12, padding: '6px 10px', marginBottom: 4,
                        background: seq.len >= 8 ? '#3b0000' : seq.len >= 6 ? '#2a1a00' : '#1a1a1a',
                        borderLeft: `3px solid ${seq.len >= 8 ? '#ef4444' : seq.len >= 6 ? '#f59e0b' : '#555'}`,
                        color: '#ccc',
                      }}>
                        <span style={{ color: '#888', marginRight: 8 }}>{seq.len} cuv</span>
                        {'"'}{seq.words}{'"'}
                      </div>
                    ))}
                  </div>
                )}

                {/* Highlighted text */}
                <div style={{ background: '#111', border: '1px solid #222', padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#999', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                    Text cu secvențe copiate evidențiate
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.8, color: '#ccc' }}>
                    {plagiarismResult.highlighted.map((seg, i) => (
                      <span key={i} style={{
                        background: seg.type === 'copied' ? 'rgba(239, 68, 68, 0.25)' : 'transparent',
                        borderBottom: seg.type === 'copied' ? '2px solid #ef4444' : 'none',
                        padding: seg.type === 'copied' ? '2px 0' : 0,
                      }}>
                        {seg.text}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Rewrite button */}
                <button onClick={handleRewrite} disabled={rewriting}
                  style={{
                    width: '100%', padding: '14px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: 2, cursor: rewriting ? 'not-allowed' : 'pointer',
                    background: '#c41e3a', color: '#fff', border: 'none', opacity: rewriting ? 0.6 : 1,
                  }}>
                  {rewriting ? '⏳ Se rescrie...' : '✍️ Rescrie articolul (elimină plagiat + tipare AI)'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* AI DETECTION TAB */}
        {tab === 'ai' && (
          <div>
            <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#666', display: 'block', marginBottom: 6 }}>
              Text de analizat
            </label>
            <textarea value={aiText} onChange={e => setAiText(e.target.value)}
              placeholder="Lipește articolul pentru detectare AI..."
              style={{ width: '100%', height: 200, background: '#111', border: '1px solid #222', color: '#ddd', padding: 12, fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.6, marginBottom: 16 }} />

            {aiResult && (
              <div>
                {/* AI Score */}
                <div style={{
                  padding: '20px', marginBottom: 16, textAlign: 'center',
                  background: aiResult.score > 60 ? '#1a0000' : aiResult.score > 30 ? '#1a1500' : '#001a0a',
                  border: `1px solid ${aiResult.score > 60 ? '#991b1b' : aiResult.score > 30 ? '#92400e' : '#065f46'}`,
                }}>
                  <div style={{
                    fontSize: 48, fontWeight: 700,
                    color: aiResult.score > 60 ? '#fca5a5' : aiResult.score > 30 ? '#fcd34d' : '#6ee7b7',
                  }}>
                    {aiResult.score}/100
                  </div>
                  <div style={{ fontSize: 13, color: '#999' }}>
                    {aiResult.score > 60 ? 'PROBABILITATE MARE DE AI' : aiResult.score > 30 ? 'SEMNE DE AI — REVIZUIRE NECESARĂ' : 'PROBABIL UMAN SAU BINE UMANIZAT'}
                  </div>
                </div>

                {/* Stats grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
                  {[
                    { label: 'Propoziții', value: aiResult.stats.sentences },
                    { label: 'Cuvinte', value: aiResult.stats.words },
                    { label: 'Media prop.', value: `${aiResult.stats.avgSentLen} cuv` },
                    { label: 'Variația prop.', value: aiResult.stats.sentCoV, warn: parseFloat(aiResult.stats.sentCoV) < 0.35 },
                    { label: 'Paragrafe', value: aiResult.stats.paragraphs },
                    { label: 'Variația para.', value: aiResult.stats.paraCoV, warn: parseFloat(aiResult.stats.paraCoV) < 0.25 },
                    { label: 'Diversitate voc.', value: aiResult.stats.ttr },
                    { label: 'Tranziții AI', value: aiResult.stats.transitions, warn: parseInt(aiResult.stats.transitions) > 2 },
                  ].map((s, i) => (
                    <div key={i} style={{ padding: '10px 12px', background: '#111', border: '1px solid #222', textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: s.warn ? '#f87171' : '#ddd' }}>{s.value}</div>
                      <div style={{ fontSize: 10, color: '#666' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Flags */}
                {aiResult.flags.length > 0 && (
                  <div style={{ background: '#111', border: '1px solid #222', padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#999', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                      Semnale detectate ({aiResult.flags.length})
                    </div>
                    {aiResult.flags.map((f, i) => (
                      <div key={i} style={{
                        fontSize: 12, padding: '6px 10px', marginBottom: 4,
                        borderLeft: `3px solid ${f.severity === 'high' ? '#ef4444' : f.severity === 'medium' ? '#f59e0b' : '#555'}`,
                        color: '#ccc', background: '#0a0a0a',
                      }}>
                        {f.text}
                      </div>
                    ))}
                  </div>
                )}

                {/* AI Transitions found */}
                {aiResult.transitionHits.length > 0 && (
                  <div style={{ background: '#111', border: '1px solid #222', padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#999', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                      Tranziții AI găsite (de eliminat)
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {aiResult.transitionHits.map((t, i) => (
                        <span key={i} style={{
                          fontSize: 12, padding: '4px 10px', background: '#2a1a00', border: '1px solid #92400e', color: '#fcd34d',
                        }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Rewrite button */}
                <button onClick={handleRewrite} disabled={rewriting}
                  style={{
                    width: '100%', padding: '14px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: 2, cursor: rewriting ? 'not-allowed' : 'pointer',
                    background: '#c41e3a', color: '#fff', border: 'none', opacity: rewriting ? 0.6 : 1,
                  }}>
                  {rewriting ? '⏳ Se rescrie...' : '✍️ Rescrie pentru umanizare (elimină tipare AI)'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Rewrite result (shown in both tabs) */}
        {rewriteResult && (
          <div style={{ background: '#0a1a0a', border: '1px solid #065f46', padding: 16, marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#6ee7b7', textTransform: 'uppercase', letterSpacing: 1 }}>
                ✅ Text rescris
              </span>
              <button onClick={() => navigator.clipboard.writeText(rewriteResult)}
                style={{ fontSize: 11, padding: '4px 12px', background: '#065f46', color: '#6ee7b7', border: 'none', cursor: 'pointer' }}>
                Copiază
              </button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.8, color: '#ccc', whiteSpace: 'pre-wrap' }}>
              {rewriteResult}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
