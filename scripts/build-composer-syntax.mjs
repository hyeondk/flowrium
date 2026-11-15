// Ship the same offline GFM parser with the desktop renderer and the independently updated phone UI.
import { rolldown } from 'rolldown';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const build=await rolldown({input:join(root,'shared/composer-markdown-syntax.mjs'),platform:'neutral'});
try {
  const {output:[chunk]}=await build.generate({format:'esm',minify:true});
  const packages=new Set();
  for(const id of chunk.moduleIds){
    if(!id.includes('node_modules'))continue;
    for(let folder=dirname(id);folder!==dirname(folder);folder=dirname(folder)){
      const files=await readdir(folder);
      if(files.includes('package.json')){packages.add(folder);break;}
    }
  }
  const notices=new Map();
  for(const folder of [...packages].sort()){
    const files=await readdir(folder);
    const license=files.find(name=>/^licen[sc]e(?:\.md|\.txt)?$/i.test(name));
    if(!license)throw Error('라이선스 파일 없음: '+folder);
    const content=(await readFile(join(folder,license),'utf8')).trim();
    const {name}=JSON.parse(await readFile(join(folder,'package.json'),'utf8'));
    notices.set(content,[...(notices.get(content)||[]),name]);
  }
  const banner=[...notices].map(([license,names])=>'/* '+names.sort().join(', ')+'\n'+license.replaceAll('*/','* /')+'\n*/').join('\n');
  await writeFile(resolve(root,'electron/mobile/composer-syntax.js'),banner+'\n'+chunk.code);
}finally{await build.close();}
