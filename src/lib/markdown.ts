/**
 * Shared markdown-to-HTML converter used by both the admin editor preview
 * and the public-facing BlogPost page.
 */

function processInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export const mdToHtml = (md: string): string => {
  if (!md) return '';

  // Split into blocks by double newlines
  const blocks = md.split(/\n\n+/);
  const htmlBlocks: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Heading blocks
    if (/^### (.+)$/.test(trimmed)) {
      htmlBlocks.push(`<h3>${processInline(trimmed.replace(/^### /, ''))}</h3>`);
      continue;
    }
    if (/^## (.+)$/.test(trimmed)) {
      htmlBlocks.push(`<h2>${processInline(trimmed.replace(/^## /, ''))}</h2>`);
      continue;
    }

    // List blocks — all lines start with "- "
    const lines = trimmed.split('\n');
    if (lines.every(l => /^[-*] /.test(l.trim()))) {
      const items = lines
        .map(l => `<li>${processInline(l.trim().replace(/^[-*] /, ''))}</li>`)
        .join('');
      htmlBlocks.push(`<ul>${items}</ul>`);
      continue;
    }

    // Image blocks
    const imgMatch = trimmed.match(/^!\[([^\]]*)\]\((.+?)\)$/);
    if (imgMatch) {
      htmlBlocks.push(`<figure><img src="${imgMatch[2]}" alt="${imgMatch[1]}" loading="lazy" /></figure>`);
      continue;
    }

    // Regular paragraph — process inline markdown, convert single newlines to <br>
    const processed = lines.map(l => processInline(l)).join('<br>');
    htmlBlocks.push(`<p>${processed}</p>`);
  }

  return htmlBlocks.join('');
};
