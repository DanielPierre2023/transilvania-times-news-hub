const stripDia = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ș/g, "s").replace(/ț/g, "t").replace(/ş/g, "s").replace(/ţ/g, "t");
function clampWords(text, max) {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.…-]+$/, "") + "\u2026";
}
function hashtagize(raw) {
  const words = stripDia(String(raw || "")).replace(/[^A-Za-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).slice(0, 4);
  if (!words.length) return "";
  const joined = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  return joined.length > 2 ? "#" + joined : "";
}
function dedupeSentences(parts) {
  const seen = [];
  const key = (x) => stripDia(x).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const isSkippable = (line) => !line.trim() || /^#|^https?:\/\//.test(line.trim()) || line.trim().split(/\s+/).every((w) => w.startsWith("#"));
  return parts.map((part) => {
    if (part === void 0 || part === null) return part;
    const text = String(part);
    if (isSkippable(text)) return text;
    const keptLines = text.split("\n").map((line) => {
      if (isSkippable(line)) return line;
      const sentences = line.match(/[^.!?…]+[.!?…]*\s*/g) || [line];
      const kept = sentences.filter((sen) => {
        const k = key(sen);
        if (k.length < 12) return true;
        if (seen.some((prev) => prev === k || prev.includes(k))) return false;
        seen.push(k);
        return true;
      });
      return kept.join("").trim();
    });
    const body = keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!body) return "";
    const lead = (text.match(/^\s*/) || [""])[0];
    const tail = (text.match(/\s*$/) || [""])[0];
    return lead + body + tail;
  });
}
export {
  dedupeSentences
};
