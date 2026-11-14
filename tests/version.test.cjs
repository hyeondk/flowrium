const test=require('node:test'),assert=require('node:assert/strict');
const {dateVersion,nativeVersion,displayVersion,releaseVersion,releaseTag,parseReleaseTag,newer}=require('../electron/version.cjs');
test('날짜 버전의 표시·패키지 매핑과 유효한 날짜·순번 검사',()=>{
 assert.equal(nativeVersion('261114_01'),'26.11.1401');assert.equal(displayVersion('26.11.1401'),'261114_01');assert.equal(displayVersion('0.6.0'),'0.6.0');
 assert.equal(releaseVersion({version:'26.11.1401',flowriumVersion:'261114_01'}),'261114_01');assert.throws(()=>releaseVersion({version:'26.11.1402',flowriumVersion:'261114_01'}),/일치/);
 for(const value of ['261114_00','261114_1','261114_001','261114_100','261332_01','260229_01','261131_01','../../261114_01','v261114_01'])assert.equal(dateVersion(value),null,value);
 assert(dateVersion('240229_99'));assert.equal(releaseTag('261114_01'),'261114_01');assert.equal(releaseTag('0.6.0'),'v0.6.0');assert.equal(parseReleaseTag('v261114_01'),null);
});
test('날짜와 같은 날의 순번을 비교하고 기존 숫자 버전에서 새 버전으로 전환한다',()=>{
 for(const [next,old]of [['261114_02','261114_01'],['261115_01','261114_99'],['270101_01','261231_99'],['261114_01','0.6.0'],['261114_02','26.11.1401']])assert.equal(newer(next,old),true);
 for(const [next,old]of [['261114_01','261114_01'],['261114_01','261114_02'],['261113_99','261114_01'],['0.6.0','261114_01'],['261332_01','0.6.0']])assert.equal(newer(next,old),false);
});

test('서울 날짜로 순번을 정하고 월말과 날짜가 넘어가면 다음 날 첫 번호로 전환한다',()=>{
 const {requestedVersion}=require('../scripts/set-release-version.cjs'),{nextVersion,previousVersion}=require('../electron/version.cjs');
 assert.equal(requestedVersion('20261114',{}),'261114_01');assert.equal(requestedVersion(undefined,{flowriumVersion:'261114_01'},new Date('2026-11-13T16:00:00Z')),'261114_02');assert.equal(requestedVersion(undefined,{flowriumVersion:'261114_99'},new Date('2026-11-14T16:00:00Z')),'261115_01');assert.equal(nextVersion('261130_99'),'261201_01');assert.equal(previousVersion('270101_01'),'261231_99');assert.throws(()=>requestedVersion('20260230',{}));assert.throws(()=>requestedVersion(undefined,{flowriumVersion:'261114_99'},new Date('2026-11-13T16:00:00Z')),/99/);
});
