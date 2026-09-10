import { marked } from '../node_modules/@earendil-works/pi-coding-agent/node_modules/marked/lib/marked.esm.js';

// Render a small, safe DOM vocabulary. Raw HTML/images never become executable markup or network requests.
export function renderMarkdown(target, source) {
  const doc = target.ownerDocument;
  const element = (tag, text) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  function render(parent, tokens) {
    for (const t of tokens ?? []) {
      if (t.type === 'space' || t.type === 'def') continue;
      if (t.type === 'code') {
        const box = element('div'); box.className = 'code-block';
        const heading = element('div'); heading.className = 'code-heading';
        const copy = element('button', '复制代码'); copy.type = 'button';
        copy.onclick = async () => {
          try { await navigator.clipboard.writeText(t.text); copy.textContent = '已复制'; }
          catch { copy.textContent = '请选中代码复制'; }
        };
        heading.append(element('span', t.lang?.split(/\s/)[0] || '代码'), copy);
        const pre = element('pre'); pre.append(element('code', t.text)); box.append(heading, pre); parent.append(box); continue;
      }
      if (t.type === 'list') {
        const list = element(t.ordered ? 'ol' : 'ul'); if (t.ordered) list.start = t.start;
        for (const item of t.items) { const li = element('li'); if (item.task) li.append(doc.createTextNode(item.checked ? '☑ ' : '☐ ')); render(li, item.tokens); list.append(li); }
        parent.append(list); continue;
      }
      if (t.type === 'table') {
        const wrap = element('div'); wrap.className = 'table-wrap'; const table = element('table');
        for (const [i, cells] of [t.header, ...t.rows].entries()) { const row = element('tr'); for (const cell of cells) { const td = element(i ? 'td' : 'th'); render(td, cell.tokens); row.append(td); } table.append(row); }
        wrap.append(table); parent.append(wrap); continue;
      }
      const tag = { paragraph: 'p', heading: `h${Math.min(t.depth ?? 1, 4)}`, blockquote: 'blockquote', strong: 'strong', em: 'em', del: 'del', codespan: 'code', br: 'br', hr: 'hr' }[t.type];
      if (tag) { const node = element(tag); if (t.tokens) render(node, t.tokens); else if (t.text) node.textContent = t.text; parent.append(node); continue; }
      if (t.type === 'link') {
        // Keep links readable/copyable; the app deliberately has no general external-navigation IPC.
        const label = element('span'); if (t.tokens) render(label, t.tokens); else label.textContent = t.text;
        parent.append(label); if (t.href && t.href !== t.text) parent.append(doc.createTextNode(` (${t.href})`)); continue;
      }
      if (t.tokens) render(parent, t.tokens);
      else parent.append(doc.createTextNode(t.type === 'html' ? t.raw : t.text ?? t.raw ?? ''));
    }
  }
  const fragment = doc.createDocumentFragment(); render(fragment, marked.lexer(source || '')); target.replaceChildren(fragment);
}
