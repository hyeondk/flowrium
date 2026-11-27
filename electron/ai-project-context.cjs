const { boundProvider } = require('./ai-provider.cjs');

async function projectContext(controller,session) {
  if(session.scope)return '';
  const {store}=controller;
  await store.requireProjectTrust(session.projectId);
  const project=store.project(session.projectId);
  const details=await require('./project-details.cjs').readDetails(store,project.id);
  const conversations=store.state.sessions.filter(row=>row.id!==session.id && row.projectId===project.id)
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,10);
  const goals=(details.periodGoals||[]).filter(goal=>!goal.done).slice(-12).map(goal=>goal.text);
  const items=(details.checklist||[]).filter(item=>!item.done).slice(0,12).map(item=>item.text);
  return JSON.stringify({
    project:project.name, goal:details.goal, dueDate:details.dueDate, goals, items,
    recent:conversations.map(row=>{
      const preview=controller.codexTransfer?.liveTurn?.(row);
      const messages=preview ? require('./mobile/live-turn.js').withLiveTurn(row.messages,preview.turnId,preview.rows) : row.messages;
      return {title:row.title,provider:boundProvider(row)||row.preferences?.provider||'codex',
        updatedAt:row.updatedAt,running:controller.runs.has(row.id)||preview?.running===true,status:row.workflow?.status,
        recentMessages:messages.filter(message=>['user','assistant'].includes(message.role)&&!message.progressCommentary)
          .slice(-2).map(({role,text,provider})=>({role,text:text.slice(-450),provider:provider||'codex'})),
      };
    }),
  });
}

module.exports={projectContext};
