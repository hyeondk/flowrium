const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
test('터미널 설치기는 운영체제 보안 정책을 해제하거나 원격 코드를 바로 실행하지 않는다',async()=>{
 const root=path.resolve(__dirname,'..'),mac=await fs.readFile(path.join(root,'install.sh'),'utf8'),windows=await fs.readFile(path.join(root,'install.ps1'));
 for(const source of [mac,windows.toString('utf8')]){assert.doesNotMatch(source,/\b(?:xattr|spctl|Unblock-File|Set-MpPreference|Set-ExecutionPolicy|Invoke-Expression)\b/i);assert.doesNotMatch(source,/ExecutionPolicy\s+Bypass|curl[^\n]*\|\s*(?:ba)?sh|\|\s*iex\b/i);}
 assert.deepEqual([...windows.subarray(0,3)],[0xef,0xbb,0xbf]);
});
