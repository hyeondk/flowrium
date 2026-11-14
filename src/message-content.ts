export type MessageContentBlock =
  | {kind:'markdown';text:string}
  | {kind:'writing';text:string;raw:string}
  | {kind:'literal';raw:string}
  | {kind:'log';raw:string;pending?:boolean;failed?:boolean};
const opening=/^ {0,3}:::writing(?:\{[^\r\n]*\})?[\t ]*$/;
const closing=/^ {0,3}:::[\t ]*$/;
function fence(line:string){return /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);}
function endFence(line:string,current:string){const match=/^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(line);return !!match&&match[1][0]===current[0]&&match[1].length>=current.length;}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function mcpResult(value:unknown){
  if(!object(value))return false;
  return Array.isArray(value.content)&&value.content.every(item=>object(item)&&typeof item.type==='string')&&
    (typeof value.isError==='boolean'||Object.hasOwn(value,'structuredContent')||Object.hasOwn(value,'_meta'));
}
/** 전달 형식만 판별한다. 중첩 text/messages를 답변으로 꺼내거나 다시 해석하지 않는다. */
export function isToolResult(value:unknown,depth=0):boolean{
  if(depth>8)return false;
  if(Array.isArray(value))return value.length>0&&value.length<=1000&&value.every(item=>isToolResult(item,depth+1));
  if(!object(value))return false;
  if(mcpResult(value))return true;
  if(value.type==='function_call_output'&&typeof value.call_id==='string'&&Object.hasOwn(value,'output'))return true;
  if(value.role==='tool'&&typeof value.tool_call_id==='string'&&Object.hasOwn(value,'content'))return true;
  if(Array.isArray(value.contentItems)&&typeof value.success==='boolean')return true;
  if(Object.hasOwn(value,'result')&&mcpResult(value.result))return true;
  const type=String(value.type||'');
  if(['mcpToolCall','dynamicToolCall','mcp_tool_call','tool_result'].includes(type)&&
    (Object.hasOwn(value,'result')||Object.hasOwn(value,'output')||Object.hasOwn(value,'error')))return true;
  return Object.hasOwn(value,'result')&&typeof value.durationMs==='number'&&
    typeof value.startedAtMs==='number'&&typeof value.completedAtMs==='number'&&
    (typeof value.state==='string'||typeof value.status==='string');
}
function parse(text:string):unknown{try{return JSON.parse(text)}catch{return undefined}}
function failed(value:unknown){return object(value)&&(value.isError===true||value.success===false||value.state==='failed'||value.status==='failed'||(Object.hasOwn(value,'error')&&value.error!==null)||mcpFailed(value.result));}
function mcpFailed(value:unknown){return object(value)&&value.isError===true;}
function partialToolResult(text:string){return /"(?:type|role)"\s*:\s*"(?:mcpToolCall|dynamicToolCall|mcp_tool_call|tool_result|function_call_output|tool)"/.test(text.slice(0,1200))||/^\s*\{\s*"content(?:Items)?"\s*:\s*\[/.test(text);}
/** JSON 문자열 안의 괄호와 이스케이프는 구조 경계로 취급하지 않는다. */
function jsonEnd(text:string,start:number){
  const stack:string[]=[];let quoted=false,escape=false;
  for(let i=start;i<text.length;i++){
    const c=text[i];
    if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;continue;}
    if(c==='{'||c==='[')stack.push(c);
    else if(c==='}'||c===']'){
      const previous=stack.pop();if(!previous||(c==='}'&&previous!=='{')||(c===']'&&previous!=='['))return -1;
      if(!stack.length)return i+1;
    }
  }
  return -1;
}
function lines(text:string){const result:{start:number;end:number;text:string}[]=[];let start=0;
  while(start<text.length){const next=text.indexOf('\n',start),end=next===-1?text.length:next+1;result.push({start,end,text:text.slice(start,next===-1?end:next).replace(/\r$/,'')});start=end;}return result;
}
export function messageContent(text:string,role:'user'|'assistant'|'system',streaming=false):MessageContentBlock[]{
  if(role==='system')return [{kind:'log',raw:text,failed:/^(?:작업을 완료하지 못했습니다|답변은 보존했지만 산출물)/.test(text)}];
  if(role==='user'||!text)return [{kind:'markdown',text}];
  if(text.trimStart().startsWith('"')){
    const encoded=parse(text.trim()),decoded=typeof encoded==='string'?parse(encoded):undefined;
    if(isToolResult(decoded))return [{kind:'log',raw:text,failed:failed(decoded)}];
  }
  const rows=lines(text),blocks:MessageContentBlock[]=[];let from=0,index=0,code='';
  function prose(to:number){if(to>from)blocks.push({kind:'markdown',text:text.slice(from,to)});}
  while(index<rows.length){
    const row=rows[index];
    if(code){if(endFence(row.text,code))code='';index++;continue;}
    const codeStart=fence(row.text);
    if(codeStart){code=codeStart[1];index++;continue;}
    if(streaming&&index===rows.length-1&&/^ {0,3}:::writing\{[^}\r\n]*$/.test(row.text)){
      prose(row.start);blocks.push({kind:'writing',text:'',raw:text.slice(row.start)});from=text.length;index=rows.length;continue;
    }
    if(opening.test(row.text)){
      let end=index+1,innerCode='';
      for(;end<rows.length;end++){
        const line=rows[end].text;
        if(innerCode){if(endFence(line,innerCode))innerCode='';continue;}
        const current=fence(line);if(current){innerCode=current[1];continue;}
        if(closing.test(line))break;
      }
      // 닫힘이 없는 답변도 작성 중인 본문은 표시하되 원문은 별도로 보존한다.
      const bodyStart=row.end,bodyEnd=end<rows.length?rows[end].start:text.length,rawEnd=end<rows.length?rows[end].end:text.length;
      prose(row.start);blocks.push({kind:'writing',text:text.slice(bodyStart,bodyEnd),raw:text.slice(row.start,rawEnd)});from=rawEnd;index=end+1;continue;
    }
    const trimmed=row.text.trimStart();
    if((trimmed.startsWith('{')||trimmed.startsWith('['))&&row.text.length-trimmed.length<=3){
      const start=row.start+row.text.indexOf(trimmed),end=jsonEnd(text,start);
      const lineEnd=end<0?-1:text.indexOf('\n',end),tail=end<0?'':text.slice(end,lineEnd===-1?text.length:lineEnd);
      const value=end<0?undefined:parse(text.slice(start,end));
      if(end>=0&&!tail.trim()&&isToolResult(value)){
        const rawEnd=lineEnd===-1?text.length:lineEnd+1;prose(row.start);blocks.push({kind:'log',raw:text.slice(row.start,rawEnd),failed:failed(value)});from=rawEnd;
        while(index<rows.length&&rows[index].start<rawEnd)index++;continue;
      }
      if(end>=0&&!tail.trim()&&value!==undefined){
        const rawEnd=lineEnd===-1?text.length:lineEnd+1;prose(row.start);blocks.push({kind:'literal',raw:text.slice(row.start,rawEnd)});from=rawEnd;
        while(index<rows.length&&rows[index].start<rawEnd)index++;continue;
      }
      if(end<0&&streaming&&partialToolResult(text.slice(start))){prose(row.start);blocks.push({kind:'log',raw:text.slice(row.start),pending:true});from=text.length;index=rows.length;continue;}
      // 완결되지 않은 임의 JSON을 반복 탐색하지 않는다.
      if(end<0){index=rows.length;break;}
    }
    index++;
  }
  prose(text.length);return blocks.length?blocks:[{kind:'markdown',text}];
}
const sensitive=/(?:authorization|(?:access|refresh|id)?token|apikey|clientsecret|password|passwd|secret|cookie|credentials?|privatekey|sessionkey|connectionkey)$/i;
function secretName(key:string){return sensitive.test(key.replace(/[-_\s]/g,''));}
function mask(text:string){return text.replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [가림]').replace(/\bsk-[A-Za-z0-9_-]{12,}/g,'[키 가림]').replace(/([?&#](?:key|token|access_token|refresh_token)=)[^\s"'&#]+/gi,'$1[가림]');}
/** 접힘을 연 뒤에도 요약은 제한하고, 정확한 원문은 별도 요청에서만 보여 준다. */
export function safeLogPreview(raw:string,limit=6000):string{
  const value=parse(raw);let count=0;
  function clean(v:unknown,depth:number):unknown{
    if(++count>500)return '[이하 생략]';
    if(depth>8)return '[중첩 내용 생략]';
    if(typeof v==='string'){
      const nested=v.length<=200000?parse(v):undefined;
      if(nested!==undefined&&typeof nested==='object')return JSON.stringify(clean(nested,depth+1));
      return mask(v.length>1200?v.slice(0,1200)+'\n[이하 생략]':v);
    }
    if(Array.isArray(v))return v.slice(0,50).map(item=>clean(item,depth+1));
    if(object(v))return Object.fromEntries(Object.entries(v).slice(0,80).map(([key,item])=>[key,secretName(key)?'[가림]':clean(item,depth+1)]));
    return v;
  }
  const text=value!==undefined?JSON.stringify(clean(value,0),null,2):mask(raw)
    .replace(/\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret)\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi,'[민감값 가림]')
    .replace(/\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret)\s*[:=]\s*[^\s,;]+/gi,'[민감값 가림]');
  return text.length>limit?text.slice(0,limit)+'\n[미리보기 생략 / 원문 보기에서 확인]':text;
}

