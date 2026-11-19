const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { relativePath } = require('./path-boundary.cjs');

const HEADER_BYTES = 64 * 1024;
const TAIL_BYTES = 1024 * 1024;
const EVENT_BYTES = 32 * 1024;
const THREAD_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const TOKEN_COUNT = Buffer.from('"token_count"');
const RECORDED_DIRS = new Set(['sessions', 'archived_sessions']);

function windowsPathAlias(value) {
  const prefix = /^\\\\[?.]\\/.exec(value);
  if (!prefix) return value;
  const target = value.slice(prefix[0].length);
  let conventional;
  if (/^[A-Z]:\\/i.test(target)) conventional = target;
  if (/^UNC\\[^\\]+\\[^\\]+(?:\\|$)/i.test(target)) conventional = '\\\\' + target.slice(4);
  // Extended paths can preserve trailing dots and spaces. Only change the
  // spelling used for comparisons if it can name the same ordinary file.
  if (!conventional || conventional.split('\\').some(part => /[. ]$/.test(part))) return value;
  return conventional;
}

function relativeRolloutPath(from, to, platform = process.platform) {
  if (platform === 'win32') return path.win32.relative(windowsPathAlias(from), windowsPathAlias(to));
  return relativePath(from, to, platform);
}

function sameRolloutPath(from, to) {
  return relativeRolloutPath(from, to) === '';
}

function parseRecord(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function counter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function contextFromRecord(record) {
  if (record?.type !== 'event_msg' || record.payload?.type !== 'token_count') return null;
  const info = record.payload.info;
  const at = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
  const last = info?.last_token_usage;
  const max = info?.model_context_window;
  const total = info?.total_token_usage?.total_tokens;
  if (!Number.isFinite(at) || !counter(last?.input_tokens) || !counter(last?.output_tokens) || !counter(max) || !max || !counter(total)) return null;
  const used = last.input_tokens + last.output_tokens;
  if (!counter(used)) return null;
  return { used, total, max, percent: Math.min(100, Math.round(used / max * 100)), updatedAt: new Date(at).toISOString() };
}

function lastContext(tail, start) {
  const firstComplete = start === 0 ? 0 : tail.indexOf(10) + 1;
  if (start > 0 && firstComplete === 0) return null;
  // A writer may still be appending the last record. Only parse complete lines.
  let end = tail.lastIndexOf(10);
  while (end >= firstComplete) {
    const beginning = end > 0 ? tail.lastIndexOf(10, end - 1) + 1 : 0;
    if (beginning < firstComplete) return null;
    const line = tail.subarray(beginning, end);
    if (line.length <= EVENT_BYTES && line.includes(TOKEN_COUNT)) {
      const context = contextFromRecord(parseRecord(line));
      if (context) return context;
    }
    end = beginning - 1;
  }
  return null;
}

async function readBytes(handle, length, position) {
  const result = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(result, offset, length - offset, position + offset);
    if (bytesRead === 0) return null;
    offset += bytesRead;
  }
  return result;
}

function sameFile(first, second) {
  return first.dev === second.dev && first.ino === second.ino;
}

async function readCodexRolloutContext({ threadId, rolloutPath, cwd, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex') }) {
  if (typeof threadId !== 'string' || !THREAD_ID.test(threadId) || typeof rolloutPath !== 'string' || typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  let handle;
  try {
    const file = rolloutPath.startsWith('file:') ? fileURLToPath(rolloutPath) : rolloutPath;
    const filename = path.basename(file);
    if (!path.isAbsolute(file) || !filename.startsWith('rollout-') || !filename.endsWith(`-${threadId}.jsonl`)) return null;
    const realHome = await fs.realpath(codexHome);
    const real = await fs.realpath(file);
    const relative = relativeRolloutPath(realHome, real);
    const directory = relative.split(path.sep)[0];
    if (!RECORDED_DIRS.has(process.platform === 'win32' ? directory.toLowerCase() : directory)) return null;
    // Permit the configured home itself to be a filesystem alias. Reject links inside it.
    if (!sameRolloutPath(file, real) && !sameRolloutPath(file, path.join(codexHome, relative))) return null;
    const before = await fs.lstat(file);
    if (!before.isFile() || before.size === 0) return null;
    handle = await fs.open(real, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(before, opened) || opened.size < before.size) return null;

    const header = await readBytes(handle, Math.min(HEADER_BYTES, opened.size), 0);
    const headerEnd = header?.indexOf(10) ?? -1;
    if (headerEnd < 0) return null;
    const meta = parseRecord(header.subarray(0, headerEnd));
    if (meta?.type !== 'session_meta' || meta.payload?.id !== threadId || typeof meta.payload.cwd !== 'string') return null;
    const recordedCwd = meta.payload.cwd.startsWith('file:') ? fileURLToPath(meta.payload.cwd) : meta.payload.cwd;
    if (!path.isAbsolute(recordedCwd) || !sameRolloutPath(recordedCwd, cwd)) return null;

    const start = Math.max(0, opened.size - TAIL_BYTES);
    const tail = start === 0 && header.length === opened.size ? header : await readBytes(handle, opened.size - start, start);
    if (!tail) return null;
    const after = await handle.stat();
    if (after.size < opened.size || (after.size === opened.size && after.mtimeMs !== opened.mtimeMs)) return null;
    if (!sameFile(opened, await fs.lstat(file)) || !sameRolloutPath(real, await fs.realpath(file))) return null;
    return lastContext(tail, start);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

module.exports = { readCodexRolloutContext, relativeRolloutPath };
