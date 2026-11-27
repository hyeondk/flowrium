const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

const apiOrigin = 'https://api.anthropic.com';
const apiVersion = '2026-10-21';
const effortLevels = ['low', 'medium', 'high', 'xhigh', 'max'];
const modelIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const maxCredentialBytes = 4096;
const maxJsonBytes = 4 * 1024 * 1024;
const maxRequestBytes = 30 * 1024 * 1024;
const maxFrameLength = 2 * 1024 * 1024;
const maxStreamLength = 8 * 1024 * 1024;

class ClaudeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseKey(input) {
  const key = typeof input === 'string' ? input.trim() : '';
  if (!/^sk-ant-api[0-9]+-[A-Za-z0-9_-]{20,500}$/.test(key)) {
    throw new ClaudeError('CLAUDE_KEY_INVALID', 'Claude Console에서 발급한 API 키를 입력해 주세요.');
  }
  return key;
}

function changed() {
  return new ClaudeError('CLAUDE_CONNECTION_CHANGED', 'Claude 연결이 변경되었습니다. 다시 시도해 주세요.');
}

function malformed() {
  return new ClaudeError('CLAUDE_RESPONSE_INVALID', 'Claude에서 보낸 응답을 읽지 못했습니다.');
}

function failHttp(status, detail) {
  const type = detail?.type;
  if (status === 401 || type === 'authentication_error') return new ClaudeError('CLAUDE_AUTH', 'Claude API 키를 확인해 주세요.');
  if (status === 403 || type === 'permission_error') return new ClaudeError('CLAUDE_PERMISSION', 'Claude 계정의 API 사용 권한을 확인해 주세요.');
  if (status === 402 || /credit balance|billing|payment required/i.test(detail?.message ?? '')) {
    return new ClaudeError('CLAUDE_BILLING', 'Claude Console의 크레딧과 결제 상태를 확인해 주세요.');
  }
  if (status === 429 || type === 'rate_limit_error') return new ClaudeError('CLAUDE_RATE_LIMIT', 'Claude 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
  if (status >= 500 || type === 'overloaded_error' || type === 'api_error') return new ClaudeError('CLAUDE_SERVER', 'Claude 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.');
  if (status === 404 || type === 'not_found_error') return new ClaudeError('CLAUDE_MODEL_UNAVAILABLE', '선택한 Claude 모델을 사용할 수 없습니다. 설정에서 모델 목록을 다시 확인해 주세요.');
  if (status === 413 || type === 'request_too_large') return new ClaudeError('CLAUDE_REQUEST_SIZE', 'Claude에 보낼 자료가 너무 큽니다. 첨부 또는 대화 범위를 줄여 주세요.');
  return new ClaudeError('CLAUDE_REQUEST_FAILED', 'Claude가 요청을 처리하지 못했습니다. 선택한 모델, 추론 수준과 첨부 자료를 확인해 주세요.');
}

async function readJson(response) {
  if (Number(response.headers.get('content-length')) > maxJsonBytes) {
    await response.body?.cancel().catch(() => {});
    throw malformed();
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > maxJsonBytes) throw malformed();
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw malformed(); }
}

async function* streamEvents(body) {
  if (!body) throw malformed();
  const decoder = new TextDecoder();
  let buffer = '';
  let prior = 0;
  for await (const chunk of body) {
    prior += chunk.byteLength;
    if (prior > maxStreamLength) throw malformed();
    buffer += decoder.decode(chunk, {stream:true});
    let boundary;
    while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
      if (boundary.index > maxFrameLength) throw malformed();
      const event = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (!data) continue;
      let parsed;
      try { parsed = JSON.parse(data); }
      catch { throw malformed(); }
      yield parsed;
    }
    if (buffer.length > maxFrameLength) throw malformed();
  }
}

