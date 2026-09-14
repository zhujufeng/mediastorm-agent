import trellis from './trellis/index.ts';

// Keep upstream runtime/tools intact, but let MediaStorm alone supply product workflow instructions.
export default function trellisProduct(pi) {
  trellis({
    ...pi,
    on(event, handler) {
      if (event === 'before_agent_start') return;
      if (event === 'session_start') {
        pi.on(event, (value, ctx) => handler(value, {
          ...ctx, ui: { ...ctx.ui, notify: (message, level) => ctx.ui.notify(
            message.startsWith('Trellis project context is available.')
              ? 'Trellis 已加载；任务推进与确认由 MediaStorm 工作流管理。' : message, level),
          },
        }));
      } else pi.on(event, handler);
    },
  });
  pi.on('context', event => ({
    // Historical automatic instructions are excluded from requests, not deleted from the session file.
    messages: event.messages.filter(message => !(message.role === 'custom' && message.customType === 'trellis-runtime-context')),
  }));
}
