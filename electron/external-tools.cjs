const string = description => ({ type: 'string', description });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const specs = [
  { name: 'flowrium_mac_read', description: '사용자가 연결한 맥 기본 메일과 캘린더를 읽습니다. 맥에서만 사용하며 읽기 권한이 필요합니다.', inputSchema: object({ action:{type:'string',enum:['calendars','events','mails','mail']}, calendarId:string('지정 캘린더 ID, 전체는 빈 문자열'), id:string('메일 식별자'), query:string('검색어'), from:string('일정 시작 ISO'), to:string('일정 종료 ISO') }) },
  { name: 'flowrium_mac_calendar_propose', description: '맥 캘린더 변경을 사용자 결정함에 검토 요청합니다. 승인 전에 변경하지 않습니다.', inputSchema: object({ action:{type:'string',enum:['create','update','delete']}, calendarId:string('대상 캘린더'), eventId:string('기존 일정 ID 또는 빈 문자열'), summary:string('제목'), start:string('시작 ISO'), end:string('종료 ISO'), description:string('설명'), location:string('장소') }) },
];
function createExternalTools({ handlers, workflow, store }) {
  const names = new Set(specs.map(s=>s.name));
  const call = async (name,...args) => {
    const handler = handlers.get(name);
    if (!handler) throw Error('이 외부 자료 기능을 사용할 수 없습니다. 설정에서 연결 상태를 확인해 주세요.');
    return handler(...args);
  };
  return {
    definitions: specs,
    handles: name => names.has(name),
    async call({ sessionId, name, arguments: input, callId }) {
      store.session(sessionId);
      const spec = specs.find(s=>s.name===name);
      if (!spec || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key=>!Object.hasOwn(spec.inputSchema.properties,key))) throw Error('외부 자료 도구 입력을 확인해 주세요.');
      for (const key of spec.inputSchema.required) if (typeof input[key] !== 'string' || (spec.inputSchema.properties[key].enum && !spec.inputSchema.properties[key].enum.includes(input[key]))) throw Error('외부 자료 도구의 '+key+' 값을 확인해 주세요.');
      if (name==='flowrium_mac_read') return call('macPim',{...input,from:input.from||undefined,to:input.to||undefined});
      const preview = await call('prepareMacEvent',input);
      return workflow.proposeExternal({sessionId,title:'맥'+' 일정 '+({create:'등록',update:'수정',delete:'삭제'}[input.action]||'변경')+' / '+(preview.event?.title||preview.previous?.title||input.summary),
        method:'commitMacEvent',args:[preview.id],preview,...(typeof callId==='string'&&callId.length<=200?{key:`tool:${sessionId}:${callId}`}:{})});
    },
  };
}
module.exports={createExternalTools,specs};
