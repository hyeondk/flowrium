const test=require('node:test'),assert=require('node:assert/strict');
const {dockSizeBounds,clampDockSize}=require('../shared/dock-size.ts');
test('채팅 폭은 화면과 고정 메뉴에 맞춰 주 화면을 보존한다',()=>{for(const [view,side]of [[1440,72],[1440,260],[900,72],[800,260]]){const b=dockSizeBounds(view,side);assert(b.min<=b.max);assert(clampDockSize(9999,b)<=view-side-280||view-side<600);assert.equal(clampDockSize(-5,b),b.min);assert.equal(clampDockSize(9000,b),b.max)}});
test('겹친 패널과 작은 화면 경계',()=>{assert.deepEqual(dockSizeBounds(1440,260,true),{min:320,max:1200});assert.deepEqual(dockSizeBounds(300,72),{min:228,max:228});assert.equal(clampDockSize(500.6,{min:320,max:1200}),501)});
