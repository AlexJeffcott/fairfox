function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInline(text: string): string {
  let r = esc(text);
  // Inline inspection links: {text|target}
  r = r.replace(/\{([^|]+)\|([^}]+)\}/g, '<a data-inspect="$2">$1</a>');
  r = r.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  r = r.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return r;
}

export function textToHtml(text: string): string {
  if (!text) return '';
  const blocks = text.split(/\n\n+/);
  let html = '';

  for (let p of blocks) {
    p = p.trim();
    if (!p) continue;

    // Separator
    if (/^---+$/.test(p)) {
      html +=
        '<div class="separator">&middot;&nbsp;&nbsp;&nbsp;&middot;&nbsp;&nbsp;&nbsp;&middot;</div>';
      continue;
    }

    // Blockquote
    if (p.startsWith('>')) {
      const lines = p.split('\n').map((l) => l.replace(/^>\s*/, ''));
      html +=
        '<blockquote>' +
        lines.map((l) => '<p>' + renderInline(l) + '</p>').join('') +
        '</blockquote>';
      continue;
    }

    // Equation
    if (/^\*\*[⚫⚪=\s]+\*\*$/.test(p)) {
      html += '<p class="equation">' + esc(p.replace(/\*\*/g, '')) + '</p>';
      continue;
    }

    // Inner voice (whole paragraph wrapped in single *)
    if (/^\*[^*]/.test(p) && /[^*]\*$/.test(p) && !p.startsWith('**')) {
      html += '<p class="inner-voice">' + esc(p.slice(1, -1)) + '</p>';
      continue;
    }

    // Regular paragraph
    html += '<p>' + renderInline(p) + '</p>';
  }

  return html;
}
