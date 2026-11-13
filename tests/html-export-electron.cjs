const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
async function child(){
 const {app}=require('electron'),{exportHTML}=require('../electron/html-export.cjs'),{extract}=require('../electron/google-tools.cjs');
 assert(process.env.FLOWRIUM_HTML_TEST_PROFILE,'격리 검증 프로필이 없습니다.');app.setPath('userData',process.env.FLOWRIUM_HTML_TEST_PROFILE);app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
 await app.whenReady();
 try{
  const source=`<!doctype html><html lang="ko"><style>body{margin:0}.slide{width:1280px;height:720px;background:#f3f4f6;padding:40px;box-sizing:border-box}h1{color:#314b66}table{width:500px}td,th{border:1px solid #999}</style><section class="slide"><h1>실제 변환 검증</h1><p>편집 가능한 보고서 본문</p><table><tr><th>항목</th><th>결과</th></tr><tr><td>목표</td><td>완료</td></tr></table><aside class="notes">발표자 메모</aside></section><section class="slide"><h1>두 번째 슬라이드</h1></section><script>document.body.innerHTML='실행되면 안 되는 내용'</script></html>`;
  const pdf=await exportHTML('pdf','실제 변환',source);assert.equal(pdf.subarray(0,4).toString(),'%PDF');assert(pdf.length>2000);
  const pdfText=await extract(pdf,'application/pdf');assert.match(pdfText,/실제 변환 검증/);assert.match(pdfText,/편집 가능한 보고서 본문/);assert.match(pdfText,/두 번째 슬라이드/);assert.doesNotMatch(pdfText,/실행되면 안 되는 내용/);
  const pptx=await exportHTML('pptx','실제 변환',source),zip=await require('jszip').loadAsync(pptx),first=await zip.file('ppt/slides/slide1.xml').async('string'),second=await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(first,/실제 변환 검증/);assert.match(first,/편집 가능한 보고서 본문/);assert.match(first,/<a:tbl>/);assert.match(second,/두 번째 슬라이드/);assert.doesNotMatch(first,/실행되면 안 되는 내용/);assert.match(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string'),/발표자 메모/);
  const pptxText=await extract(pptx,'application/vnd.openxmlformats-officedocument.presentationml.presentation');assert.match(pptxText,/실제 변환 검증/);assert.match(pptxText,/편집 가능한 보고서 본문/);assert.match(pptxText,/두 번째 슬라이드/);
  console.log('실제 Electron HTML → PDF / 편집 가능한 2장 PPTX / 표 / 메모 / 스크립트 차단 / 생성 PDF와 PPTX 본문 읽기 검증 통과');app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
}
async function parent(){
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-html-export-'));let timer,timedOut=false;
 try{
  const env={...process.env,FLOWRIUM_HTML_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  const processChild=require('node:child_process').spawn(require('electron'),[__filename,'--electron-child'],{env,stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{processChild.once('error',reject);processChild.once('close',resolve);timer=setTimeout(()=>{timedOut=true;processChild.kill();},60000);});if(timedOut)throw Error('문서 변환 검증 대기 시간을 넘었습니다.');assert.equal(code,0,'실제 Electron 문서 변환과 본문 읽기 검증에 실패했습니다.');
 }finally{clearTimeout(timer);await fs.rm(profile,{recursive:true,force:true,maxRetries:12,retryDelay:250});}
}
if(process.versions.electron&&process.type==='browser')child().catch(error=>{console.error(error);require('electron').app.exit(1);});else parent().catch(error=>{console.error(error);process.exitCode=1;});
