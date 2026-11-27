const test=require('node:test');
const assert=require('node:assert/strict');
const {parsePairingQRCode}=require('../electron/mobile/pairing-qr.js');
const {qrDecoderSource}=require('../electron/qr-decoder.cjs');

test('휴대폰 연결 QR은 같은 중계의 비밀값만 받으며 이전 중계 코드가 바깥으로 이동하지 않는다',()=>{
  const host='https://current-flowrium.trycloudflare.com',key='x'.repeat(43);
  assert.deepEqual(parsePairingQRCode(host+'/#key='+key,host),{kind:'key',secret:key,sameOrigin:true});
  assert.deepEqual(parsePairingQRCode(host+'/#handoff='+key,host),{kind:'handoff',secret:key,sameOrigin:true});
  assert.deepEqual(parsePairingQRCode('https://another-flowrium.trycloudflare.com/#key='+key,host),{sameOrigin:false});
  for(const value of [
    'javascript:alert(1)','file:///tmp/example',
    'http://another-flowrium.trycloudflare.com/#key='+key,
    'https://current-flowrium.trycloudflare.com.evil.invalid/#key='+key,
    'https://me@current-flowrium.trycloudflare.com/#key='+key,
    host+'/arbitrary/#key='+key,host+'/?secret='+key+'#key='+key,host+'/#key='+key+'&other=yes',
    host+'/#handoff=short','https://external.invalid/#key='+key,
  ])assert.equal(parsePairingQRCode(value,host),null);
});

test('모바일에 보내는 QR 판독기는 빌드에 포함된 라이선스와 코드로 구성된다', async()=>{
  const source=await qrDecoderSource();
  assert.match(source,/Copyright 2018 jsQR contributors/);
  assert.match(source,/Apache License/);
  assert.match(source,/webpackUniversalModuleDefinition/);
  assert.ok(Buffer.byteLength(source)<400000);
});
