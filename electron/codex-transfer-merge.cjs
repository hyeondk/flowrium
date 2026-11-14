const copy=value=>structuredClone(value);
function mergeMessages(previous,incoming){
 const byId=new Map(previous.map(message=>[message.id,message])),byGroup=new Map(),incomingGroups=new Map();let latestTurn;
 for(const message of previous){if(message.role==='user'&&message.turnId)latestTurn=message.turnId;const turn=message.turnId||(message.role==='assistant'?latestTurn:undefined);if(!turn)continue;const key=turn+'|'+message.role;const rows=byGroup.get(key)||[];rows.push(message);byGroup.set(key,rows);}
 for(const message of incoming){const key=message.turnId+'|'+message.role,rows=incomingGroups.get(key)||[];rows.push(message);incomingGroups.set(key,rows);}
 const used=new Set(),suppressed=new Set(),out=[];
 for(const message of incoming){if(suppressed.has(message.id))continue;let original=byId.get(message.id),next=message;const key=message.turnId+'|'+message.role,group=byGroup.get(key)||[],sources=incomingGroups.get(key)||[];
  if(!original&&message.turnId&&group.length===1&&!used.has(group[0].id)){
   original=group[0];
   if(message.role==='assistant'&&sources.length>1){next={...message,text:sources.map(m=>m.text).join('\n\n')};for(const row of sources.slice(1))suppressed.add(row.id);}
  }
  if(!original){const matches=previous.filter(old=>!used.has(old.id)&&old.role===message.role&&old.text===message.text);if(matches.length===1)original=matches[0];}
  if(original){used.add(original.id);out.push({...copy(original),...copy(next),id:original.id,createdAt:original.createdAt,...(original.reaction?{reaction:original.reaction}:{}),...(!next.attachments&&original.attachments?{attachments:copy(original.attachments)}:{})});}
  else out.push(copy(next));
 }
 // 참조 중인 과거 메시지나 로컬 안내를 삭제하지 않습니다. 이전 원문 사본도 별도로 남깁니다.
 for(const message of previous)if(!used.has(message.id)&&!out.some(row=>row.id===message.id))out.push(copy(message));
 return out;
}
module.exports={mergeMessages};
