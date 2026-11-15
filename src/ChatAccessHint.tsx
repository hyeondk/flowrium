import './chat-access-hint.css';
import {ShieldCheck} from 'lucide-react';
import type {Mode, Session, ChatPreferences} from '../shared/types';

type Props = {session?:Session; defaults?:ChatPreferences; mode:Mode; running:boolean; onBuild:()=>void};
export default function ChatAccessHint({session,defaults,mode,running,onBuild}:Props) {
  const sandbox = session?.preferences?.sandbox || defaults?.sandbox;
  const approval = session?.preferences?.approval || defaults?.approval || (mode==='build' ? 'on-request':'never');
  const access = sandbox || (mode==='build' ? 'workspace-write':'read-only');
  let description, detail;
  if (session?.scope) {
    description = session.scope==='general' ? '일반 대화' : '프로젝트 현황 조회';
    detail = session.scope==='general' ? 'AI는 이 대화에서 프로젝트 파일에 접근하지 않습니다.' : '통합 대화에서 업무 실행 요청을 승인할 수 있습니다.';
  } else {
    description = access==='danger-full-access' ? 'AI 기기 전체 접근' : access==='workspace-write' ? 'AI 프로젝트 편집' : 'AI 파일 열람';
    detail = (access==='read-only' ? 'AI는 파일을 읽을 수 있습니다. 직접 파일을 편집하는 데에는 제한이 없습니다.' : 'AI에 허용한 파일 접근 범위입니다.') + ' ' +
      (approval==='on-request' ? '추가 권한이 필요한 요청은 승인 여부를 묻습니다.' : '추가 권한을 요청하지 않습니다.');
  }
  return <span title={detail}><ShieldCheck size={12}/>{description}
    {!session?.scope && !sandbox && mode!=='build' && !running &&
      <button type="button" className="chat-edit-mode" title="프로젝트 파일 변경을 AI에 허용합니다" onClick={onBuild}>구현 모드로 전환</button>}
  </span>;
}
