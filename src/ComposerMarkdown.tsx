import {useDeferredValue,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {Markdown} from './MessageContent';

const markup=/^ {0,3}(?:#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s|\x60{3}|~{3}|(?:[-*_]\s*){3,}$|\|.+\|)|(?:\*[^*\n]+\*|_[^_\n]+_|~~[^\n]+~~|\x60[^\x60\n]+\x60|!?\[[^\]\n]*\]\(|<https?:\/\/)/m;
export default function ComposerMarkdown({draft}:{draft:string}) {
  const [expanded,setExpanded]=useState(true);
  const text=useDeferredValue(draft);
  if(!draft || !markup.test(text)) return null;
  return <section className="composer-markdown" aria-label="입력 중인 마크다운">
    <button type="button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>
      <span>서식 미리보기</span><ChevronDown size={12}/>
    </button>
    {expanded&&<div className="composer-markdown-body" tabIndex={0}><Markdown text={text} draft/></div>}
  </section>;
}
