const assert=require('node:assert/strict');
const composer=page=>page.getByLabel('Codex에 보낼 작업 요청');
async function dockHome(page){
 await page.locator('.app-shell').waitFor();
 const dock=page.getByRole('complementary',{name:'통합 / 프로젝트 / 일반 대화'});
 const toggle=page.locator('.dock-toggle');
 if(!await dock.isVisible()){await toggle.waitFor();if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();}
 await dock.waitFor();
 const back=dock.getByRole('button',{name:'대화 목록으로',exact:true});if(await back.isVisible())await back.click();
 const home=dock.getByRole('button',{name:'대화 홈으로',exact:true});if(await home.isVisible())await home.click();
 await dock.locator('.dock-scope-card').first().waitFor();const picker=dock.locator('.dock-project-picker');if(await picker.count()&&!await picker.evaluate(node=>node.open))await picker.locator('summary').click();return dock;
}
async function openConversation(page,title,{expanded=false}={}){
 const data=await page.evaluate(()=>window.flowrium.bootstrap()),session=data.sessions.find(s=>s.title===title);if(!session)throw Error('검증할 대화를 찾을 수 없습니다: '+title);
 const dock=await dockHome(page);
 if(session.scope)await dock.locator('.dock-scope-card[data-scope="'+session.scope+'"]').getByRole('button').first().click();
 else{const project=data.projects.find(p=>p.id===session.projectId);await dock.locator('.dock-project-row').filter({has:page.getByText(project.name,{exact:true})}).click();}
 await dock.locator('.dock-session').filter({has:page.getByText(title,{exact:true})}).click();await composer(page).waitFor();
 const toggle=page.getByRole('button',{name:expanded?'대화 패널 넓히기':'대화 패널 좁히기',exact:true});if(await toggle.isVisible())await toggle.click();
}
async function newProjectConversation(page,projectId){
 const data=await page.evaluate(()=>window.flowrium.bootstrap()),project=data.projects.find(p=>p.id===projectId),dock=await dockHome(page);
 await dock.locator('.dock-project-row').filter({has:page.getByText(project.name,{exact:true})}).click();await dock.getByRole('button',{name:'새 대화',exact:true}).click();await composer(page).waitFor();
}
async function closeSettings(page){await page.getByRole('button',{name:'설정 닫기',exact:true}).click();await page.getByRole('dialog',{name:'설정',exact:true}).waitFor({state:'hidden'});}
async function leaveConversation(page){await page.getByRole('button',{name:'대화 목록으로',exact:true}).click();await composer(page).waitFor({state:'hidden'});}
module.exports={composer,dockHome,openConversation,newProjectConversation,closeSettings,leaveConversation,settledRail,settledLayout};

async function settledRail(rail,{expanded,pinned,width},label) {
 const result=await rail.evaluate(async(node,expected)=>{
  const surface=node.querySelector('.sidebar-surface');
  const shell=node.closest('.app-shell'),main=shell.querySelector('.main-shell');
  const deadline=performance.now()+8000;
  let previous,frames=0,last;
  do {
   await new Promise(resolve=>requestAnimationFrame(resolve));
   const width=surface.getBoundingClientRect().width;
   const mainBox=main.getBoundingClientRect(),dock=shell.querySelector('.conversation-dock');
   const moving=[surface,main,dock].some(element=>element?.getAnimations().some(animation=>
     animation.effect?.getTiming().iterations!==Infinity&&(animation.pending||animation.playState==='running')));
   last={expanded:node.dataset.expanded,pinned:node.dataset.pinned,width,mainX:mainBox.x,mainWidth:mainBox.width,moving,
    hover:node.matches(':hover'),focus:document.activeElement?.getAttribute('aria-label')};
   const target=expected.width===undefined?(expected.expanded?width>180:width<90):Math.abs(width-expected.width)<1;
   const reached=target&&!moving&&last.expanded===String(expected.expanded)&&last.pinned===String(expected.pinned);
   const stable=previous&&['width','mainX','mainWidth'].every(key=>Math.abs(previous[key]-last[key])<.1);
   frames=reached&&stable?frames+1:0;
   if(frames>=3)return {ok:true,...last};
   previous=last;
  }while(performance.now()<deadline);
  return {ok:false,...last};
 },{expanded,pinned,width});
 assert(result.ok,label+' '+JSON.stringify(result));
 return result.width;
}


async function settledLayout(locator) {
 await locator.waitFor({state:'visible'});
 const result=await locator.evaluate(async element=>{
  const start=performance.now();let previous,stable=0,last;
  do {
   await new Promise(resolve=>requestAnimationFrame(resolve));
   const box=element.getBoundingClientRect();
   last={x:box.x,y:box.y,width:box.width,height:box.height,opacity:Number(getComputedStyle(element).opacity),scrollTop:element.scrollTop};
   const related=[element];
   for(let parent=element.parentElement;parent;parent=parent.parentElement)related.push(parent);
   const moving=related.some(node=>node.getAnimations({subtree:node===element}).some(animation=>
    animation.effect?.getTiming().iterations!==Infinity&&(animation.pending||animation.playState==='running')));
   const same=previous&&Object.keys(last).every(key=>Math.abs(last[key]-previous[key])<.1);
   stable=element.isConnected&&!moving&&same?stable+1:0;
   if(stable>=3)return {ok:true,...last};
   previous=last;
  }while(performance.now()-start<12000);
  return {ok:false,...last};
 });
 assert(result.ok,'전환 종료와 실제 배치 안정 '+JSON.stringify(result));
 return result;
}
