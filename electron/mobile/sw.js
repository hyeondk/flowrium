self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data;try{data=event.data?.json()}catch{}
  // 연결 키와 원문은 저장하거나 표시하지 않는다.
  const labels={decision:'확인할 결정이 있습니다.',done:'작업이 완료됐습니다.',error:'확인이 필요한 작업이 있습니다.',report:'새 보고서가 준비됐습니다.',reminder:'예약한 알림 시간입니다.',message:'새 업무 메시지가 있습니다.'};
  const body=data?.test?'이 기기에서 알림을 받을 수 있습니다.':labels[data?.kind]||'새 알림을 확인하세요.';
  event.waitUntil(self.registration.showNotification('Flowrium',{body,tag:typeof data?.tag==='string'&&/^flowrium-[a-z0-9-]{1,90}$/.test(data.tag)?data.tag:'flowrium',icon:'/icon.png',badge:'/icon.png',data:{path:'/'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});const client=clients.find(c=>new URL(c.url).origin===self.location.origin);if(client){await client.focus();client.postMessage({type:'flowrium:notification'});}else await self.clients.openWindow('/');})());
});
