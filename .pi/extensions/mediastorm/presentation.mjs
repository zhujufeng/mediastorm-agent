import { documentNames, loadProgress, phases, readDocument, relativeTask } from './state.mjs';
import { agentProfile } from './agents.mjs';

const clip = text => String(text ?? '').length > 60000 ? `${String(text).slice(0, 60000)}\n…显示已截断，请查看项目中的原记录。` : String(text ?? '');
// Display-only projection; never usable as approval or a task-write API.
export function workflowSnapshot(root, task) {
  if (!task) return { project: root, task: null };
  const state = loadProgress(task);
  return {
    project: root, task: relativeTask(root, task), title: JSON.parse(readDocument(task, 'task.json')).title,
    phase: state.phase, phaseLabel: phases[state.phase], agent: state.agent, agentName: agentProfile(state.agent).name,
    summary: state.summary, next: state.next, checkCommand: state.checkCommand,
    assessment: state.assessment ? { overview: state.assessment.overview, focus: state.assessment.focus,
      runInstructions: state.assessment.runInstructions, preserve: state.assessment.preserve,
      findings: state.assessment.findings.map(({ title, impact, evidence }) => ({ title, impact, evidence })) } : null,
    handoff: state.handoff ? { summary: state.handoff.summary, runInstructions: state.handoff.runInstructions,
      remaining: state.handoff.remaining, memories: state.handoff.memories.map(({ fact, source }) => ({ fact, source })) } : null,
    check: state.check ? { exitCode: state.check.exitCode, killed: state.check.killed, command: state.check.command,
      at: state.check.at, stdout: clip(state.check.stdout), stderr: clip(state.check.stderr) } : null,
    documents: Object.fromEntries(documentNames.map(name => [name, clip(readDocument(task, name))])),
  };
}
