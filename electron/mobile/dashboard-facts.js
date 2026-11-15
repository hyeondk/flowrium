function dayKey(day) {
  return [day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-');
}
export function dashboardFacts(cards, now=new Date()) {
  const today=dayKey(now), due=[],goals=[],phases={};
  for(const {project,details} of cards){
    if(!details)continue;
    const phase=details.archivedAt?'완료':details.kickoff?.phase||'진행';
    phases[phase]=(phases[phase]||0)+1;
    if(details.archivedAt)continue;
    if(details.dueDate && details.dueDate<=today)due.push({projectId:project.id,due:details.dueDate});
    for(const g of details.periodGoals||[]){
      if(g.done || g.carriedTo)continue;
      const endOfWeek=new Date(g.key+'T12:00:00');
      endOfWeek.setDate(endOfWeek.getDate()+6);
      const current=g.due?g.due<=today:g.period==='month'?g.key===today.slice(0,7):g.key<=today && today<=dayKey(endOfWeek);
      if(current)goals.push({projectId:project.id,text:g.text,due:g.due,current:g.current,target:g.target});
    }
  }
  return {today,due,goals,phases};
}