/** 읽기는 정상 답변만 사용한다. 원문 저장 / 복사 문자열은 이 함수로 바꾸지 않는다. */
export function speakableMessage(text:string,role:'user'|'assistant'|'system'='assistant'):string{
  if(role!=='assistant')return '';
  const body=messageContent(text,'assistant').flatMap(block=>block.kind==='markdown'||block.kind==='writing'?[block.text]:[]).join('\n\n');
  let code='';const spoken:string[]=[];
  for(const row of lines(body)){
    if(code){if(endFence(row.text,code))code='';continue;}
    const start=fence(row.text);if(start){code=start[1];continue;}
    if(/^(?: {4}|\t)/.test(row.text))continue;
    spoken.push(row.text);
  }
  return spoken.join('\n')
    .replace(/:::writing(?:\{[^}\r\n]*\})?/g,'').replace(/^\s*:::\s*$/gm,'')
    .replace(/!\[([^\]]*)\]\([^\n)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^\n)]*\)/g,'$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm,'')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~/g,(_all,a,b,c)=>a||b||c)
    .replace(/`([^`\n]+)`/g,'$1').replace(/<[^>\n]+>/g,'').replace(/\n{3,}/g,'\n\n').trim();
}

/** 목록 미리보기에서도 전달 JSON과 작성 메타데이터를 본문처럼 노출하지 않는다. */
export function messagePreview(text:string,role:'user'|'assistant'|'system',limit=90):string{
  if(role==='user')return text.slice(0,limit);
  if(role==='system')return '작업 상태';
  const start=text.trimStart();
  if(/^(?:[\[{]|"\s*[\[{])/.test(start))return '구조화된 응답 / 대화에서 확인하세요.';
  const parts=messageContent(text.slice(0,8000),'assistant',true).flatMap(block=>
    block.kind==='markdown'||block.kind==='writing'?[block.text]:[]);
  const result=speakableMessage(parts.join('\n\n'),'assistant').replace(/\s+/g,' ').trim();
  return result?result.slice(0,limit):text?'답변의 자세한 내용은 대화에서 확인하세요.':'';
}
