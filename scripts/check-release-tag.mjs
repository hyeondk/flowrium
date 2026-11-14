import {readFile} from 'node:fs/promises';
import versions from '../electron/version.cjs';
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const expected=versions.releaseTag(versions.releaseVersion(pkg));
if(process.env.GITHUB_REF_NAME!==expected)throw Error('태그가 공개 버전과 일치해야 합니다. 필요한 태그: '+expected);
console.log('릴리스 버전 확인: '+expected);
