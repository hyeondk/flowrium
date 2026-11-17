// Parse display-only metadata outside Markdown code and quotes. Keep the stored message intact.
const marker = ':codex-file-citation';
const imageExtension = /\.(?:png|jpe?g|gif|webp)$/i;
function attributes(body) {
  try { const parsed=JSON.parse('{'+body+'}'); if (parsed && typeof parsed==='object') return parsed; } catch {}
  const values=Object.create(null);
  for(const match of body.matchAll(/([\w-]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s}]+))/g)) {
    values[match[1]]=(match[2]??match[3]??match[4]).replace(/\\(["'\\])/g,'$1');
  }
  return values;
}
function terminator(line,start) {
  let quote='',escaped=false,depth=1;
  for(let i=start;i<line.length;i++) {
    const c=line[i];
    if (escaped) {escaped=false;continue;}
    if (quote) {if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}
    if(c==='"'||c==="'")quote=c;
    else if(c==='{')depth++;
    else if(c==='}'&&--depth===0)return i;
  }
  return -1;
}
function parts(text, role, streaming) {
  if(role!=='assistant'||(!streaming && !text.includes(marker)))return {pieces:[{text}],references:[]};
  const pieces=[],references=[];
  let fence='',inline='',offset=0;
  for(const line of text.split(/(?<=\n)/)) {
    const fm=/^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
    if(fence || fm || /^(?: {4}|\t|\s*>)/.test(line)) {
      if(fm && !inline) {
        if(!fence) fence=fm[1];
        else if(fm[1].startsWith(fence)&&!fm[2].trim())fence='';
      }
      pieces.push({text:line});offset+=line.length;continue;
    }
    let start=0,i=0;
    const flush=end=>{if(end>start)pieces.push({text:line.slice(start,end),prose:!inline});};
    while(i<line.length) {
      if(line[i]==='\\') {i+=2;continue;}
      if(line[i]==='`') {
        let end=i+1;while(line[end]==='`')end++;
        const delim=line.slice(i,end);
        if(!inline || inline===delim) {
          flush(i);pieces.push({text:delim});inline=inline?'':delim;start=end;
        }
        i=end;continue;
      }
      if(inline || line[i]!==':') {i++;continue;}
      if(line.startsWith(marker+'{',i)) {
        const from=i+marker.length+1, end=terminator(line,from);
        if(end<0 && !streaming){i++;continue;}
        flush(i);
        if(end<0) {start=i=line.length;continue;}
        const meta=attributes(line.slice(from,end));
        const path=[meta.path,meta.file,meta.filePath,meta.file_path,meta.href,meta.filename,meta.name].find(v=>typeof v==='string'&&v.length&&v.length<=4096)||'';
        const attachmentId=meta.attachmentId || meta.attachment_id || '';
        const artifactId=meta.artifactId || meta.artifact_id || '';
        if(path || attachmentId || artifactId) references.push({path,attachmentId,artifactId,name:path.split(/[\\/]/).pop()||'첨부 파일',image:imageExtension.test(path)});
        start=i=end+1;continue;
      }
      if(streaming && offset+line.length===text.length && (marker+'{').startsWith(line.slice(i))) {
        flush(i);start=i=line.length;continue;
      }
      i++;
    }
    flush(line.length);offset+=line.length;
  }
  return {pieces,references};
}
export function presentCitations(text,role='assistant',streaming=false) {
  const {pieces,references}=parts(text,role,streaming);
  const groups=[],byKey=new Map();
  const keyFor=ref=>ref.artifactId?'artifact:'+ref.artifactId:ref.attachmentId?'attachment:'+ref.attachmentId:'path:'+ref.path;
  references.forEach((ref,index)=>{
    const key=keyFor(ref);
    let group=byKey.get(key);
    if(!group){group={key,files:[]};groups.push(group);byKey.set(key,group);}
    if(!group.files.some(file=>file.path===ref.path && file.attachmentId===ref.attachmentId))group.files.push({...ref,index});
  });
  // When both presentations point to the same file, the single file card owns its preview.
  const targets=new Set(references.map(ref=>ref.path));
  const rendered=pieces.map(p=>p.prose&&targets.size?p.text.replace(/(!?)\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^()\s]+))\)/g,(whole,image,label,a,b)=>{
    return targets.has(a||b)?(image?'':label.includes('/')||label.includes('\\')?'':label):whole;
  }):p.text).join('');
  return {text:rendered,references,groups};
}
