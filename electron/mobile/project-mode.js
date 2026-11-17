// Modes describe the work. The desktop enforces folder trust and the sandbox.
export function projectMode(session, workflowMode) {
  if (session?.scope) return 'plan';
  if (session?.workflow?.teamSlot?.mode) return session.workflow.teamSlot.mode;
  if (session?.workflow) return workflowMode || (['task','document'].includes(session.workflow.kind) ? 'build' : 'plan');
  return 'build';
}
