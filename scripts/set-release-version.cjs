const fs=require('node:fs'),path=require('node:path');
const {dateVersion,nativeVersion,nextVersion,releaseVersion}=require('../electron/version.cjs');
const root=path.resolve(__dirname,'..');
function requestedVersion(value,pkg,now=new Date()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'2-digit',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=kind=>today.find(row=>row.type===kind).value,stamp=part('year')+part('month')+part('day');
 if(!value){const old=pkg.flowriumVersion;if(old?.startsWith(stamp+'_')&&dateVersion(old)?.sequence===99)throw Error('오늘 순번 99까지 사용했습니다. 날짜를 임의로 앞당기지 않습니다.');value=old?.startsWith(stamp+'_')?nextVersion(old):stamp+'_01';}
 if(/^20\d{6}$/.test(value))value=value.slice(2)+'_01';
 if(/^\d{6}$/.test(value))value=value+'_01';
 if(!dateVersion(value))throw Error('YYMMDD_01~99 또는 YYYYMMDD 형식의 실제 날짜를 입력하세요.');
 return value;
}
function setVersion(value){
 const file=path.join(root,'package.json'),lockFile=path.join(root,'package-lock.json'),pkg=JSON.parse(fs.readFileSync(file,'utf8')),lock=JSON.parse(fs.readFileSync(lockFile,'utf8'));
 const version=requestedVersion(value,pkg);pkg.version=nativeVersion(version);pkg.flowriumVersion=version;pkg.build.artifactName='Flowrium-'+version+'-${os}-${arch}.${ext}';pkg.build.extraMetadata={...pkg.build.extraMetadata,flowriumVersion:version};
 lock.version=pkg.version;lock.packages[''].version=pkg.version;
 pkg.build.nsis.include='assets/installer-version.nsh';
 fs.writeFileSync(path.join(root,'assets/installer-version.nsh'),'!macro customHeader\n  BrandingText "Flowrium '+version+'"\n!macroend\n\n!macro customInstall\n  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "'+version+'"\n!macroend\n');
 fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');fs.writeFileSync(lockFile,JSON.stringify(lock,null,2)+'\n');
 console.log('공개 버전 / '+releaseVersion(pkg));return version;
}
module.exports={requestedVersion,setVersion};
if(require.main===module){try{setVersion(process.argv[2]);}catch(error){console.error(error.message);process.exitCode=1;}}
