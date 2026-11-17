// A missing policy on an older chat must not grant new file access.
export function projectMode(session, draftMode, defaults) {
  const access = session?.preferences?.sandbox || defaults?.sandbox;
  if (session?.scope) return 'plan';
  if (session?.workflow?.teamSlot?.mode) return session.workflow.teamSlot.mode;
  if (session?.workflow) return draftMode || (session.workflow.kind === 'task' ? 'build' : 'plan');
  if (access === 'read-only') return 'plan';
  if (session?.preferences?.sandbox === 'workspace-write' || session?.preferences?.sandbox === 'danger-full-access') return 'build';
  if (draftMode) return draftMode;
  if (access === 'workspace-write' || access === 'danger-full-access') return 'build';
  return !session || session.defaultProjectMode === 'build' ? 'build' : 'plan';
}
