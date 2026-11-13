(()=>{
 const message=document.querySelector('#message'),link=document.querySelector('#open');
 try{
  const params=new URLSearchParams(location.hash.slice(1)),value=params.get('u');
  history.replaceState(null,'',location.pathname);
  if(!value||params.size!==1)throw Error();
  const target=new URL(value);
  if(target.protocol!=='https:'||target.username||target.password||target.port||!/^[-a-z0-9]+\.trycloudflare\.com$/.test(target.hostname)||target.pathname!=='/'||target.search||!/^#handoff=[A-Za-z0-9_-]{20,200}$/.test(target.hash))throw Error();
  link.href=target.href;link.hidden=false;message.textContent='본인의 데스크톱에 연결합니다. 주소는 한 번만 사용할 수 있습니다.';
 }catch{message.textContent='사용할 수 없는 연결 주소입니다. Flowrium에서 새 주소를 보내 주세요.';link.removeAttribute('href');link.hidden=true;}
})();
