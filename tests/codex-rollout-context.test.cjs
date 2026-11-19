const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { readCodexRolloutContext } = require('../electron/codex-rollout-context.cjs');

const threadId = '12345678-1234-7234-8234-123456789abc';
const otherId = '12345678-1234-7234-8234-123456789def';
const at = '2026-11-19T01:00:00.000Z';
const filename = `rollout-2026-11-19T01-00-00-${threadId}.jsonl`;
const line = value => `${JSON.stringify(value)}\n`;

function event(used, total = 12000) {
  return line({
    timestamp: at,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { total_tokens: total },
        last_token_usage: { input_tokens: used - 1, output_tokens: 1, total_tokens: used },
        model_context_window: 8192,
      },
      rate_limits: { account: '시험용으로 결과에 포함되지 않는 자료' },
    },
  });
}

async function fixture(t, bucket = 'sessions') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-rollout-context-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cwd = await fs.realpath(root);
  const codexHome = path.join(cwd, '코덱스 홈');
  const rolloutPath = path.join(codexHome, bucket, filename);
  await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
  const meta = (id = threadId, dir = cwd) => line({ type: 'session_meta', payload: { id, cwd: dir } });
  return { cwd, codexHome, rolloutPath, threadId, meta };
}

test('최신 완결 기록에서 문맥과 누적 토큰을 구분하고 현재 작성 중인 줄을 무시한다', async t => {
  const input = await fixture(t);
  await fs.writeFile(input.rolloutPath, input.meta() + event(1024) + event(2048) + line({ type: 'event_msg', payload: { type: 'token_count', info: null } }) + event(4096).trimEnd());
  const value = await readCodexRolloutContext({ ...input, rolloutPath: pathToFileURL(input.rolloutPath).href });
  assert.deepEqual(value, { used: 2048, total: 12000, max: 8192, percent: 25, updatedAt: at });
});

test('아카이브는 조회하되 대화 식별자와 프로젝트, 기록 폴더를 검증한다', async t => {
  const input = await fixture(t, 'archived_sessions');
  await fs.writeFile(input.rolloutPath, input.meta() + event(1024));
  assert.equal((await readCodexRolloutContext(input))?.used, 1024);
  assert.equal(await readCodexRolloutContext({ ...input, cwd: path.join(input.cwd, '다른 프로젝트') }), null);
  assert.equal(await readCodexRolloutContext({ ...input, threadId: otherId }), null);
  await fs.writeFile(input.rolloutPath, input.meta(otherId) + event(1024));
  assert.equal(await readCodexRolloutContext(input), null);
  const outside = path.join(input.cwd, filename);
  await fs.writeFile(outside, input.meta() + event(1024));
  assert.equal(await readCodexRolloutContext({ ...input, rolloutPath: outside }), null);
});

test('링크를 통한 다른 기록 접근을 거절하고 큰 기록에서는 제한된 뒤쪽만 확인한다', async t => {
  const input = await fixture(t);
  const archived = path.join(input.codexHome, 'archived_sessions', filename);
  await fs.mkdir(path.dirname(archived));
  await fs.writeFile(archived, input.meta() + event(2048));
  if (process.platform !== 'win32') {
    await fs.symlink(archived, input.rolloutPath);
    assert.equal(await readCodexRolloutContext(input), null);
    await fs.unlink(input.rolloutPath);
  }
  await fs.writeFile(input.rolloutPath, input.meta() + event(1024) + line({ irrelevant: 'x'.repeat(1024 * 1024 + 20) }));
  assert.equal(await readCodexRolloutContext(input), null);
  await fs.appendFile(input.rolloutPath, event(2048));
  assert.equal((await readCodexRolloutContext(input))?.used, 2048);
});