async function collectAnswer(response, requestedModel, onDelta, assertActive) {
  let model = requestedModel;
  let usage = {};
  let stopReason = null;
  let started = false;
  const blocks = new Map();
  const toolJson = new Map();
  const textChunks = [];
  async function append(text) {
    if (!text) return;
    textChunks.push(text);
    await onDelta?.(text);
  }

  for await (const event of streamEvents(response.body)) {
    assertActive();
    if (event?.type === 'error') throw failHttp(0, event.error);
    if (event?.type === 'message_start') {
      if (started || !event.message) throw malformed();
      started = true;
      if (modelIdPattern.test(event.message?.model ?? '')) model = event.message.model;
      usage = {...event.message?.usage};
    } else if (event?.type === 'content_block_start' && Number.isSafeInteger(event.index)) {
      const block = event.content_block;
      if (!block || typeof block !== 'object') throw malformed();
      blocks.set(event.index, {...block});
      if (block.type === 'text') await append(block.text);
    } else if (event?.type === 'content_block_delta') {
      const block = blocks.get(event.index);
      const delta = event.delta;
      if (!block || !delta) continue;
      if (block.type === 'text' && delta.type === 'text_delta' && typeof delta.text === 'string') {
        block.text = (block.text || '') + delta.text;
        await append(delta.text);
      } else if (block.type === 'thinking' && delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        block.thinking = (block.thinking || '') + delta.thinking;
      } else if (block.type === 'thinking' && delta.type === 'signature_delta' && typeof delta.signature === 'string') {
        block.signature = (block.signature || '') + delta.signature;
      } else if (block.type === 'tool_use' && delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        toolJson.set(event.index, (toolJson.get(event.index) || '') + delta.partial_json);
      }
    } else if (event?.type === 'content_block_stop' && toolJson.has(event.index)) {
      try { blocks.get(event.index).input = JSON.parse(toolJson.get(event.index)); }
      catch { throw malformed(); }
      toolJson.delete(event.index);
    } else if (event?.type === 'message_delta') {
      stopReason = event.delta?.stop_reason ?? stopReason;
      usage = {...usage, ...event.usage};
    } else if (event?.type === 'message_stop') {
      if (!started || toolJson.size) throw malformed();
      const content = [...blocks].sort(([a], [b]) => a - b).map(([, block]) => block);
      const toolCalls = content.filter(block => block.type === 'tool_use').map(({id, name, input}) => ({id, name, input}));
      const number = (key) => Number.isSafeInteger(usage[key]) && usage[key] > 0 ? usage[key] : 0;
      const inputTokens = number('input_tokens') + number('cache_creation_input_tokens') + number('cache_read_input_tokens');
      return {text:textChunks.join(''), model, content, toolCalls, usage:{inputTokens, outputTokens:number('output_tokens')}, stopReason};
    }
  }
  throw new ClaudeError('CLAUDE_STREAM_INCOMPLETE', 'Claude 응답 연결이 끝나기 전에 끊겼습니다. 다시 시도해 주세요.');
}

function modelRow(raw) {
  const id = raw?.id;
  if (typeof id !== 'string' || !modelIdPattern.test(id) || raw.lifecycle === 'retired') return null;
  const effort = raw.capabilities?.effort;
  const thinking = raw.capabilities?.thinking;
  const supported = effortLevels.filter(level => effort?.supported === true && effort[level]?.supported === true);
  return {
    id, model:id,
    displayName: typeof raw.display_name === 'string' ? raw.display_name.slice(0, 128) || id : id,
    isDefault:false,
    supportedReasoningEfforts:supported.map(reasoningEffort => ({reasoningEffort})),
    supportsAdaptiveThinking:thinking?.supported === true && thinking.types?.adaptive?.supported === true,
    ...(Number.isSafeInteger(raw.max_input_tokens) && raw.max_input_tokens > 0 && {contextWindow:raw.max_input_tokens}),
    ...(Number.isSafeInteger(raw.max_tokens) && raw.max_tokens > 0 && {maxOutputTokens:raw.max_tokens}),
  };
}

class ClaudeClient {
  #generation = new AbortController();
  #queue = Promise.resolve();
  #catalog;
  #directory;
  #file;
  #storage;
  #fetch;
  #now;
  #timeout;
  #streamTimeout;

  constructor({directory, secretStorage, fetchImpl = fetch, now = Date.now, timeout = 15000, streamTimeout = 300000}) {
    this.#directory = directory;
    this.#file = path.join(directory, 'claude-api-key.enc');
    this.#storage = secretStorage;
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#timeout = timeout;
    this.#streamTimeout = streamTimeout;
  }

