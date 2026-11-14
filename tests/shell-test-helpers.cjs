const composer=page=>page.getByLabel('Codex에 보낼 작업 요청');
async function dockHome(page){
 await page.locator('.app-shell').waitFor();
 const dock=page.getByRole('complementary',{name:'통합 / 프로젝트 / 일반 대화'});
 const toggle=page.locator('.dock-toggle');
 if(!await dock.isVisible()){await toggle.waitFor();if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();}
 await dock.waitFor();
 const back=dock.getByRole('button',{name:'대화 목록으로',exact:true});if(await back.isVisible())await back.click();
 const home=dock.getByRole('button',{name:'대화 홈으로',exact:true});if(await home.isVisible())await home.click();
 await dock.locator('.dock-scope-card').first().waitFor();return dock;
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
module.exports={composer,dockHome,openConversation,newProjectConversation,closeSettings,leaveConversation};
