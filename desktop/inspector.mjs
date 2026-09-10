import { renderMarkdown } from './markdown.mjs';
const $ = id => document.getElementById(id);
const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };

export function createInspector({ answer, revise, changes }) {
  let snapshot, question, files = [], selected, generation = 0, activeTab = 'plan', rendered;
  const toggle = open => { $('progress-panel').hidden = !open; $('progress-toggle').setAttribute('aria-expanded', String(open)); };
  function tab(name) {
    activeTab = name; toggle(true);
    document.querySelectorAll('[data-panel]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.panel === name)));
    for (const key of ['plan', 'changes', 'checks']) $(`panel-${key}`).hidden = key !== name;
  }
  function documentSection(target, title, text, key, filename) {
    const details = el('details', '', 'full-document'), body = el('div', '', 'markdown'), heading = el('summary', title);
    if (filename) heading.append(el('small', filename, 'document-filename'));
    details.dataset.document = key; renderMarkdown(body, text || '尚未记录。'); details.append(heading, body); target.append(details);
  }
  function render(expandDecision = false) {
    const state = question?.workflow.snapshot ?? snapshot;
    const open = new Set([...document.querySelectorAll('[data-document][open]')].map(node => node.dataset.document));
    const signature = JSON.stringify([state, snapshot?.phase, snapshot?.error, question?.id]);
    if (signature === rendered) return;
    rendered = signature;
    $('phase-label').textContent = snapshot?.error ? '进度读取失败' : snapshot?.phaseLabel || '工作详情';
    $('phase-label').dataset.phase = snapshot?.phase || '';
    $('task-title').textContent = state?.error ? '工作状态暂不可用' : state?.title || '从一个具体目标开始';
    $('task-ref').textContent = state?.task || '';
    $('task-agent').textContent = state?.agentName ? `本轮助手：${state.agentName}（输入框选择仅用于新任务）` : '';
    $('progress-summary').textContent = state?.error || state?.summary || '当前对话尚未绑定任务。普通咨询无需建任务。';
    $('progress-next').textContent = state?.error ? '请先解决上方问题，再重新查看任务状态。' : state?.next || '描述你的目标，助手会先了解项目，再与你确认范围。';
    const docs = $('plan-documents'); docs.replaceChildren();
    if (state?.assessment) {
      const a = state.assessment;
      documentSection(docs, '项目调查与本轮范围', [a.overview, a.focus, a.runInstructions, ...(a.preserve ?? []).map(p => `- 保留：${p}`), ...(a.findings ?? []).map(f => `### ${f.title}\n${f.impact}\n依据：${f.evidence.join('、')}`)].join('\n\n'), 'assessment');
    }
    const labels = { 'prd.md': '需求与验收标准', 'design.md': '实施方案', 'implement.md': '执行清单' };
    for (const [name, text] of Object.entries(state?.documents ?? {})) documentSection(docs, labels[name] || '任务文档', text, name, name);
    const check = state?.check, success = check?.exitCode === 0 && !check.killed;
    $('checks-title').textContent = state?.error ? '检查状态不可用' : check ? success ? '检查命令执行成功' : check.killed ? '检查已中断' : '检查失败' : state?.checkRunning ? '正在运行检查' : state?.phase === 'checking' ? '检查已结束，尚无可用的最终记录' : '尚未运行检查';
    $('checks-title').dataset.tone = check ? success ? 'success' : 'error' : '';
    $('checks-time').textContent = check ? `记录时间：${check.at} · 退出码 ${check.exitCode ?? '未知'}` : '';
    $('checks-command').textContent = state?.error ? '当前无法读取检查命令。' : check?.command || state?.checkCommand || '尚未确认检查命令。';
    $('checks-note').textContent = check ? '这是该任务保存的最近一次检查，不是查看面板时重新执行。退出成功不代表全部检查项都运行，请核对输出中的跳过项。' : '只展示 storm_check 保存的真实结果，不从对话或工具完成推断通过。';
    $('checks-log').textContent = check ? `${check.stdout || ''}\n${check.stderr || ''}` : '暂无实际检查输出。';
    $('checks-retry').hidden = !check || success || Boolean(question);
    const delivery = $('delivery-report'); delivery.replaceChildren();
    if (state?.handoff) {
      const h = state.handoff;
      documentSection(delivery, '交付与遗留事项', [h.summary, h.runInstructions, '### 遗留事项', ...(h.remaining ?? []).map(note => `- ${note}`), '### 项目经验', ...(h.memories ?? []).map(note => `- ${note.fact}\n  来源：${note.source}`)].join('\n\n'), 'handoff');
    }
    document.querySelectorAll('[data-document]').forEach(node => {
      const key = node.dataset.document;
      const relevant = question?.workflow.kind === 'accept' ? key === 'handoff' : ['prd.md', 'design.md'].includes(key) && Boolean(state?.documents?.[key]);
      node.open = open.has(key) || (expandDecision && relevant);
    });
    $('workflow-actions').hidden = !question;
    $('confirmation-original').hidden = !question;
    $('confirmation-text').textContent = question?.message || '';
    if (question) {
      $('workflow-question-title').textContent = question.workflow.kind === 'accept' ? '请审阅这次交付' : '准备好开始了吗？';
      $('workflow-question-note').textContent = '仅回答当前这一次请求；取消或停止不会批准。';
      $('decision-command-label').textContent = question.workflow.kind === 'accept' ? '本次实际检查命令' : '确认后使用的检查命令';
      $('decision-command').textContent = (question.workflow.kind === 'accept' ? check?.command : state?.checkCommand) || '尚未记录检查命令。';
      $('workflow-confirm').textContent = question.workflow.kind === 'accept' ? '确认验收结果' : '确认并开始';
      $('workflow-confirm').disabled = question.workflow.kind === 'accept' && !success;
    }
  }
  function selectFile(index) {
    selected = index; const file = files[index];
    $('diff-name').textContent = file ? `${file.oldPath ? `${file.oldPath} → ` : ''}${file.path}` : '';
    $('diff-patch').replaceChildren();
    $('file-list').querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(index === i)));
    if (!file) return;
    const text = file.group === 'untracked' ? '未跟踪文件只列名称，不读取内容。' : file.patch || '无可显示的文本差异。';
    for (const line of text.split('\n')) $('diff-patch').append(el('span', `${line}\n`, line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : ''));
    if (file.binary) $('diff-patch').append(el('span', '\n二进制文件：不显示内容。', 'muted'));
    if (file.truncated) $('diff-patch').append(el('span', '\n…此文件差异已截断。', 'muted'));
  }
  async function refreshChanges() {
    const request = ++generation;
    $('changes-status').textContent = '正在读取当前 Git 工作区…'; $('changes-refresh').disabled = true;
    try {
      const result = await changes(); if (request !== generation) return;
      files = result.files; $('changes-body').textContent = result.text;
      $('changes-status').textContent = `${files.length} 项改动${result.truncated ? ' · 显示已截断（最多 100 项 / 单文件 128 KiB / 合计 1 MiB）' : ''}`;
      $('file-list').replaceChildren();
      for (const [index, file] of files.entries()) {
        const button = el('button', `${({ staged: '已暂存', unstaged: '未暂存', untracked: '未跟踪' })[file.group]} · ${file.status} · ${JSON.stringify(file.path)}`, 'file-choice');
        button.title = file.path; button.onclick = () => selectFile(index); $('file-list').append(button);
      }
      selectFile(files.length ? Math.min(selected ?? 0, files.length - 1) : undefined);
    } catch (error) { if (request === generation) { files = []; $('file-list').replaceChildren(); selectFile(); $('changes-body').textContent = ''; $('changes-status').textContent = `无法读取差异：${error.message}`; } }
    finally { if (request === generation) $('changes-refresh').disabled = false; }
  }
  document.querySelectorAll('[data-panel]').forEach(button => { button.onclick = () => { tab(button.dataset.panel); if (activeTab === 'changes') refreshChanges(); }; });
  $('progress-toggle').onclick = () => toggle($('progress-panel').hidden);
  $('progress-close').onclick = () => { toggle(false); $('progress-toggle').focus(); };
  $('changes-open').onclick = () => { tab('changes'); refreshChanges(); };
  $('changes-refresh').onclick = refreshChanges;
  $('workflow-cancel').onclick = () => answer(undefined);
  $('workflow-confirm').onclick = () => { if (question && !$('workflow-confirm').disabled) answer(true); };
  $('workflow-revise').onclick = () => { const text = $('revision-text').value.trim(); if (!text) { $('revision-text').focus(); return; } answer(undefined); revise(text); };
  $('checks-retry').onclick = () => revise('请根据当前失败或中断的检查修复问题，并通过已确认的工作流重新检查。');
  return {
    toggle,
    update(value) { snapshot = value; render(); },
    question(value) { const changed = value?.id !== question?.id; question = value; $('revision-text').value = ''; $('revision').open = false; render(Boolean(value) && changed); if (value) { tab(value.workflow.kind === 'accept' ? 'checks' : 'plan'); $('workflow-cancel').focus(); } },
    reset() { generation++; snapshot = question = undefined; files = []; selected = undefined; $('file-list').replaceChildren(); selectFile(); $('changes-body').textContent = ''; $('changes-status').textContent = '尚未查询。'; $('changes-refresh').disabled = false; render(); toggle(false); },
  };
}
