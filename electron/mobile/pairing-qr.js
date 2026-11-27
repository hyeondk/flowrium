const relayOrigin = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
const pairHash = /^#(key|handoff)=([A-Za-z0-9_-]{43})$/;

export function parsePairingQRCode(value,currentOrigin) {
  if (typeof value!=='string' || value.length>2048) return null;
  try {
    const url=new URL(value.trim());
    const matched=pairHash.exec(url.hash);
    const sameOrigin=url.origin===currentOrigin;
    if (!matched || url.username || url.password || url.pathname!=='/' || url.search ||
        (!sameOrigin && !relayOrigin.test(url.origin))) return null;
    return sameOrigin ? {kind:matched[1],secret:matched[2],sameOrigin:true} : {sameOrigin:false};
  } catch { return null; }
}

let decoder;
function readDecoder() {
  if(!decoder)decoder=import('./qr-decoder.js').then(()=>{
    if(typeof globalThis.jsQR!=='function')throw Error();
    return globalThis.jsQR;
  }).catch(()=>{
    decoder=undefined;
    throw Error('QR 코드 판독을 준비하지 못했습니다. 연결을 확인하고 다시 시도하세요.');
  });
  return decoder;
}

const element=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
const control=(text,click)=>{const button=element('button',text);button.type='button';button.addEventListener('click',click);return button;};
let active;

export function openPairingScanner(onPair) {
  if(active)return;
  const dialog=element('dialog');dialog.id='qr-pairing';dialog.setAttribute('aria-labelledby','pairing-title');
  const heading=element('h2','QR 코드로 연결');heading.id='pairing-title';
  const close=control('닫기',()=>dialog.close());close.className='popup-close-button';
  close.setAttribute('aria-label','QR 스캔 닫기');
  const header=element('header');header.append(heading,close);
  const description=element('p','컴퓨터의 Flowrium에 표시된 QR 코드를 화면 안에 맞추세요.');
  const status=element('p');status.className='hint';status.setAttribute('role','status');
  const preview=element('video');preview.autoplay=true;preview.muted=true;preview.playsInline=true;
  preview.setAttribute('aria-label','카메라 미리보기');preview.hidden=true;
  const image=element('input');image.type='file';image.accept='image/*';image.hidden=true;
  const choose=control('QR 사진 선택 또는 촬영',()=>image.click());
  const retry=control('카메라 다시 켜기',()=>void camera());retry.hidden=true;
  const actions=element('footer');actions.append(retry,choose);
  dialog.append(header,description,preview,status,image,actions);
  const restore=document.activeElement;
  document.body.append(dialog);dialog.showModal();active=dialog;
  const canvas=element('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  const controller=new AbortController();
  let stream,frame,sequence=0,working=false,displayTime=0;
  function stopCamera(){
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach(track=>track.stop());
    stream=undefined;preview.srcObject=null;preview.hidden=true;
  }
  function destroy(){
    if(active!==dialog)return;
    controller.abort();stopCamera();
    document.removeEventListener('visibilitychange',visibility);
    window.removeEventListener('pagehide',pageExit);
    active=undefined;dialog.remove();
    if(restore?.isConnected)restore.focus({preventScroll:true});
  }
  function pageExit(){if(dialog.open)dialog.close();destroy();}
  function visibility(){if(document.hidden){sequence++;stopCamera();}else if(!working)void camera();}
  dialog.addEventListener('close',destroy,{once:true});
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',pageExit,{once:true});

  async function found(value) {
    const code=parsePairingQRCode(value,location.origin);
    if(!code){status.textContent='Flowrium 연결 QR 코드를 읽어 주세요.';return false;}
    working=true;sequence++;stopCamera();
    if(!code.sameOrigin){
      status.textContent='중계 주소가 바뀌었습니다. 휴대폰 기본 카메라로 새 QR 코드를 스캔한 뒤, 열린 페이지를 홈 화면에 다시 추가하세요.';
      retry.hidden=false;
      working=false;
      return true;
    }
    status.textContent='휴대폰 연결을 확인하고 있습니다.';
    choose.disabled=true;
    try{
      await onPair(code,controller.signal);
      if(dialog.open)dialog.close();
    }catch(error){
      if(controller.signal.aborted)return true;
      status.textContent=error instanceof Error&&/[가-힣]/.test(error.message)?error.message:'데스크톱과의 연결을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.';
      choose.disabled=false;
      retry.hidden=false;
    }finally{working=false;}
    return true;
  }

  function decode(source,width,height,read) {
    if(!ctx||!width||!height)return;
    const scale=Math.min(1,960/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    ctx.drawImage(source,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    return read(pixels.data,pixels.width,pixels.height,{inversionAttempts:'attemptBoth'})?.data;
  }
  async function camera() {
    if(!dialog.open||document.hidden||working)return;
    stopCamera();
    const current=++sequence;
    retry.hidden=true;
    status.textContent='카메라를 준비하고 있습니다.';
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error();
      const opened=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
      if(!dialog.open||current!==sequence){opened.getTracks().forEach(track=>track.stop());return;}
      stream=opened;preview.srcObject=opened;preview.hidden=false;
      const read=await readDecoder();
      if(!dialog.open||current!==sequence)return;
      await preview.play();
      status.textContent='';
      async function sample(at) {
        if(!dialog.open||current!==sequence||working)return;
        if(preview.readyState>=2&&at-displayTime>180){
          displayTime=at;
          try{
            const value=decode(preview,preview.videoWidth,preview.videoHeight,read);
            if(value&&await found(value))return;
          }catch{}
        }
        if(current===sequence)frame=requestAnimationFrame(sample);
      }
      frame=requestAnimationFrame(sample);
    }catch(error){
      if(!dialog.open||current!==sequence)return;
      stopCamera();
      retry.hidden=false;
      status.textContent=error?.message?.startsWith('QR 코드 판독')?error.message:'카메라를 사용할 수 없습니다. QR 사진을 선택하거나 촬영하세요.';
    }
  }

  image.addEventListener('change',async()=>{
    const file=image.files?.[0];image.value='';
    if(!file||working)return;
    if(file.size>14*1024*1024){status.textContent='14MB보다 작은 QR 사진을 선택하세요.';return;}
    sequence++;stopCamera();
    choose.disabled=true;
    try{
      const read=await readDecoder();
      let bitmap;
      try{if(typeof createImageBitmap==='function')bitmap=await createImageBitmap(file);}catch{}
      if(!bitmap){
        const uri=await new Promise((resolve,reject)=>{
          const loader=new FileReader();loader.onload=()=>resolve(loader.result);loader.onerror=reject;loader.readAsDataURL(file);
        });
        if(typeof uri!=='string'||!uri.startsWith('data:image/'))throw Error();
        bitmap=new Image();bitmap.src=uri;await bitmap.decode();
      }
      let value;
      try{value=decode(bitmap,bitmap.width,bitmap.height,read);}finally{bitmap.close?.();}
      if(!dialog.open)return;
      if(!value){status.textContent='사진에서 QR 코드를 찾지 못했습니다. 코드 전체가 보이는 사진을 선택하세요.';return;}
      await found(value);
    }catch(error){
      if(dialog.open)status.textContent=error?.message?.startsWith('QR 코드 판독')?error.message:'사진을 읽지 못했습니다. QR 사진을 다시 선택하세요.';
    }finally{if(!working)choose.disabled=false;}
  });
  void camera();
}
