self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data;try{data=event.data?.json()}catch{}
  // 원문과 임의 제목을 받지 않는다. 기기에서 제목 미리보기를 켜면 대화 이름만 별도 항목으로 전달받는다.
  const messages={
    question:['결정 요청','어시스턴트가 질문이 있으니 결정 부탁드립니다.'],
    approval:['권한 승인 요청','대화에서 권한 승인을 기다리고 있습니다.'],
    decision:['결정 요청','검토할 업무가 있습니다.'],
    done:['답변 완료','대화의 답변이 완료됐습니다.'],
    error:['작업 실패','대화의 작업을 완료하지 못했습니다.'],
    report:['보고서 준비','새 보고서가 준비됐습니다.'],
    reminder:['예약 알림','예약한 알림 시간입니다.'],
    message:['업무 메시지','새 업무 메시지가 있습니다.'],
    unknown:['알림 확인','앱에서 알림 내용을 확인해 주세요.'],
  };
  const notice=[data?.notice,data?.kind].find(value=>typeof value==='string'&&Object.hasOwn(messages,value))||'unknown';
  const candidate=data?.conversationTitle;
  const name=['question','approval','done','error'].includes(notice)&&typeof candidate==='string'
    &&candidate.length<=160&&!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(candidate)?candidate.trim():'';
  const [title,body]=data?.test?['시험 알림','이 기기에서 알림을 받을 수 있습니다.']:messages[notice];
  const tag=typeof data?.tag==='string'&&/^flowrium-[a-z0-9-]{1,90}$/.test(data.tag)?data.tag:'flowrium';
  event.waitUntil(self.registration.showNotification(name&&!data?.test?name+' / '+title:title,{body,tag,icon:'/icon.png',badge:'/icon.png',data:{path:'/'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});const client=clients.find(c=>new URL(c.url).origin===self.location.origin);if(client){await client.focus();client.postMessage({type:'flowrium:notification'});}else await self.clients.openWindow('/');})());
});
