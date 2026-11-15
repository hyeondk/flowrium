import type {FollowupSuggestion} from '../shared/chat-continuation';
import {messageContent} from './message-content.ts';

export type DisplaySuggestion = FollowupSuggestion & { source: 'conversation' | 'model' };

// Only quote an explicit next step from the assistant's own prose. A report,
// example or project file in the answer can contain unrelated instructions.
export function followupFromAnswer(text: string): DisplaySuggestion | undefined {
  if (!text || text.length > 32000) return;
  const finalBlock = messageContent(text, 'assistant').at(-1);
  if (finalBlock?.kind !== 'markdown') return;
  const lines = finalBlock.text.trimEnd().split(/\r?\n/);
  let fence = '';
  let nextSection = false;
  let task = '';
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker.startsWith(fence) && line.trim() === marker) fence = '';
      nextSection = false;
      task = '';
      continue;
    }
    if (fence || !line.trim()) continue;
    if (/^(?: {4}|\t|\s*>)/.test(line)) { nextSection = false; task = ''; continue; }
    const body = line.trim().replace(/\*\*|__/g, '').replace(/^#{1,6}\s+/, '');
    const section = /^(?:다음 (?:작업|단계)|후속 작업|남은 (?:작업|사항)|next steps?)(?:\s*[:：]\s*(.*)|\s*)$/i.exec(body);
    if (section) { nextSection = true; task = section[1] || ''; continue; }
    const bullet = /^(?:[-*+]\s+|\d+[.)]\s+)(?:\[ \]\s*)?/.exec(body);
    if (nextSection && bullet) { if (!task) task = body.slice(bullet[0].length); continue; }
    task = body.split(/(?<=[.!?。])\s+/).at(-1) || '';
    nextSection = false;
  }
  task = task.trim().replace(/^(?:원하시면|원한다면)\s*[,，]?\s*/, '');
  if (task.length < 6 || task.length > 190 || /https?:|[`<>{}\[\]]|(?:없습니다|없음|완료했습니다|완료됐습니다)[.!]?$/i.test(task)) return;
  if (/(?:어떤|무엇|어떻게|어느)\s|(?:아니면|또는)\s|[?？].+[?？]/.test(task)) return;

  let prompt: string;
  if (/(?:할까요|해\s*드릴까요|해\s*볼까요)[?？]$/.test(task)) {
    prompt = task.replace(/(?:할까요|해\s*드릴까요|해\s*볼까요)[?？]$/, '해 주세요.');
  } else if (nextSection && !/[?？]/.test(task)) {
    if (/(?:니다|됐어요|완료|불필요|없음|해결됨)[.!]?$/i.test(task)) return;
    prompt = /(?:해|어|아|여)\s*주세요[.!]?$/.test(task) ? task : '다음 항목을 진행해 주세요.\n\n' + task;
  } else return;
  if (/^(?:이대로|그대로|계속|이어서|다음 단계(?:를|로)?)?\s*(?:이어서\s*)?(?:진행|계속|시작)해 주세요[.]?$/.test(prompt)) return;
  return {source:'conversation', title:task, prompt, reason:'직전 답변에서 제안한 작업'};
}
