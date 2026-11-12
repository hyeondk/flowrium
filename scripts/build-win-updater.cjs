const path = require('node:path');
const fs = require('node:fs/promises');
const run = require('node:util').promisify(require('node:child_process').execFile);
async function build(context) {
  if (process.platform !== 'win32' || context?.electronPlatformName && context.electronPlatformName !== 'win32') return;
  const dir = path.resolve(__dirname,'..','electron','update-helpers');
  const compiler = path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const output = path.join(dir,'Flowrium.Update.exe');
  const result = await run(compiler,['/nologo','/target:winexe','/platform:x64','/optimize+',
    '/reference:System.Web.Extensions.dll','/reference:System.Windows.Forms.dll','/out:'+output,
    path.join(dir,'WindowsUpdate.cs')],{windowsHide:true});
  if (!(await fs.stat(output)).isFile()) throw new Error('Windows 업데이트 보조 실행 파일을 만들 수 없습니다.');
  console.log('Windows 업데이트 보조 실행 파일 생성',result.stdout.trim());
}
module.exports = build;
if(require.main===module)build().catch(e=>{console.error(e.stdout||e.message);process.exitCode=1;});