  #rotate() {
    this.#generation.abort();
    this.#generation = new AbortController();
    this.#catalog = undefined;
    return this.#generation.signal;
  }

  #enqueue(job) {
    const run = this.#queue.then(job);
    this.#queue = run.catch(() => {});
    return run;
  }

  #ensureStorage() {
    if (!this.#storage?.isEncryptionAvailable() || this.#storage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new ClaudeError('CLAUDE_KEY_STORAGE_UNAVAILABLE', '운영체제의 보안 저장소를 사용할 수 없습니다.');
    }
  }

  async #readKey() {
    let before;
    try { before = await fs.lstat(this.#file); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
    }
    this.#ensureStorage();
    try {
      if (!before?.isFile() || before.size < 1 || before.size > maxCredentialBytes) throw Error();
      const handle = await fs.open(this.#file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const opened = await handle.stat();
        if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) throw Error();
        const data = Buffer.alloc(opened.size);
        let total = 0;
        while (total < data.length) {
          const {bytesRead} = await handle.read(data, total, data.length - total, total);
          if (!bytesRead) throw Error();
          total += bytesRead;
        }
        const after = await handle.stat();
        if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) throw Error();
        return parseKey(this.#storage.decryptString(data));
      } finally { await handle.close(); }
    } catch {
      throw new ClaudeError('CLAUDE_KEY_READ', '저장된 Claude 연결 정보를 읽지 못했습니다. 키를 다시 연결해 주세요.');
    }
  }

  async #saveKey(key, signal) {
    this.#ensureStorage();
    const staged = this.#file + '.' + randomUUID() + '.tmp';
    try {
      await fs.mkdir(this.#directory, {recursive:true, mode:0o700});
      await fs.writeFile(staged, this.#storage.encryptString(key), {flag:'wx', mode:0o600});
      if (signal.aborted) throw changed();
      await fs.rename(staged, this.#file);
      if (signal.aborted) throw changed();
    } catch (error) {
      if (error instanceof ClaudeError) throw error;
      throw new ClaudeError('CLAUDE_KEY_SAVE', 'Claude API 키를 보안 저장소에 저장하지 못했습니다.');
    } finally { await fs.rm(staged, {force:true}).catch(() => {}); }
  }

  async #credential() {
    const generation = this.#generation.signal;
    await this.#queue;
    if (generation.aborted) throw changed();
    const key = await this.#readKey();
    if (generation.aborted) throw changed();
    return {key, generation};
  }

  async status() {
    const {key} = await this.#credential();
    return {configured:key !== null};
  }

  async configure(apiKey) {
    const key = parseKey(apiKey);
    this.#ensureStorage();
    const generation = this.#rotate();
    return this.#enqueue(async () => {
      const models = await this.#loadModels(key, generation);
      await this.#saveKey(key, generation);
      if (generation.aborted) throw changed();
      this.#catalog = {models, expires:this.#now() + 300000};
      return {configured:true, models:structuredClone(models)};
    });
  }

  disconnect() {
    this.#rotate();
    return this.#enqueue(async () => {
      try { await fs.rm(this.#file, {force:true}); }
      catch { throw new ClaudeError('CLAUDE_KEY_REMOVE', '저장된 Claude API 키를 삭제하지 못했습니다.'); }
      return {configured:false};
    });
  }

  async #request(endpoint, {key, generation, signal, body}, handle) {
    const timeout = AbortSignal.timeout(body ? this.#streamTimeout : this.#timeout);
    const combined = AbortSignal.any([generation, timeout, ...(signal ? [signal] : [])]);
    const assertActive = () => {
      if (generation.aborted) throw changed();
      if (signal?.aborted) throw new ClaudeError('CLAUDE_CANCELLED', 'Claude 요청을 취소했습니다.');
      if (timeout.aborted) throw new ClaudeError('CLAUDE_TIMEOUT', 'Claude가 제한 시간 안에 응답하지 않았습니다. 다시 시도해 주세요.');
    };
    try {
      assertActive();
      const response = await this.#fetch(apiOrigin + endpoint, {
        method:body ? 'POST' : 'GET',
        headers:{authorization:'Bearer ' + key, 'anthropic-version':apiVersion, ...(body && {'content-type':'application/json', accept:'text/event-stream'})},
        ...(body && {body}), redirect:'error', signal:combined,
      });
      assertActive();
      if (!response.ok) {
        const detail = await readJson(response).catch(() => null);
        throw failHttp(response.status, detail?.error);
      }
      const result = await handle(response, assertActive);
      assertActive();
      return result;
    } catch (error) {
      assertActive();
      if (error instanceof ClaudeError) throw error;
      throw new ClaudeError('CLAUDE_NETWORK', 'Claude에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    }
  }

  async #loadModels(key, generation, signal) {
    const rows = new Map();
    let preferred, firstActive, cursor;
    for (let page = 0; page < 10; page++) {
      const suffix = cursor ? '&after_id=' + encodeURIComponent(cursor) : '';
      const data = await this.#request('/v1/models?limit=100' + suffix, {key, generation, signal}, readJson);
      if (!Array.isArray(data?.data)) throw malformed();
      for (const raw of data.data) {
        const model = modelRow(raw);
        if (!model || rows.has(model.id)) continue;
        rows.set(model.id, model);
        if (raw.lifecycle !== 'deprecated') {
          firstActive ||= model;
          if (raw.line === 'sonnet') preferred ||= model;
        }
      }
      if (!data.has_more) {
        const models = [...rows.values()];
        if (!models.length) throw new ClaudeError('CLAUDE_MODELS_EMPTY', '이 Claude 계정에서 사용할 수 있는 모델이 없습니다.');
        (preferred || firstActive || models[0]).isDefault = true;
        return models;
      }
      if (!modelIdPattern.test(data.last_id ?? '') || data.last_id === cursor) throw malformed();
      cursor = data.last_id;
    }
    throw malformed();
  }

  async #models({key, generation}, {refresh, signal} = {}) {
    if (signal?.aborted) throw new ClaudeError('CLAUDE_CANCELLED', 'Claude 요청을 취소했습니다.');
    if (!key) throw new ClaudeError('CLAUDE_NOT_CONNECTED', '설정의 Claude 연결에서 API 키를 등록해 주세요.');
    if (!refresh && this.#catalog?.expires > this.#now()) return this.#catalog.models;
    const models = await this.#loadModels(key, generation, signal);
    if (generation.aborted) throw changed();
    this.#catalog = {models, expires:this.#now() + 300000};
    return models;
  }

  async listModels(options) {
    return structuredClone(await this.#models(await this.#credential(), options));
  }

  async generate({model, effort, messages, system, maxTokens, signal, onDelta, tools, toolChoice}) {
    if (!Array.isArray(messages) || messages.at(-1)?.role !== 'user') {
      throw new ClaudeError('CLAUDE_MESSAGES', 'Claude에 보낼 요청을 확인해 주세요.');
    }
    const credential = await this.#credential();
    const catalog = await this.#models(credential, {signal});
    const selected = model ? catalog.find(item => item.id === model) : catalog.find(item => item.isDefault);
    if (!selected) throw failHttp(404);
    if (effort && !selected.supportedReasoningEfforts.some(item => item.reasoningEffort === effort)) {
      throw new ClaudeError('CLAUDE_EFFORT_UNSUPPORTED', '선택한 Claude 모델에서 지원하는 추론 수준을 선택해 주세요.');
    }
    const requestedMax = Number.isSafeInteger(maxTokens) && maxTokens > 0 ? maxTokens : 16384;
    const reasoning = effort ? {
      output_config:{effort},
      ...(selected.supportsAdaptiveThinking && {thinking:{type:'adaptive'}}),
    } : {};
    const body = JSON.stringify({
      model:selected.id, max_tokens:Math.min(requestedMax, selected.maxOutputTokens ?? 65536),
      messages, stream:true, ...(system && {system}), ...reasoning,
      ...(tools?.length && {tools, ...(toolChoice && {tool_choice:toolChoice})}),
    });
    if (Buffer.byteLength(body, 'utf8') > maxRequestBytes) throw failHttp(413);
    return this.#request('/v1/messages', {...credential, signal, body},
      (response, assertActive) => collectAnswer(response, selected.id, onDelta, assertActive));
  }
}

module.exports = {ClaudeClient};
