// Enterprise-grade post-processing sanitization for AI-generated content
type Replacement = [RegExp, string | ((...args: string[]) => string)];

const EN_PHRASES: Replacement[] = [
  [/^In the ever-evolving (field|world|landscape|domain) of [^,.]+,?\s*/im, ''],
  [/^The last few years have witnessed\s*/im, ''],
  [/^In recent years,?\s*/im, ''],
  [/^Over the past decade,?\s*/im, ''],
  [/^It'?s no secret that\s*/im, ''],
  [/^There'?s no denying that\s*/im, ''],
  [/^The rise of [^,.]+has\s*/im, ''],
  [/^In an increasingly [^,.]+,?\s*/im, ''],
  [/^As technology continues to [^,.]+,?\s*/im, ''],
  [/^The rapid advancement of [^,.]+has\s*/im, ''],
  [/^In the fast-paced world of [^,.]+,?\s*/im, ''],
  [/\bin today'?s world\b/gi, 'today'],
  [/\bin an era of\b/gi, 'with'],
  [/\bthe realm of\b/gi, 'the field of'],
  [/\bserves as a\b/gi, 'acts as a'],
  [/\bserves as a reminder\b/gi, 'reminds us'],
  [/\bit is important to note\b/gi, 'notably'],
  [/\bit'?s important to\b/gi, ''],
  [/\bit'?s worth noting\b/gi, 'notably'],
  [/\bit should be noted\b/gi, ''],
  [/\bit goes without saying\b/gi, ''],
  [/\bneedless to say\b/gi, ''],
  [/\ba testament to\b/gi, 'proof of'],
  [/\bthe intersection of\b/gi, 'where'],
  [/\bshed light on\b/gi, 'clarify'],
  [/\bat the end of the day\b/gi, 'ultimately'],
  [/\bat its core\b/gi, 'fundamentally'],
  [/\bat the heart of\b/gi, 'central to'],
  [/\bparadigm shift\b/gi, 'fundamental change'],
  [/\bpave the way\b/gi, 'open the door'],
  [/\btap into\b/gi, 'draw on'],
  [/\bin conclusion\b/gi, ''],
  [/\bto sum up\b/gi, ''],
  [/\blooking ahead\b/gi, ''],
  [/\bthe bottom line\b/gi, ''],
  [/\bas we move forward\b/gi, ''],
  [/\bin this regard\b/gi, ''],
  [/\bwhen it comes to\b/gi, 'for'],
  [/\bone of the key\b/gi, 'a'],
  [/\bhas become increasingly\b/gi, 'is now more'],
  [/\bplays a crucial role\b/gi, 'matters'],
  [/\bplays an essential role\b/gi, 'matters'],
  [/\bplays a vital role\b/gi, 'matters'],
  [/\bplays an important role\b/gi, 'matters'],
  [/\bworth mentioning\b/gi, ''],
  [/\ba closer look at\b/gi, 'examining'],
  [/\bstands out as\b/gi, 'is'],
  [/\bgame[- ]changer\b/gi, 'breakthrough'],
  [/\bcutting[- ]edge\b/gi, 'advanced'],
  [/^Furthermore,\s*/gm, ''],
  [/^Moreover,\s*/gm, ''],
  [/^Additionally,\s*/gm, ''],
  [/^Consequently,\s*/gm, 'As a result, '],
  [/^Interestingly,\s*/gm, ''],
  [/^Notably,\s*/gm, ''],
  [/^Specifically,\s*/gm, ''],
  [/^Importantly,\s*/gm, ''],
  [/^Significantly,\s*/gm, ''],
  [/\bIt is worth emphasizing\b/gi, ''],
  [/\bIt is important to understand\b/gi, ''],
  [/\bThis is particularly\b/gi, 'This is especially'],
  [/\bnot only\b/gi, ''],
  [/\bbut also\b/gi, 'and'],
];

const EN_WORDS: Replacement[] = [
  [/\bdelves?\b/gi, (m: string) => m[0] === m[0].toUpperCase() ? 'Explores' : 'explores'],
  [/\blandscape\b/gi, 'field'],
  [/\brevolutioniz(e|es|ed|ing)\b/gi, (_m: string, s: string) => `transform${s === 'es' ? 's' : s === 'ed' ? 'ed' : s === 'ing' ? 'ing' : ''}`],
  [/\bleverag(e|es|ed|ing)\b/gi, (_m: string, s: string) => `us${s === 'es' ? 'es' : s === 'ed' ? 'ed' : s === 'ing' ? 'ing' : 'e'}`],
  [/\bnavigate\b/gi, 'manage'],
  [/\bnavigating\b/gi, 'managing'],
  [/\bholistic\b/gi, 'complete'],
  [/\brobust\b/gi, 'strong'],
  [/\bcomprehensive\b/gi, 'thorough'],
  [/\bmultifaceted\b/gi, 'complex'],
  [/\bfoster(s|ed|ing)?\b/gi, (_m: string, s: string) => `encourage${(s === 's') ? 's' : (s === 'ed') ? 'd' : (s === 'ing') ? 'ing' : ''}`],
  [/\bbolster(s|ed|ing)?\b/gi, (_m: string, s: string) => `strengthen${(s === 's') ? 's' : (s === 'ed') ? 'ed' : (s === 'ing') ? 'ing' : ''}`],
  [/\bharness(es|ed|ing)?\b/gi, (_m: string, s: string) => `us${(s === 'es') ? 'es' : (s === 'ed') ? 'ed' : (s === 'ing') ? 'ing' : 'e'}`],
  [/\bpivotal\b/gi, 'key'],
  [/\bcrucial\b/gi, 'important'],
  [/\bessential\b/gi, 'necessary'],
  [/\bvital\b/gi, 'important'],
  [/\bstreamlin(e|es|ed|ing)\b/gi, (_m: string, s: string) => `simplif${s === 'es' ? 'ies' : s === 'ed' ? 'ied' : s === 'ing' ? 'ying' : 'y'}`],
  [/\bsynergy\b/gi, 'cooperation'],
  [/\becosystem\b/gi, 'environment'],
  [/\bspearhead(s|ed|ing)?\b/gi, (_m: string, s: string) => `lead${(s === 's') ? 's' : (s === 'ed') ? 'led' : (s === 'ing') ? 'ing' : ''}`],
  [/\bunderpin(s|ned|ning)?\b/gi, (_m: string, s: string) => `support${(s === 's') ? 's' : (s === 'ned') ? 'ed' : (s === 'ning') ? 'ing' : ''}`],
  [/\bunlock(s|ed|ing)?\b/gi, (_m: string, s: string) => `enable${(s === 's') ? 's' : (s === 'ed') ? 'd' : (s === 'ing') ? 'ing' : ''}`],
  [/\bempower(s|ed|ing)?\b/gi, (_m: string, s: string) => `enable${(s === 's') ? 's' : (s === 'ed') ? 'd' : (s === 'ing') ? 'ing' : ''}`],
];

const EN_REPLACEMENTS: Replacement[] = [...EN_PHRASES, ...EN_WORDS];

const RO_PHRASES: Replacement[] = [
  [/^În ultimii ani,?\s*/im, ''],
  [/^Domeniul [^,.]+a evoluat\s*/im, ''],
  [/^Tehnologia a transformat\s*/im, ''],
  [/^Într-o lume în care\s*/im, ''],
  [/^Pe măsură ce [^,.]+,?\s*/im, ''],
  [/^Într-o eră [^,.]+,?\s*/im, ''],
  [/^Avansul rapid al [^,.]+\s*/im, ''],
  [/^Nu este un secret că\s*/im, ''],
  [/^Lumea afacerilor [^,.]+\s*/im, ''],
  [/\bîn concluzie\b/gi, ''],
  [/\bpe scurt\b/gi, ''],
  [/\bprivind în perspectivă\b/gi, ''],
  [/\bîn final\b/gi, ''],
  [/\bîn cele din urmă\b/gi, ''],
  [/\bprin urmare\b/gi, ''],
  [/\bîn lumea de astăzi\b/gi, 'în prezent'],
  [/\bîn era actuală\b/gi, 'în prezent'],
  [/\bîn contextul actual\b/gi, 'acum'],
  [/\bde menționat\b/gi, 'de remarcat'],
  [/\bmerită menționat\b/gi, 'e de remarcat'],
  [/\beste de menționat\b/gi, ''],
  [/\beste demn de remarcat\b/gi, ''],
  [/\btrebuie subliniat că\b/gi, ''],
  [/\beste important de menționat\b/gi, ''],
  [/\bacest lucru este important\b/gi, ''],
  [/\bun aspect (adesea|frecvent) neglijat\b/gi, ''],
  [/\bun aspect important\b/gi, ''],
  [/\bo primă etapă\b/gi, ''],
  [/\bun element cheie\b/gi, 'un factor'],
  [/\bjoacă un rol\b/gi, 'contribuie'],
  [/\bjoacă un rol important\b/gi, 'contribuie la'],
  [/\brol esențial\b/gi, 'rol major'],
  [/\brol crucial\b/gi, 'rol major'],
  [/\brol vital\b/gi, 'rol major'],
  [/\bse dovedește a fi\b/gi, 'este'],
  [/\bdevine din ce în ce mai\b/gi, 'devine tot mai'],
  [/\bpe măsură ce tehnologia avansează\b/gi, ''],
  [/\bcând vine vorba de\b/gi, 'pentru'],
  [/\ba valorifica\b/gi, 'a folosi'],
  [/\ba debloca\b/gi, 'a permite'],
  [/\ba eficientiza\b/gi, 'a simplifica'],
  [/\ba orchestra\b/gi, 'a coordona'],
  [/\ba transforma radical\b/gi, 'a schimba profund'],
  [/\ba naviga\b/gi, 'a gestiona'],
  [/\bnu în ultimul rând\b/gi, 'de asemenea'],
  [/\biată (câteva|cum)\b/gi, ''],
  [/\biată\b/gi, ''],
  [/\bdesigur\b/gi, ''],
  [/\bfără îndoială\b/gi, ''],
  [/\bfără doar și poate\b/gi, ''],
  [/^Mai mult,\s*/gm, ''],
  [/^De asemenea,\s*/gm, ''],
  [/^În mod special,\s*/gm, ''],
  [/\bEste important să înțelegem\b/gi, ''],
  [/^Cu toate acestea,\s*/gm, 'Totuși, '],
];

const RO_WORDS: Replacement[] = [
  [/\besențial([ăe])?\b/gi, (_m: string, s: string) => `necesar${s === 'ă' ? 'ă' : s === 'e' ? 'e' : ''}`],
  [/\bcrucial([ăe])?\b/gi, (_m: string, s: string) => `important${s === 'ă' ? 'ă' : s === 'e' ? 'e' : ''}`],
  [/\brobust([ăe])?\b/gi, (_m: string, s: string) => `solid${s === 'ă' ? 'ă' : s === 'e' ? 'e' : ''}`],
  [/\bvital([ăe])?\b/gi, (_m: string, s: string) => `important${s === 'ă' ? 'ă' : s === 'e' ? 'e' : ''}`],
  [/\bprimordial([ăe])?\b/gi, 'de prim rang'],
  [/\bfundamental([ăe])?\b/gi, 'de bază'],
  [/\bsemnificativ([ăe])?\b/gi, (_m: string, s: string) => `notabil${s === 'ă' ? 'ă' : s === 'e' ? 'e' : ''}`],
  [/\bsubstanțial([ăe])?\b/gi, (_m: string, s: string) => `considerabil${s === 'ă' ? 'ă' : s === 'e' ? 'e' : ''}`],
  [/\bpeisajul\b/gi, 'domeniul'],
  [/\bparadigmă\b/gi, 'abordare'],
  [/\bholistic([ăe])?\b/gi, 'complet'],
  [/\bsinergie\b/gi, 'cooperare'],
  [/\becosistem\b/gi, 'mediu'],
  [/\bimperativ\b/gi, 'necesar'],
  [/\bindispensabil([ăe])?\b/gi, 'necesar'],
  [/\bremarcabil([ăe])?\b/gi, (_m: string, s: string) => `deosebit${s === 'ă' ? 'ă' : s === 'e' ? 'e' : ''}`],
  [/\bconsiderabil([ăe])?\b/gi, 'mare'],
  [/\bcuprinzăto(are|r)\b/gi, 'complet'],
];

const RO_REPLACEMENTS: Replacement[] = [...RO_PHRASES, ...RO_WORDS];

function stripBodyHeadings(text: string): string {
  let result = text.replace(/^#{1,6}\s+(.+)$/gm, '$1');
  result = result.replace(/^\s*\*\*([^*]+)\*\*\s*$/gm, '$1');
  return result;
}

const CONCLUSION_PATTERNS = [
  'in conclusion', 'to sum up', 'looking ahead', 'the bottom line',
  'final thoughts', 'conclusion', 'summing up', 'wrapping up',
  'în concluzie', 'concluzii', 'concluzia', 'pe scurt',
  'privind în perspectivă', 'gânduri finale', 'rezumat',
];

function removeConclusion(text: string): string {
  const conclusionHeadingPattern = new RegExp(
    `^#{1,6}\\s*(${CONCLUSION_PATTERNS.join('|')})\\s*$`, 'gmi'
  );
  let result = text.replace(conclusionHeadingPattern, '');
  const boldConclusionPattern = new RegExp(
    `^\\s*\\*\\*(${CONCLUSION_PATTERNS.join('|')})\\*\\*\\s*$`, 'gmi'
  );
  result = result.replace(boldConclusionPattern, '');
  return result;
}

function removeLastConclusionParagraph(text: string): string {
  const conclusionOpeners = [
    /^in summary/i, /^to conclude/i, /^all in all/i, /^overall,/i,
    /^in short/i, /^to wrap up/i, /^ultimately,? the/i,
    /^prin aplicarea/i, /^prin implementarea/i, /^prin urmare/i,
    /^prin adoptarea/i, /^în final/i, /^pe scurt/i,
    /^în concluzie/i, /^drept urmare/i, /^astfel,/i,
    /^în cele din urmă/i, /^rezumând/i,
  ];
  const paragraphs = text.split(/\n\n+/);
  if (paragraphs.length < 2) return text;
  const lastPara = paragraphs[paragraphs.length - 1].trim();
  const cleanLast = lastPara.replace(/^\*{1,2}/, '').replace(/\*{1,2}$/, '');
  for (const pattern of conclusionOpeners) {
    if (pattern.test(cleanLast)) {
      paragraphs.pop();
      return paragraphs.join('\n\n');
    }
  }
  return text;
}

function reduceSemicolons(text: string): string {
  const semicolonCount = (text.match(/;/g) || []).length;
  if (semicolonCount <= 3) return text;
  return text.replace(/;\s+([a-zăâîșț])/g, (_match, nextChar: string) => {
    return '. ' + nextChar.toUpperCase();
  });
}

function dedupParagraphOpeners(text: string): string {
  const paragraphs = text.split(/\n\n+/);
  let thisCount = 0;
  const result = paragraphs.map(p => {
    const trimmed = p.trimStart();
    if (/^This\s+[A-Z]?[a-z]/.test(trimmed)) {
      thisCount++;
      if (thisCount >= 3) {
        return p.replace(/^(\s*)This\s+/, (_m: string, ws: string) => {
          const rest = trimmed.slice(5);
          return ws + rest.charAt(0).toUpperCase() + rest.slice(1);
        });
      }
    }
    return p;
  });
  return result.join('\n\n');
}

function removeExcessiveExclamations(text: string): string {
  let count = 0;
  return text.replace(/!/g, () => {
    count++;
    return count <= 1 ? '!' : '.';
  });
}

function removeEditorialQuestions(text: string): string {
  return text.replace(/^(?!.*[""])([^.!?]*\?)\s*$/gm, (match) => {
    if (/["«»„"]/.test(match)) return match;
    return '';
  });
}

export function sanitizeContent(text: string, language: 'en' | 'ro' | 'both' = 'both'): string {
  if (!text) return text;
  let result = text;

  if (language === 'en' || language === 'both') {
    for (const [pattern, replacement] of EN_REPLACEMENTS) {
      result = result.replace(pattern, replacement as any);
    }
  }
  if (language === 'ro' || language === 'both') {
    for (const [pattern, replacement] of RO_REPLACEMENTS) {
      result = result.replace(pattern, replacement as any);
    }
  }

  result = stripBodyHeadings(result);
  result = removeConclusion(result);
  result = removeLastConclusionParagraph(result);
  result = result.replace(/\u2014/g, '\u2013');
  result = reduceSemicolons(result);
  result = dedupParagraphOpeners(result);
  result = removeExcessiveExclamations(result);
  result = removeEditorialQuestions(result);
  result = result.replace(/^\s*[,;]\s*/gm, '');
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

/**
 * Normalize an array of SEO tags to lowercase-hyphenated slugs.
 * "Cluj Foundation" → "cluj-foundation"
 * Deduplicates and caps at 50 chars per tag.
 */
export function normalizeTags(tags: string[]): string[] {
  if (!tags || !Array.isArray(tags)) return [];
  const seen = new Set<string>();
  return tags
    .map(tag => {
      if (typeof tag !== 'string') return '';
      return tag
        .trim()
        .toLowerCase()
        .replace(/[.,;:!?'"()[\]{}]/g, '')    // strip punctuation
        .replace(/\s+/g, '-')                  // spaces → hyphens
        .replace(/-{2,}/g, '-')                // collapse multiple hyphens
        .replace(/^-|-$/g, '')                 // trim leading/trailing hyphens
        .slice(0, 50);
    })
    .filter(tag => {
      if (!tag || tag.length < 2 || seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
}

/**
 * Sanitize a headline/title:
 * - Strip trailing period, comma, semicolon, colon, ellipsis
 * - Ensure sentence case (first letter uppercase)
 * - Trim whitespace
 */
export function sanitizeTitle(title: string): string {
  if (!title) return title;
  let t = title.trim();
  // Remove trailing punctuation (period, comma, semicolon, colon, ellipsis)
  t = t.replace(/[.,;:]+$/, '');
  t = t.replace(/\.{2,}$/, '');
  t = t.replace(/…$/, '');
  // Ensure first letter is uppercase
  if (t.length > 0) {
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
}

export function countWords(text: string): number {
  if (!text) return 0;
  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/[#*_~>|-]/g, '')
    .replace(/\n+/g, ' ');
  return clean.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Persona-aware humanization pass.
 * Instead of a generic rewrite that flattens all voices into neutral prose,
 * this explicitly preserves the editor's linguistic fingerprint.
 */
export async function humanizeContent(
  text: string,
  language: 'en' | 'ro',
  apiKey: string,
  editorPersona?: string
): Promise<string> {
  if (!text || text.length < 200) return text;

  const personaInstruction = editorPersona
    ? `You are refining an article written by a specific journalist. PRESERVE their unique voice, cadence, sentence rhythm, and personality. The journalist's style: ${editorPersona}\n\nDo NOT normalize the tone. Do NOT make it sound generic. Keep their fingerprint intact.`
    : '';

  const prompt = language === 'ro'
    ? `${personaInstruction}\n\nRefinează textul de mai jos păstrând vocea și stilul autorului. Variază lungimea propozițiilor — amestecă propoziții scurte cu altele lungi. Adaugă tranziții naturale. NU schimba sensul, faptele sau structura narativă. NU adăuga titluri sau concluzii. NU folosi: crucial, esențial, robust, vital, fundamental, semnificativ, paradigmă, ecosistem, sinergie, peisajul. Returnează doar textul refinat.`
    : `${personaInstruction}\n\nRefine the text below while preserving the author's voice and style. Vary sentence length — mix short with long. Add natural transitions. Do NOT change meaning, facts, or narrative structure. Do NOT add headings or conclusion. Do NOT use: delve, landscape, robust, comprehensive, crucial, essential, vital, pivotal, leverage, navigate, paradigm, ecosystem, synergy, foster, bolster, harness, streamline. Return only the refined text.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: text },
        ],
        temperature: 0.4,
        max_tokens: 6000,
      }),
    });
    const data = await res.json();
    const result = data.choices?.[0]?.message?.content;
    if (result && result.length > text.length * 0.5) {
      return sanitizeContent(result, language);
    }
    return text;
  } catch {
    console.error('Humanization pass failed, returning original');
    return text;
  }
}
