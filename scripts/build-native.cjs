const {execFileSync}=require('node:child_process'), path=require('node:path'), fs=require('node:fs');
function mac(){
 if(process.platform!=='darwin')return;
 const root=path.resolve(__dirname,'..'), source=path.join(root,'electron/native/FlowriumPIM.swift'), out=path.join(root,'electron/native/flowrium-pim');
 const plist=path.join(root,'electron/native/PIMInfo.plist');
 const cache=path.join(root,'.flowrium-tmp/native-build/module-cache');fs.mkdirSync(cache,{recursive:true});
 if(fs.existsSync(out)&&fs.statSync(out).mtimeMs>=Math.max(fs.statSync(source).mtimeMs,fs.statSync(plist).mtimeMs))return;
 execFileSync('/usr/bin/xcrun',['swiftc','-swift-version','5','-O','-module-cache-path',cache,'-target','arm64-apple-macos12.0',source,'-o',out,'-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker',plist],{stdio:'inherit'});
 execFileSync('/usr/bin/codesign',['--force','--sign','-',out],{stdio:'pipe'});
 const check=JSON.parse(execFileSync(out,['--self-test'],{encoding:'utf8'}));if(!check.ok||!check.value.ready)throw Error('맥 일정 연결 실행 파일을 확인하지 못했습니다.');
 console.log('Mac 일정 연결 도우미 컴파일 / 계정에 접근하지 않는 자체 검사 통과');
}
async function beforePack(context){if(context.electronPlatformName==='darwin')mac();await require('./build-win-updater.cjs')(context);}
module.exports=beforePack;module.exports.prepareMac=mac;
if(require.main===module)mac();
