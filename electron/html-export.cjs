const { randomUUID } = require('node:crypto');
function isolatedHTML(source){return '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\';script-src \'none\';connect-src \'none\';img-src data: blob:;style-src \'unsafe-inline\';font-src data:;base-uri \'none\';form-action \'none\';frame-src \'none\'">'+source.replace(/^\s*<!doctype[^>]*>/i,'');}
function color(value){const m=/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(value||'');return m&&m[4]!=='0'?m.slice(1,4).map(s=>Number(s).toString(16).padStart(2,'0')).join('').toUpperCase():null;}
async function exportHTML(format,title,source){
  const {BrowserWindow}=require('electron');if(typeof BrowserWindow!=='function')throw Error('HTML 변환은 데스크톱 앱에서 사용할 수 있습니다.');
  const win=new BrowserWindow({show:false,width:1280,height:720,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,partition:'flowrium-export-'+randomUUID()}});
  try{
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    await win.loadURL('data:text/html;charset=utf-8;base64,'+Buffer.from(isolatedHTML(source)).toString('base64'));
    if(format==='pdf')return await win.webContents.printToPDF({printBackground:true,preferCSSPageSize:true});
    if(format!=='pptx')throw Error('PDF 또는 PPTX 형식을 선택하세요.');
    const deck=new(require('pptxgenjs'))();deck.layout='LAYOUT_WIDE';deck.title=title;deck.author='Flowrium';
    const count=await win.webContents.executeJavaScript("document.querySelectorAll('section.slide,.slide[data-slide]').length || 1");if(count>150)throw Error('슬라이드는 150장까지 변환할 수 있습니다.');
    for(let index=0;index<count;index++){
      const layout=await win.webContents.executeJavaScript(`(${function(index){
        const nodes=[...document.querySelectorAll('section.slide,.slide[data-slide]')],root=nodes[index]||document.body;
        root.scrollIntoView({block:'start'});const rect=root.getBoundingClientRect(),clear=c=>!c||c==='transparent'||/rgba\(.*,[ ]*0\)$/.test(c);
        const out={width:rect.width||1280,height:nodes.length?rect.height||720:720,bg:getComputedStyle(root).backgroundColor,boxes:[],texts:[],tables:[],images:[],notes:root.querySelector('aside.notes')?.textContent||''};
        const relative=r=>({x:r.left-rect.left,y:r.top-rect.top,w:r.width,h:r.height});
        for(const e of root.querySelectorAll('*')){
          if(e.closest('aside.notes')||e.closest('svg')&&e.tagName.toLowerCase()!=='svg')continue;
          const css=getComputedStyle(e),r=e.getBoundingClientRect();if(css.display==='none'||css.visibility==='hidden'||r.width<1||r.height<1)continue;
          const box=relative(r);if(box.y>out.height||box.y+box.h<0)continue;
          if(['IMG','SVG','CANVAS'].includes(e.tagName.toUpperCase())){out.images.push({...box,left:r.left,top:r.top});continue;}
          if(e.closest('table')&&e.tagName!=='TABLE')continue;
          if(e.tagName==='TABLE'){out.tables.push({...box,rows:[...e.rows].map(row=>[...row.cells].map(cell=>({text:cell.innerText,color:getComputedStyle(cell).color,bold:['TH'].includes(cell.tagName)})))});continue;}
          if(!clear(css.backgroundColor))out.boxes.push({...box,color:css.backgroundColor});
          const children=[...e.children],inline=c=>getComputedStyle(c).display.startsWith('inline');
          if(e.innerText?.trim()&&children.every(c=>inline(c)||c.tagName==='BR')&&!(inline(e)&&e.parentElement&&[...e.parentElement.children].every(c=>inline(c)||c.tagName==='BR')))
            out.texts.push({...box,text:e.innerText.trim(),size:parseFloat(css.fontSize)||16,color:css.color,bold:parseInt(css.fontWeight)>=600,align:css.textAlign});
        }
        return out;
      }.toString()})(${index})`);
      const slide=deck.addSlide(),sx=13.333333/layout.width,sy=7.5/layout.height,bg=color(layout.bg);if(bg)slide.background={color:bg};
      const bounds=b=>({x:Math.max(0,b.x*sx),y:Math.max(0,b.y*sy),w:Math.max(.01,Math.min(13.333,b.w*sx)),h:Math.max(.01,Math.min(7.5,b.h*sy))});
      for(const b of layout.boxes){const fill=color(b.color);if(fill)slide.addShape(deck.ShapeType.rect,{...bounds(b),fill:{color:fill},line:{transparency:100}});}
      for(const t of layout.tables)slide.addTable(t.rows.map(row=>row.map(c=>({text:c.text,options:{bold:c.bold,color:color(c.color)||'222222'}}))),{...bounds(t),fontFace:'Malgun Gothic',fontSize:12,border:{pt:.5,color:'CCD0D6'},margin:4,autoPage:false});
      for(const t of layout.texts)slide.addText(t.text,{...bounds(t),fontFace:'Malgun Gothic',fontSize:Math.max(6,Math.min(72,t.size*.75)),bold:t.bold,color:color(t.color)||'222222',align:['center','right'].includes(t.align)?t.align:'left',margin:0,breakLine:false,fit:'shrink',lang:'ko-KR',valign:'top'});
      for(const image of layout.images){try{const png=await win.webContents.capturePage({x:Math.max(0,Math.round(image.left)),y:Math.max(0,Math.round(image.top)),width:Math.max(1,Math.min(1280,Math.round(image.w))),height:Math.max(1,Math.min(720,Math.round(image.h)))});slide.addImage({data:png.toDataURL(),...bounds(image)});}catch{}}
      if(layout.notes)slide.addNotes(layout.notes);
    }
    return deck.write({outputType:'nodebuffer',compression:true});
  }finally{if(!win.isDestroyed())win.destroy();}
}
module.exports={isolatedHTML,exportHTML};
