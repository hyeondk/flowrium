import {useEffect,useState} from 'react';
import {FileText,FolderOpen} from 'lucide-react';
import type {CitationGroup} from '../electron/mobile/file-citations.js';

export default function ChatCitation({group,sessionId,messageId}:{group:CitationGroup;sessionId:string;messageId:string}) {
  const image=group.files.find(file=>file.image);
  const [preview,setPreview]=useState('');
  const [error,setError]=useState('');
  const [attempt,retry]=useState(0);
  useEffect(()=>{
    let current=true;
    setPreview('');setError('');
    if(image)window.flowrium?.readChatCitation(sessionId,messageId,image.index,'preview').then(result=>{
      if(current)setPreview(result.dataUrl||'');
    }).catch(()=>{if(current)setError('미리보기를 열 수 없습니다.');});
    return ()=>{current=false;};
  },[sessionId,messageId,image?.index,attempt]);
  async function open(index:number) {
    try {await window.flowrium!.readChatCitation(sessionId,messageId,index,'reveal');setError('');}
    catch {setError('파일 위치를 열 수 없습니다. 프로젝트에 원본이 있는지 확인해 주세요.');}
  }
  return <figure className="chat-citation">
    {preview&&image&&<button className="citation-image" title="원본 파일 위치 열기" type="button" onClick={()=>void open(image.index)}><img alt={image.name} src={preview}/></button>}
    {group.files.filter(file=>!preview||file!==image).map(file=><button key={file.index} className="citation-open" type="button" onClick={()=>void open(file.index)}>
      <FileText size={14}/><span>{file.name}</span><FolderOpen size={13}/></button>)}
    {error&&<figcaption role="status">{error} {image&&<button type="button" onClick={()=>retry(n=>n+1)}>다시 시도</button>}</figcaption>}
  </figure>;
}
