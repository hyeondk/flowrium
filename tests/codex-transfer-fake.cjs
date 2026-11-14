const fs=require('node:fs'),readline=require('node:readline'),crypto=require('node:crypto');
const file=process.env.FLOWRIUM_CODEX_TRANSFER_FIXTURE;
if(!file)throw Error('합성 대화 자료가 필요합니다.');
const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
function load(){return JSON.parse(fs.readFileSync(file,'utf8'));}
function save(value){fs.writeFileSync(file,JSON.stringify(value));}
function thread(data){return {id:data.threadId,name:data.title,cwd:data.folder,createdAt:data.createdAt,updatedAt:data.updatedAt,source:'appServer',...(data.rolloutPath?{path:data.rolloutPath}:{}),modelProvider:'openai',model:'test-model',reasoningEffort:'medium',status:{type:'notLoaded'},ephemeral:false};}
readline.createInterface({input:process.stdin}).on('line',line=>{let input;try{input=JSON.parse(line);}catch{return;}const {id,method,params={}}=input;const data=load();const reply=result=>write({id,result});
 if(method==='initialize')return reply({userAgent:'합성 연결 검사'});
 if(method==='initialized')return;
 if(method==='account/read')return reply({account:{type:'chatgpt',id:'synthetic-transfer-owner',email:'synthetic@example.invalid'}});
 if(method==='config/read')return reply({config:{model:'test-model'}});
 if(method==='model/list')return reply({data:[{id:'test-model',model:'test-model',displayName:'합성 검증 모델',supportedReasoningEfforts:[{reasoningEffort:'medium'}],defaultReasoningEffort:'medium',isDefault:true}],nextCursor:null});
 if(method==='account/rateLimits/read')return reply({rateLimits:{}});
 if(method==='thread/list')return reply({data:params.archived?[]:[thread(data)],nextCursor:null});
 if(method==='thread/read'||method==='thread/resume')return reply({thread:{...thread(data),...(params.includeTurns?{turns:data.turns}:{})},model:'test-model'});
 if(method==='thread/turns/list')return reply({data:data.turns,nextCursor:null});
 if(method==='thread/items/list')return reply({data:data.turns.filter(t=>!params.turnId||t.id===params.turnId).flatMap(t=>t.items.map(item=>({item}))),nextCursor:null});
 if(method==='turn/start'){
  const text=(params.input||[]).filter(part=>part.type==='text').map(part=>part.text).join('\n'),turnId=crypto.randomUUID(),userId=crypto.randomUUID(),answerId=crypto.randomUUID();
  const stamp=Math.floor(Date.now()/1000),turn={id:turnId,status:'completed',startedAt:stamp,completedAt:stamp,items:[{type:'userMessage',id:userId,content:[{type:'text',text}]},{type:'agentMessage',id:answerId,text:'연결한 대화에서 받은 합성 응답',phase:'final_answer'}]};
  data.turns.push(turn);data.updatedAt=Math.max(stamp,data.updatedAt+1);data.lastInput=params.input;save(data);reply({turn:{id:turnId,status:'inProgress'}});
  setTimeout(()=>{write({method:'turn/started',params:{threadId:data.threadId,turn:{id:turnId,status:'inProgress'}}});write({method:'item/started',params:{threadId:data.threadId,turnId,item:{type:'agentMessage',id:answerId,text:''}}});write({method:'item/agentMessage/delta',params:{threadId:data.threadId,turnId,itemId:answerId,delta:'연결한 대화에서 받은 합성 응답'}});write({method:'item/completed',params:{threadId:data.threadId,turnId,item:turn.items[1]}});write({method:'turn/completed',params:{threadId:data.threadId,turn}});},80);return;
 }
 if(id!==undefined)reply({});
});
