const str=description=>({type:'string',description});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const specs=[
  {name:'flowrium_project_read',description:'현재 프로젝트의 목표 / 체크리스트 / 저장소 / 반복 일정을 읽습니다. 수정 전 최신 revision을 확인합니다.',inputSchema:object({})},
  {name:'flowrium_project_goal',description:'사용자가 요청한 목표 추가 / 완료 표시 / 수치 진척 / 다음 주 이월을 저장합니다. 확인한 실적만 반영하고 계획을 완료로 꾸미지 마세요. 최신 read에서 받은 revision을 사용합니다.',inputSchema:object({action:{type:'string',enum:['add','check','progress','carry']},revision:str('read에서 확인한 개정. 최초이면 빈 문자열'),id:str('기존 목표 id. 새 목표는 빈 문자열'),text:str('새 목표 문장'),period:{type:'string',enum:['week','month']},key:str('주간은 월요일 YYYY-MM-DD, 월간은 YYYY-MM'),parent:str('연결할 월간 목표 id 또는 빈 문자열'),target:{type:['number','null'],description:'수치 목표. 없으면 null'},current:{type:'number',minimum:0},done:{type:'boolean'},due:str('목표일 YYYY-MM-DD 또는 빈 문자열')})},
  {name:'flowrium_project_note',description:'현재 프로젝트의 규칙 / 디자인 / 회의록 문서를 찾거나 읽고, 사용자가 요청한 완성 문서를 새 파일로 저장합니다. 기존 파일을 덮어쓰지 않습니다.',inputSchema:object({action:{type:'string',enum:['list','read','create']},kind:{type:'string',enum:['rules','design','meetings']},path:str('목록에서 받은 경로. 새 문서는 빈 문자열'),title:str('새 문서 제목'),body:str('직접 작성한 완성 마크다운 본문')})},
  {name:'flowrium_project_artifact_create',description:'AI가 작성한 완성 결과를 현재 업무 대화에 연결한 산출물 파일로 저장합니다. HTML은 실제 화면을 보존해 PDF로 변환하고 section.slide 발표자료는 PPTX도 생성합니다. 외부 스크립트와 원격 추적 콘텐츠는 넣지 마세요.',inputSchema:object({title:str('문서 제목'),format:{type:'string',enum:['md','html']},body:str('완성 마크다운 또는 HTML 본문')})},
];
function createProjectTools({handlers,store}){
  const names=new Set(specs.map(s=>s.name));
  async function call(method,...args){const handler=handlers.get(method);if(!handler)throw Error('프로젝트 작성 도구를 사용할 수 없습니다.');return handler(...args);}
  return {definitions:specs,handles:name=>names.has(name),async call({sessionId,name,arguments:input}){
    const session=store.session(sessionId),projectId=session.projectId,spec=specs.find(s=>s.name===name);
    if(!spec||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(spec.inputSchema.properties,k)))throw Error('프로젝트 AI 도구 입력을 확인해 주세요.');
    if(name==='flowrium_project_read')return call('readProjectDetails',projectId);
    if(name==='flowrium_project_goal'){
      const change={add:{action:'goal-add',period:input.period,key:input.key,text:input.text,...(input.parent?{parent:input.parent}:{}),...(input.target!==null?{target:input.target}:{}),...(input.due?{due:input.due}:{})},check:{action:'goal-check',id:input.id,done:input.done},progress:{action:'goal-progress',id:input.id,current:input.current},carry:{action:'goal-carry',id:input.id,key:input.key}}[input.action];
      if(!change)throw Error('목표 작성 동작을 확인해 주세요.');return call('updateProjectDetails',projectId,input.revision||null,change);
    }
    if(name==='flowrium_project_note'){
      if(input.action==='list')return call('listProjectNotes',projectId,input.kind);
      if(input.action==='read')return call('readProjectNote',projectId,input.kind,input.path);
      if(input.action==='create')return call('createProjectNote',projectId,input.kind,input.title,input.body);
      throw Error('프로젝트 문서 동작을 확인해 주세요.');
    }
    return call('artifactAction',projectId,{action:'create',sessionId,title:input.title,format:input.format,body:input.body});
  }};
}
module.exports={createProjectTools,specs};
