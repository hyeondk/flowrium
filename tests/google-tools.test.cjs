const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path');
const {registerIntegrations}=require('../electron/integrations.cjs');
const {parseLyrics,registerLyrics}=require('../electron/lyrics.cjs');
async function fixture(t,fetchImpl){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-google-tools-')),api={};
 const secretStorage={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
 await fs.writeFile(path.join(dir,'google.enc'),JSON.stringify({clientId:'test.apps.googleusercontent.com',refreshToken:'fixture',accessToken:'fixture',expiresAt:Date.now()+3600000,scopes:['https://www.googleapis.com/auth/calendar.events']}));
 const runtime=registerIntegrations((n,f)=>api[n]=f,{project:()=>{throw Error('실제 프로젝트 접근 금지');}},{directory:dir,secretStorage,openExternal:async()=>{},fetchImpl});
 t.after(async()=>{runtime.shutdown();await fs.rm(dir,{recursive:true,force:true});});
 return{api,runtime};
}
const calendar={id:'owner@example.test',summary:'업무',primary:true,accessRole:'owner'};
const event={id:'event1',summary:'기존 제목',etag:'"one"',start:{dateTime:'2026-11-13T09:00:00+09:00'},end:{dateTime:'2026-11-13T10:00:00+09:00'},description:'보존할 본문',location:'회의실',attendees:[{email:'colleague@example.test'}]};
test('일정 검토 전에는 쓰지 않고 확인 토큰으로 정확한 개정만 한 번 변경',async t=>{
 const writes=[];
 const{api}=await fixture(t,async(url,options={})=>{
  if(url.includes('calendarList'))return Response.json({items:[calendar,{id:'read',summary:'읽기',accessRole:'reader'}]});
  if(options.method){writes.push({url,options});assert.equal(options.headers['If-Match'],'"one"');return Response.json({...event,...JSON.parse(options.body),etag:'"two"'});}
  return Response.json(event);
 });
 const calendars=await api.googleCalendars();assert.equal(calendars[1].writable,false);
 const preview=await api.prepareGoogleEvent({action:'update',calendarId:calendar.id,eventId:'event1',etag:'"one"',summary:'수정 제목'});
 assert.equal(writes.length,0);assert.equal(preview.previous.title,'기존 제목');assert.equal(preview.event.title,'수정 제목');
 const saved=await api.commitGoogleEvent(preview.id);assert.equal(saved.title,'수정 제목');assert.equal(writes.length,1);
 assert.deepEqual(JSON.parse(writes[0].options.body).attendees,event.attendees);
 await assert.rejects(api.commitGoogleEvent(preview.id),/이미 처리/);assert.equal(writes.length,1);
 await assert.rejects(api.prepareGoogleEvent({action:'delete',calendarId:'read',eventId:'event1'}),/권한/);
 await assert.rejects(api.prepareGoogleEvent({action:'update',calendarId:calendar.id,eventId:'event1',etag:'old',summary:'변경'}),/다른 곳/);
});
test('일정 삭제 검토와 계정 연결 해제 사이에 남은 요청은 실행되지 않는다',async t=>{
 let writes=0;
 const{api}=await fixture(t,async(url,options={})=>{
  if(url.includes('/revoke'))return new Response('');
  if(options.method){writes++;return new Response(null,{status:204});}
  return Response.json(url.includes('calendarList')?{items:[calendar]}:event);
 });
 const preview=await api.prepareGoogleEvent({action:'delete',eventId:'event1'});
 await api.disconnectGoogle();await assert.rejects(api.commitGoogleEvent(preview.id));assert.equal(writes,0);
});
test('Gmail 본문은 첨부를 제외하고 multipart 텍스트를 읽는다',async t=>{
 const b=v=>Buffer.from(v).toString('base64url');
 const{api}=await fixture(t,async url=>{
  assert(url.includes('format=full'));
  return Response.json({id:'mail1',internalDate:'1000',payload:{headers:[{name:'Subject',value:'본문 확인'}],parts:[{mimeType:'text/plain',body:{data:b('실제 본문 확인')}},{mimeType:'text/plain',filename:'첨부.txt',body:{data:b('첨부 자료')}}]}});
 });
 const value=await api.googleMail('mail1');assert.equal(value.body,'실제 본문 확인');assert.equal(value.title,'본문 확인');
});
test('드라이브 표와 발표자료를 공식 내보내기 형식으로 읽고 다운로드 크기를 제한',async t=>{
 let tooLarge=false;
 const{api}=await fixture(t,async url=>{
  if(url.includes('?fields='))return Response.json({id:'sheet1',name:'업무표',mimeType:'application/vnd.google-apps.spreadsheet'});
  assert(url.includes('mimeType=text%2Fcsv'));
  return new Response('제목,수량\n검증,2',{headers:tooLarge?{'content-length':String(21*1024*1024)}:{}});
 });
 const value=await api.googleDocument('sheet1');assert.equal(value.extension,'.csv');assert.match(value.body,/검증,2/);
 tooLarge=true;await assert.rejects(api.googleDocument('sheet1'),/크기/);
});
test('자동 가사는 곡 길이를 대조하고 LRC 다중 시각과 오프셋 및 결과 캐시를 보존',async()=>{
 assert.deepEqual(parseLyrics('[offset:100]\n[00:01.25][00:02.5]검증 본문'),[{time:1.35,text:'검증 본문'},{time:2.6,text:'검증 본문'}]);
 const api={};let calls=0;
 registerLyrics((n,f)=>api[n]=f,{fetchImpl:async url=>{calls++;assert(url.startsWith('https://lrclib.net/api/search?'));return Response.json([{trackName:'시험 음악',artistName:'시험 작성자',duration:200,plainLyrics:'직접 만든 본문',syncedLyrics:'[00:01.00]첫 줄\n[00:03]다음 줄'},{trackName:'다른 편집',duration:500,plainLyrics:'잘못된 버전'}]);}});
 const input={title:'시험 작성자 - 시험 음악 (Official Video)',author:'시험 작성자',duration:201};
 const result=await api.findMusicLyrics(input);assert.equal(result.track,'시험 음악');assert.equal(result.lines.length,2);
 await api.findMusicLyrics(input);assert.equal(calls,1);
 await assert.rejects(api.findMusicLyrics({...input,duration:-1}));
});
