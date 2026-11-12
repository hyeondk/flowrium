const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const run=require('node:util').promisify(require('node:child_process').execFile);
const { _electron }=require('playwright');
const {bindUpdateTransport,clickAvailable}=require('./update-installed-ui.cjs');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
  assert.equal(process.platform,'darwin');
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-click-mac-')));
  let app;
  try {
    const old=path.join(temp,'installed','Flowrium.app');
    const input=process.argv[2]||path.resolve('release/mac-arm64/Flowrium.app');
    const binary=path.join(old,'Contents','MacOS','Flowrium');
    const next=require('../package.json').version.replace(/(\d+)$/,n=>String(Number(n)+1));
    const name='Flowrium-'+next+'-mac-arm64.zip', file=path.join(temp,name);
    await fs.mkdir(path.dirname(old));
    await run('/usr/bin/ditto',[input,old]);
    const original=digest(await fs.readFile(binary));
    const newApp=path.join(temp,'candidate','Flowrium.app');
    const contents=path.join(newApp,'Contents');
    await fs.mkdir(path.join(contents,'MacOS'),{recursive:true});
    const src=path.join(temp,'fixture.c');
    await fs.writeFile(src,'int main(void){return 0;}');
    await run('/usr/bin/cc',[src,'-o',path.join(contents,'MacOS','Flowrium')]);
    await fs.writeFile(path.join(contents,'Info.plist'),'<plist version="1.0"><dict>'+
      '<key>CFBundleIdentifier</key><string>io.github.hyeondk.flowrium</string>'+
      '<key>CFBundleExecutable</key><string>Flowrium</string>'+
      '<key>CFBundlePackageType</key><string>APPL</string>'+
      '<key>CFBundleShortVersionString</key><string>'+next+'</string></dict></plist>');
    await run('/usr/bin/codesign',['--force','--sign','-',newApp]);
    await run('/usr/bin/ditto',['-c','-k','--keepParent',newApp,file]);
    const data=await fs.readFile(file),sum=digest(data),sums=sum+'  '+name+'\n';
    const url='https://github.com/hyeondk/flowrium/releases/download/v'+next+'/';
    const entries=[[name,data.length,sum],['SHA256SUMS.txt',Buffer.byteLength(sums),digest(sums)]];
    const manifest={tag_name:'v'+next,prerelease:false,draft:false,assets:entries.map(([name,size,sha])=>({
      name,size,digest:'sha256:'+sha,browser_download_url:url+name}))};
    const env={...process.env,CODEX_HOME:path.join(temp,'codex')};
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    app=await _electron.launch({executablePath:binary,args:['--user-data-dir='+path.join(temp,'profile')],env,timeout:50000});
    await bindUpdateTransport(app,{manifest,sums,file,assetURL:url+name,sumsURL:url+'SHA256SUMS.txt'});
    const page=await clickAvailable(app,next);
    const banner=page.locator('.update-banner');
    await banner.getByText(/Developer ID.*Apple 공증/).waitFor();
    await app.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.__flowriumManual=url;};});
    await banner.getByRole('button',{name:'수동 설치 파일 받기'}).click();
    assert.equal(await app.evaluate(()=>globalThis.__flowriumManual),'https://hyeondk.github.io/flowrium/');
    assert.equal(digest(await fs.readFile(binary)),original);
    assert.equal(await app.evaluate(({app})=>app.getVersion()),require('../package.json').version);
    console.log('설치한 Mac 앱에서 업데이트 버튼 클릭 / 실제 임시 서명 ZIP 거절 / 원래 앱 실행 유지 / 수동 다운로드 페이지 확인');
  } finally {
    try{if(app)await app.close();}finally{await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:200});}
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
