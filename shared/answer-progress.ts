import type {Message, WorkStep} from './types';

type WorkSize = 'brief' | 'reply' | 'task';
type AnswerEstimate = {duration: number; size: WorkSize; answerLength: number};
export type ObservedAnswerWork = {total: number; completed: number; latest: number};
const normalDuration = {brief: 4_000, reply: 18_000, task: 85_000};
const normalLength = {brief: 60, reply: 460, task: 1_300};
const bounds = {brief: [1_500, 9_000], reply: [6_000, 40_000], task: [25_000, 240_000]};
const briefRequest = /^(?:(?:다시\s*)?(?:채팅|응답|메시지|연결)\s*(?:테스트|시험|확인)|안녕(?:하세요)?|반가워(?:요)?|고마워(?:요)?|감사합니다|수고했어(?:요)?|응|알겠어|좋아)[\s.!?~]*$/iu;
const hasAction = /구현|배포|실행해|수정해|조사해|비교해|검증해|찾아\s*(?:보고|줘)|설치해|리팩터|업데이트|\b(?:implement|deploy|execute|refactor|investigate|migrate)\b/iu;

function requestSize(message: Message): WorkSize {
  const request = message.text.trim();
  if (message.sourceOnly || message.attachments?.length || request.length > 450 || hasAction.test(request)) return 'task';
  if (request.length <= 32 && briefRequest.test(request)) return 'brief';
  return 'reply';
}

export function estimateAnswer(messages: readonly Message[], requestId?: string): AnswerEstimate {
  let index = messages.length - 1;
  while (index >= 0) {
    const message = messages[index];
    if (message.role === 'user' && (!requestId || message.id === requestId)) break;
    index--;
  }
  if (index < 0) return {duration: normalDuration.reply, answerLength: normalLength.reply, size: 'reply'};
  const size = requestSize(messages[index]);
  const samples: number[] = [];
  const lengths: number[] = [];
  let answer: Message | undefined;
  let inspected = 0;
  for (let i = index - 1; i >= 0 && inspected < 48 && samples.length < 6; i--) {
    const message = messages[i];
    if (message.role === 'assistant') {answer ||= message;continue;}
    if (message.role !== 'user') continue;
    inspected++;
    if (answer && (!message.turnId || message.turnId === answer.turnId) && requestSize(message) === size) {
      const duration = Date.parse(message.workCompletedAt || '') - Date.parse(message.workStartedAt || '');
      if (duration >= 500) {
        samples.push(duration);
        lengths.push(answer.text.length);
      }
    }
    answer = undefined;
  }
  const median = (values: number[]) => values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const empirical = median(samples) ?? normalDuration[size];
  const [min,max] = bounds[size];
  const answerLength = Math.min(4_000, Math.max(30, median(lengths) ?? normalLength[size]));
  return {duration: Math.min(max, Math.max(min, empirical)), answerLength, size};
}

export function observeAnswerWork(steps: readonly WorkStep[]): ObservedAnswerWork {
  let completed = 0;
  let latest = 0;
  for (const step of steps) {
    if (step.state !== 'running') completed++;
    latest = Math.max(latest, Date.parse(step.completedAt || step.createdAt) || 0);
  }
  return {total:steps.length,completed,latest};
}

export function expectedAnswerPercent(estimate: AnswerEstimate, elapsed: number, {total,completed,latest}: ObservedAnswerWork, streamed: number | undefined, now: number) {
  const settle = (age: number, duration: number) => 1 - Math.exp(-Math.max(0,age)/duration);
  let percent: number;
  if (streamed!==undefined) {
    percent = 88 + 7.9 * settle(streamed,estimate.answerLength * .45) + 4.09 * settle(elapsed,estimate.duration * .17);
  } else if (total) {
    const work = 29 * settle(completed,5) + 13 * completed/(total+2);
    const expected = Math.max(estimate.duration, 12_000 + total * 3_000);
    const sinceWork = Math.min(elapsed, latest ? Math.max(0, now-latest) : elapsed);
    // Time advances slowly while one tool is pending. Closing real steps moves the estimate independently.
    percent = 12 + work + 32 * settle(elapsed,expected) + 8 * settle(sinceWork,6_000);
    percent = Math.min(86,percent);
  } else {
    percent = 83 * settle(elapsed, estimate.duration * .6);
  }
  return Math.min(99.9, Math.floor(percent*10)/10);
}
