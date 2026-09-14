import { renderMarkdown } from './markdown.mjs';
const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const status = { pending: '等待执行', running: '执行中', done: '已完成', error: '执行失败', unknown: '无最终结果 / 已中断' };

export function createThread(container, welcome) {
  const messages = new Map(), tools = new Map();
  let round, orphan;
  function newRound(id, incomplete = false) {
    const node = el('section', '', 'round'), process = el('details', '', 'process');
    node.dataset.round = id; process.dataset.key = `round:${id}`; process.hidden = true;
    const summary = el('summary', '处理过程'), list = el('div', '', 'process-list'); process.append(summary, list);
    if (incomplete) node.append(el('p', '较早回合的记录（前文已省略）', 'small muted'));
    node.append(process); container.append(node);
    return { node, process, summary, list, tools: new Set() };
  }
  function summarize(owner) {
    const entries = [...owner.tools].map(id => tools.get(id));
    const counts = Object.fromEntries(Object.keys(status).map(s => [s, entries.filter(t => t.state === s).length]));
    owner.summary.textContent = `处理过程 · ${entries.length} 项` + Object.entries(counts).filter(([, n]) => n).map(([s, n]) => ` · ${status[s]} ${n}`).join('');
    owner.process.hidden = !entries.length;
  }
  function tool(call, owner) {
    if (!call.id) return;
    let item = tools.get(call.id);
    if (!item) {
      owner ??= orphan ??= newRound('orphan', true);
      const node = el('details', '', 'process-tool'), heading = el('summary'), output = el('pre');
      node.dataset.key = `tool:${call.id}`; node.dataset.toolCallId = call.id;
      node.append(heading, output); owner.list.append(node); owner.tools.add(call.id);
      item = { node, heading, output, owner, name: call.name, summary: call.summary, state: 'pending' }; tools.set(call.id, item);
    }
    if (call.name) item.name = call.name;
    if (call.summary) item.summary = call.summary;
    if (call.state) item.state = call.state;
    if (call.text !== undefined) item.output.textContent = call.text + (call.truncated ? '\n…界面已截断，完整输出保留在本机会话记录。' : '');
    item.node.dataset.state = item.state;
    item.heading.textContent = `${status[item.state]} · ${item.name || '工具'}${item.summary ? ` · ${item.summary}` : ''}`;
    summarize(item.owner); return item;
  }
  function upsert(message) {
    if (!message?.id || !['user', 'assistant', 'toolResult'].includes(message.role)) return;
    welcome.remove();
    if (message.role === 'toolResult') { tool({ id: message.toolCallId, name: message.toolName, state: message.isError ? 'error' : 'done', text: message.text, truncated: message.truncated }); return; }
    let item = messages.get(message.id) ?? messages.get(message.previousId);
    if (item && message.previousId && message.id !== message.previousId) {
      messages.delete(message.previousId); messages.set(message.id, item); item.node.dataset.messageId = message.id;
      if (message.role === 'user') { item.owner.node.dataset.round = message.id; item.owner.process.dataset.key = `round:${message.id}`; }
    }
    if (!item) {
      if (message.role === 'user') round = newRound(message.id);
      const owner = round ?? (orphan ??= newRound('orphan', true));
      const node = el('article', '', `message ${message.role}`), speaker = el('div', message.role === 'user' ? '你' : 'MediaStorm', 'speaker');
      const text = el('div', '', message.role === 'assistant' ? 'text markdown' : 'text'), error = el('div', '', 'error');
      const images = el('p', '', 'small muted message-images');
      node.dataset.messageId = message.id; node.append(speaker, text, images, error);
      if (message.role === 'user') owner.node.prepend(node); else owner.node.append(node);
      item = { node, text, images, error, owner }; messages.set(message.id, item);
    }
    if (message.role === 'assistant') renderMarkdown(item.text, message.text); else item.text.textContent = message.text;
    item.error.textContent = message.error || (message.stopReason === 'aborted' ? '回复已停止，可在下方继续。' : '');
    if (message.truncated) item.error.append(el('p', '界面已截断，完整文本保留在本机会话记录。'));
    item.images.textContent = message.imageCount ? `附有${message.imageCount}张图片 · 已保存在本机会话，历史仅显示图片数量` : '';
    item.images.hidden = !message.imageCount;
    item.node.hidden = !message.text && !message.imageCount && !item.error.textContent;
    for (const call of message.calls ?? []) tool(call, item.owner);
  }
  return {
    upsert,
    tool: event => tool({ id: event.toolCallId, name: event.name, summary: event.summary, state: event.state }),
    settle() { for (const [id, item] of tools) if (['pending', 'running'].includes(item.state)) tool({ id, state: 'unknown' }); },
    reset() { messages.clear(); tools.clear(); round = orphan = undefined; container.replaceChildren(welcome); },
    history(event) {
      const open = new Set([...container.querySelectorAll('details[open]')].map(node => node.dataset.key));
      messages.clear(); tools.clear(); round = orphan = undefined; container.replaceChildren();
      if (!event.messages.length) { container.append(welcome); return; }
      if (event.omitted) container.append(el('p', `显示最近 200 条消息，更早的 ${event.omitted} 条保留在本机会话记录。`, 'small muted'));
      event.messages.forEach(upsert);
      for (const [id, item] of tools) if (item.state === 'pending') tool({ id, state: 'unknown' });
      container.querySelectorAll('details').forEach(node => { node.open = open.has(node.dataset.key); });
    },
  };
}
