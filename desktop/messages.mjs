import { stripVTControlCharacters } from 'node:util';
import { randomUUID } from 'node:crypto';

export const visibleMessage = message => ['user', 'assistant', 'toolResult'].includes(message?.role);
const clean = value => stripVTControlCharacters(String(value ?? ''));
export function toolSummary(name, args) {
  if (['read', 'write', 'edit', 'grep', 'find', 'ls'].includes(name)) return clean(args?.path).slice(0, 500);
  // Command arguments can contain credentials. Show only the executable, never arbitrary arguments.
  if (name === 'bash') return clean(args?.command).trim().match(/^[\w./-]+/)?.[0]?.slice(0, 100) || '';
  return '';
}
export function displayMessage(message, id) {
  if (!visibleMessage(message)) return null;
  const text = clean(typeof message.content === 'string' ? message.content : (message.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n'));
  return { id, role: message.role, toolCallId: message.toolCallId, toolName: message.toolName,
    isError: message.isError, stopReason: message.stopReason, error: clean(message.errorMessage),
    text: text.slice(0, 60000), truncated: text.length > 60000,
    calls: message.role === 'assistant' && Array.isArray(message.content) ? message.content.filter(c => c.type === 'toolCall').map(c => ({ id: c.id, name: c.name, summary: toolSummary(c.name, c.arguments) })) : [],
  };
}

export function messageProjection(manager) {
  let activeId;
  const prefix = manager.getSessionId();
  return {
    history() {
      return manager.getBranch().filter(e => e.type === 'message' && visibleMessage(e.message)).map(e => displayMessage(e.message, `${prefix}:${e.id}`));
    },
    start(message) { activeId = `${prefix}:live:${randomUUID()}`; return displayMessage(message, activeId); },
    update(message) { return activeId ? displayMessage(message, activeId) : null; },
    end(message, publish) {
      const previousId = activeId;
      activeId = undefined;
      // Pi 0.85.1 persists this exact object synchronously after notifying subscribers.
      // Rebind explicitly after persistence; never infer identity from role, timestamp or text.
      queueMicrotask(() => {
        const entry = manager.getBranch().find(e => e.type === 'message' && e.message === message);
        const id = entry ? `${prefix}:${entry.id}` : previousId;
        if (id) publish({ ...displayMessage(message, id), previousId });
      });
    },
  };
}
