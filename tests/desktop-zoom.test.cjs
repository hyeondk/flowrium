const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {DEFAULT_DESKTOP_ZOOM,initializeDesktopZoom,resetDesktopZoom}=require('../electron/desktop-zoom.cjs');
function contents(){const value=new EventEmitter();value.dead=false;value.zoom=1;value.isDestroyed=()=>value.dead;value.setZoomFactor=zoom=>value.zoom=zoom;return value;}
test('최초 화면은 87%이고 사용자 확대는 새로고침으로 재설정하지 않는다',()=>{
 const web=contents();initializeDesktopZoom(web);web.emit('did-finish-load');assert.equal(web.zoom,.87);
 web.zoom=1.25;web.emit('did-finish-load');assert.equal(web.zoom,1.25);
 const next=contents();initializeDesktopZoom(next);next.emit('did-finish-load');assert.equal(next.zoom,.87);
});
test('기본 크기 복귀는 87%이며 이미 닫힌 창을 조작하지 않는다',()=>{
 const web=contents(),window={isDestroyed:()=>false,webContents:web};web.zoom=1.5;resetDesktopZoom(window);assert.equal(web.zoom,DEFAULT_DESKTOP_ZOOM);
 web.dead=true;web.zoom=1.5;resetDesktopZoom(window);assert.equal(web.zoom,1.5);assert.doesNotThrow(()=>resetDesktopZoom(null));
 const closed=contents();closed.dead=true;initializeDesktopZoom(closed);closed.emit('did-finish-load');assert.equal(closed.zoom,1);
});
