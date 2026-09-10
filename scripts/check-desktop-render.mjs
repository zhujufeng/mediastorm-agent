import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const { renderMarkdown } = await import(process.argv[2] ? pathToFileURL(join(process.argv[2], 'desktop/markdown.mjs')).href : '../desktop/markdown.mjs');

// A tiny DOM recorder: verifies the real renderer's output vocabulary, never simulates HTML parsing.
const nodes = [];
const doc = {
  createElement(tag) {
    const node = { tag, ownerDocument: doc, children: [], textContent: '', append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; } };
    nodes.push(node); return node;
  },
  createTextNode(text) { return { textContent: text }; },
  createDocumentFragment() { return this.createElement('fragment'); },
};
const target = doc.createElement('div');
const source = '# Heading\n\nA **bold** result with `code`.\n\n- [x] Done\n- Next\n\n| File | Result |\n| --- | --- |\n| a.js | OK |\n\n```js\nconst x = "<script>";\n```\n\n<script>throw 1</script>\n\n[unsafe](javascript:alert(1)) ![remote](https://example.com/pixel)\n';
renderMarkdown(target, source);
for (const tag of ['h1', 'strong', 'code', 'ul', 'li', 'table', 'th', 'td', 'pre']) assert.ok(nodes.some(n => n.tag === tag), tag);
assert.ok(nodes.some(n => n.tag === 'code' && n.textContent.includes('<script>')));
assert.ok(!nodes.some(n => ['script', 'img', 'iframe', 'a', 'style'].includes(n.tag)));
assert.ok(nodes.every(n => !('innerHTML' in n) && !('src' in n) && !('href' in n)));
const text = node => (node.textContent || '') + (node.children || []).map(text).join('');
assert.ok(text(target).includes('<script>throw 1</script>'));
assert.ok(text(target).includes('☑'));
renderMarkdown(target, 'Replacement');
assert.equal(text(target), 'Replacement');
console.log('PASS: Markdown headings, lists, tables and code; raw HTML and unsafe links remain inert text.');
