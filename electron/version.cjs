const stable = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const dated = /^(\d{2})(\d{2})(\d{2})_(0[1-9]|[1-9]\d)$/;
function dateVersion(value) {
  if (typeof value !== 'string') return null;
  const m=dated.exec(value);if(!m)return null;
  const [year,month,day,sequence]=m.slice(1).map(Number),date=new Date(Date.UTC(2000+year,month-1,day));
  if(date.getUTCFullYear()!==2000+year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
  return {version:value,native:`${year}.${month}.${day*100+sequence}`,parts:[year,month,day*100+sequence],year,month,day,sequence};
}
function parseVersion(value){
 const date=dateVersion(value);if(date)return date;
 if(typeof value!=='string'||!stable.test(value))return null;
 const parts=value.split('.').map(Number);return{version:value,native:value,parts};
}
function nativeVersion(value){const parsed=parseVersion(value);if(!parsed)throw Error('릴리스 버전 형식을 확인해 주세요.');return parsed.native;}
function displayVersion(value){
 const date=dateVersion(value);if(date)return date.version;
 const parsed=parseVersion(value);if(!parsed)return String(value||'');
 const [year,month,patch]=parsed.parts,day=Math.floor(patch/100),sequence=patch%100;
 const candidate=`${String(year).padStart(2,'0')}${String(month).padStart(2,'0')}${String(day).padStart(2,'0')}_${String(sequence).padStart(2,'0')}`;
 return year<=99&&dateVersion(candidate)?.native===value?candidate:value;
}
function releaseVersion(pkg){
 if(pkg.flowriumVersion!==undefined){const parsed=dateVersion(pkg.flowriumVersion);if(!parsed||parsed.native!==pkg.version)throw Error('공개 버전과 내부 패키지 버전이 일치하지 않습니다.');return parsed.version;}
 if(!parseVersion(pkg.version))throw Error('패키지 버전 형식을 확인해 주세요.');return pkg.version;
}
function releaseTag(version){if(dateVersion(version))return version;if(parseVersion(version))return'v'+version;throw Error('릴리스 태그 형식을 확인해 주세요.');}
function parseReleaseTag(tag){if(dateVersion(tag))return tag;if(typeof tag==='string'&&tag.startsWith('v')&&stable.test(tag.slice(1)))return tag.slice(1);return null;}
function newer(candidate,installed){const next=parseVersion(candidate),previous=parseVersion(installed);if(!next||!previous)return false;const index=next.parts.findIndex((part,i)=>part!==previous.parts[i]);return index!==-1&&next.parts[index]>previous.parts[index];}
function shiftedDate(parsed,days){const d=new Date(Date.UTC(2000+parsed.year,parsed.month-1,parsed.day+days));return `${String(d.getUTCFullYear()%100).padStart(2,'0')}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;}
function nextVersion(value){const d=dateVersion(value);if(d)return d.sequence<99?value.slice(0,7)+String(d.sequence+1).padStart(2,'0'):shiftedDate(d,1)+'_01';const p=parseVersion(value);if(!p)throw Error('릴리스 버전 형식을 확인해 주세요.');return `${p.parts[0]}.${p.parts[1]}.${p.parts[2]+1}`;}
function previousVersion(value){const d=dateVersion(value);if(!d)throw Error('날짜 버전을 확인해 주세요.');return d.sequence>1?value.slice(0,7)+String(d.sequence-1).padStart(2,'0'):shiftedDate(d,-1)+'_99';}
module.exports={dateVersion,parseVersion,nativeVersion,displayVersion,releaseVersion,releaseTag,parseReleaseTag,newer,nextVersion,previousVersion};
