const copy=value=>structuredClone(value);
const {interleaveLocalMessages}=require('./mobile/live-turn.js');
const isLocalClaude=message=>message.provider==='claude';

function assertNoClaudeSourceIdCollision(previous,incoming) {
 const localIds=new Set(previous.filter(isLocalClaude).map(message=>message.id));
 if(localIds.size && incoming.some(message=>localIds.has(message.id))) {
  throw Error('Claude와 Codex 메시지 식별자가 겹쳐 동기화를 중단했습니다. 기존 대화를 보존했습니다.');
 }
}

function codexMergeCandidates(previous,incoming) {
 assertNoClaudeSourceIdCollision(previous,incoming);
 return previous.filter(message=>!isLocalClaude(message));
}

function exchanges(messages) {
 const rows=[];
 for(const message of messages) {
  if(message.role==='user')rows.push({user:message,answers:[]});
  else if(message.role==='assistant' && rows.length)rows.at(-1).answers.push(message);
 }
 return rows;
}
function matchExchanges(local,incoming,matches) {
 const remote=exchanges(incoming), own=exchanges(local);
 const soleLocalAnswer=local.filter(message=>message.role==='assistant');
 const soleRemoteAnswer=incoming.filter(message=>message.role==='assistant');
 for(const {user,answers} of own) {
  let index=remote.findIndex(row=>row.user.id===user.id || row.user.text===user.text);
  if(index<0)index=0; // Older clients appended instructions to the original prompt.
  const row=remote.splice(index,1)[0];
  if(!row)continue;
  if(row.user.id!==user.id || require('./chat-long-request.cjs').retainsRequest(user,row.user))matches.set(row.user.id,user);
  if(answers.length!==1 || !row.answers.length)continue;
  const answer=answers[0];
  if(row.answers.some(part=>part.id===answer.id))continue;
  for(const part of row.answers.slice(0,-1))matches.set(part.id,null);
  matches.set(row.answers.at(-1).id,{...answer,text:row.answers.map(part=>part.text).join('\n\n')});
 }
 // Some servers record a second input before finishing the original partial answer.
 if(own.length && soleLocalAnswer.length===1 && soleRemoteAnswer.length===1) {
  const [before]=soleLocalAnswer,[after]=soleRemoteAnswer;
  if(after.id!==before.id && !matches.has(after.id))matches.set(after.id,{...before,text:after.text});
 }
}

// A reader can publish an answer before it includes the local user's steered
// message. Retain that input before its next matched item in the same turn.
function retainLocalOrder(source, previous, unmatched) {
 if (!unmatched.length) return source;
 const sourceIds=new Set(source.map(message=>message.id));
 const unplaced=new Map(unmatched.map(message=>[message.id,message]));
 const nextByTurn=new Map(), before=new Map();
 for (let index=previous.length-1;index>=0;index--) {
  const message=previous[index], {id,turnId}=message;
  if (!turnId || isLocalClaude(message)) continue;
  if (sourceIds.has(id)) nextByTurn.set(turnId,id);
  else if (message.role==='user' && unplaced.has(id) && nextByTurn.has(turnId)) {
   const next=nextByTurn.get(turnId);
   if (!before.has(next)) before.set(next,[]);
   before.get(next).push(unplaced.get(id));
   unplaced.delete(id);
  }
 }
 const ordered=before.size?source.flatMap(message=>[...(before.get(message.id)||[]).reverse(),message]):source;
 const retained=[...unplaced.values()];
 const interleaved=interleaveLocalMessages(ordered,retained);
 // Timestamps locate the local entries among remote turns, but a clock change
 // must not put an assistant reply before its saved Claude input.
 const claude=retained.filter(isLocalClaude);
 if(claude.length<2)return interleaved;
 let nextClaude=0;
 return interleaved.map(message=>isLocalClaude(message)&&unplaced.has(message.id)?claude[nextClaude++]:message);
}

function mergeMessages(previous,incoming){
 const candidates=codexMergeCandidates(previous,incoming);
 const byId=new Map(candidates.map(message=>[message.id,message])),byGroup=new Map(),previousTurns=new Map(),incomingGroups=new Map();let latestTurn;
 for(const message of candidates){if(message.role==='user'&&message.turnId)latestTurn=message.turnId;const turn=message.turnId||(message.role==='assistant'?latestTurn:undefined);if(!turn)continue;const key=turn+'|'+message.role;const rows=byGroup.get(key)||[];rows.push(message);byGroup.set(key,rows);if(!previousTurns.has(turn))previousTurns.set(turn,[]);previousTurns.get(turn).push(message);}
 for(const message of incoming){const key=message.turnId+'|'+message.role,rows=incomingGroups.get(key)||[];rows.push(message);incomingGroups.set(key,rows);}
 const used=new Set(),suppressed=new Set(),out=[],steered=new Map(),multiUserTurns=new Set();
 const turns=Map.groupBy(incoming,message=>message.turnId);
 for(const [turn,source] of turns) {
  if(!turn || source.filter(m=>m.role==='user').length<2)continue;
  multiUserTurns.add(turn);
  matchExchanges(previousTurns.get(turn)||[],source,steered);
 }
 for(const message of incoming){if(suppressed.has(message.id))continue;
  if(steered.has(message.id)){const matched=steered.get(message.id);if(matched){used.add(matched.id);out.push(copy(matched));}continue;}
  let original=byId.get(message.id),next=message;const key=message.turnId+'|'+message.role,group=byGroup.get(key)||[],sources=incomingGroups.get(key)||[];
  if(!original&&message.turnId&&!multiUserTurns.has(message.turnId)&&group.length===1&&!used.has(group[0].id)){
   original=group[0];
   if(message.role==='assistant'&&sources.length>1){next={...message,text:sources.map(m=>m.text).join('\n\n')};for(const row of sources.slice(1))suppressed.add(row.id);}
  }
  if(!original){const matches=candidates.filter(old=>!used.has(old.id)&&old.role===message.role&&old.text===message.text);if(matches.length===1)original=matches[0];}
  if(original){used.add(original.id);out.push({...copy(original), ...copy(next),...(require('./chat-long-request.cjs').retainsRequest(original,next) && {text:original.text}),id:original.id,createdAt:original.createdAt,...(original.reaction?{reaction:original.reaction}:{}),...(!next.attachments&&original.attachments?{attachments:copy(original.attachments)}:{})});}
  else out.push(copy(next));
 }
 // 참조 중인 과거 메시지나 로컬 안내를 삭제하지 않습니다. 이전 원문 사본도 별도로 남깁니다.
 const sourceIds=new Set(out.map(row=>row.id));
 const local=previous.filter(message=>!used.has(message.id)&&!sourceIds.has(message.id)).map(copy);
 return retainLocalOrder(out,previous,local);
}

function restoreLinkedMessageOrder(session) {
 const link=session.codexLink;
 if(link?.mode!=='linked' || !session.messages.some(message=>isLocalClaude(message)||!message.turnId))return;
 const sourceIds=new Set(link.sourceMessageIds);
 const source=[],local=[];
 for(const message of session.messages) {
  if(!isLocalClaude(message) && (message.turnId || sourceIds.has(message.id)))source.push(message);
  else local.push(message);
 }
 if(local.length)session.messages=retainLocalOrder(source,session.messages,local);
}
module.exports={mergeMessages,matchExchanges,restoreLinkedMessageOrder,retainLocalOrder,codexMergeCandidates,isLocalClaude,assertNoClaudeSourceIdCollision};
