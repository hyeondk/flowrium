const {test} = require('node:test');
const assert = require('node:assert/strict');
const {modelDisplayName, effortDisplayName} = require('../shared/model-display.ts');
const {effortOptions, effortLabels} = require('../shared/model-options.ts');
const mobile = require('../electron/mobile/model-display.js');

test('모델 표시는 실제 식별자의 버전과 계열을 보존한다', () => {
  for (const [id, label] of [
    ['gpt-6.1-sol', 'GPT-6.1 Sol'],
    ['gpt-6.1-terra', 'GPT-6.1 Terra'],
    ['gpt-6.1-astra', 'GPT-6.1 Astra'],
    ['gpt-6.10-astra', 'GPT-6.10 Astra'],
    ['gpt-6.1-sol-2026-11-15', 'GPT-6.1 Sol 2026-11-15'],
    ['gpt-6.1', 'GPT-6.1'],
  ]) assert.equal(modelDisplayName(id), label);
  const model = Object.freeze({id: 'gpt-6.1-sol', displayName: 'GPT-6 Sol'});
  assert.equal(modelDisplayName(model), 'GPT-6.1 Sol');
  assert.equal(model.id, 'gpt-6.1-sol');
  assert.equal(model.displayName, 'GPT-6 Sol');
});

test('서버의 별도 모델 이름과 알 수 없는 식별자를 임의로 바꾸지 않는다', () => {
  assert.equal(modelDisplayName({id: 'organization-model', displayName: '우리 팀 모델'}), '우리 팀 모델');
  assert.equal(modelDisplayName('organization-model'), 'organization-model');
  assert.equal(modelDisplayName(undefined), '');
  assert.equal(modelDisplayName(null), '');
  assert.equal(modelDisplayName('gpt-6.1-instant'), 'GPT-6.1 Instant');
  assert.equal(modelDisplayName('gpt-6.1-pro'), 'GPT-6.1 Pro');
});

test('추론 강도는 한국어 설명과 대응하는 실제 영어 값으로 표시한다', () => {
  const labels = {none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max', ultra: 'Ultra'};
  for (const [id, english] of Object.entries(labels)) {
    assert.match(effortDisplayName(id), /[가-힣]/);
    assert.ok(effortDisplayName(id).endsWith(`(${english})`));
    assert.equal(effortLabels[id], effortDisplayName(id));
    assert.doesNotMatch(effortDisplayName(id), /Instant|Pro/);
  }
  assert.equal(effortDisplayName('future-effort'), '서버 제공 값 (future-effort)');
  assert.equal(effortDisplayName('constructor'), '서버 제공 값 (constructor)');
  assert.equal(effortDisplayName(''), '');
});

test('추론 선택지는 모델이 실제 제공한 항목만 반환하고 원본을 보존한다', () => {
  assert.deepEqual(effortOptions(), []);
  assert.deepEqual(effortOptions({}), []);
  assert.deepEqual(effortOptions({supportedReasoningEfforts: []}), []);
  const rows = Object.freeze([
    Object.freeze({reasoningEffort: 'high', description: '복잡한 작업'}),
    Object.freeze({reasoningEffort: 'minimal', description: '짧은 작업'}),
  ]);
  const model = Object.freeze({id: 'gpt-6.1-sol', supportedReasoningEfforts: rows});
  const options = effortOptions(model);
  assert.deepEqual(options, rows);
  assert.notEqual(options, rows);
  options[0].description = '화면 전용 변경';
  assert.equal(rows[0].description, '복잡한 작업');
  assert.deepEqual(options.map(row => row.reasoningEffort), ['high', 'minimal']);
});

test('데스크톱과 모바일은 동일한 표시 구현을 사용한다', () => {
  assert.equal(modelDisplayName, mobile.modelDisplayName);
  assert.equal(effortDisplayName, mobile.effortDisplayName);
  const model = {supportedReasoningEfforts: [{reasoningEffort: 'medium'}]};
  assert.deepEqual(effortOptions(model), mobile.reasoningEffortOptions(model));
});
