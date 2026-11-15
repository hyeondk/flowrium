import {markdownRanges} from './composer-syntax.js';
self.onmessage=({data:{revision,source}})=>{
  try {
    const ranges=markdownRanges(source);
    self.postMessage({revision,ranges:ranges.length<=5000?ranges:[]});
  }catch{self.postMessage({revision,ranges:[]});}
};
