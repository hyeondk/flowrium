const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { StringDecoder } = require('node:string_decoder');
const { parseArchive } = require('./installer-support.cjs');

const run = promisify(execFile);
const CHUNK_SIZE = 64 * 1024;
const MAX_MARKER_FILE = 1024 * 1024;
const MAX_PACKAGE_FILE = 4 * 1024 * 1024;
const SOURCES = ['git', 'asar', 'resources', 'source'];
const APP_ROOTS = new Set(['dist', 'electron', 'assets', 'package.json', 'node_modules']);
const SENSITIVE_SEGMENTS = new Set([
  '.flowrium', '.codex', 'codex-source', 'codex-transfers', 'composer-drafts',
  'migration-records', 'personal-memory',
]);
const TEXT_EXTENSION = /\.(?:[cm]?jsx?|tsx?|jsonl?|html?|css|md|txt|ya?ml|toml|xml|svg|sh|ps1|cmd|bat|csv|sql|map|ini|conf|config|log)$/i;

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\') &&
    !value.startsWith('/') && !/[:\x00-\x1f\x7f]/.test(value) &&
    !value.split('/').some(part => !part || part === '.' || part === '..');
}

// 경로를 검사한다. 소스 코드에 적힌 경로 예시나 합성 검사 문자열은 검사 대상 경로가 아니다.
function sensitivePath(value) {
  const parts = value.replaceAll('\\', '/').toLowerCase().split('/');
  if (parts.some(part => SENSITIVE_SEGMENTS.has(part) || part === '.git')) return true;
  const name = parts.at(-1);
  if (/^(?:auth|credentials)\.json$/.test(name) || /^deploy_key(?:\..*)?$/.test(name)) return true;
  if (/^\.env(?:\..*)?$/.test(name) && name !== '.env.example') return true;
  if (/\.(?:sqlite(?:3)?|db)(?:-(?:wal|shm))?$/.test(name)) return true;
  if (['state.json', 'workspace.json', 'settings.json'].includes(name)) {
    return parts.length === 1 || parts.slice(0, -1).some(part => /^(?:profiles?|userdata|sessions?|conversations?)$/.test(part));
  }
  return false;
}

function percentCase(value) {
  return value.replace(/%[0-9a-f]{2}/gi, item => item.toLowerCase());
}

function markerVariants(value) {
  const forms = new Set();
  for (const normalized of [value, value.normalize('NFC'), value.normalize('NFD')]) {
    for (const representation of [normalized, JSON.stringify(normalized).slice(1, -1), encodeURI(normalized), encodeURIComponent(normalized)]) {
      forms.add(percentCase(representation));
    }
  }
  return [...forms];
}

function prepareMarkers(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).some(key => !['paths', 'threadIds', 'snippets'].includes(key))) throw Error('마커 형식');
  const values = [];
  for (const category of ['paths', 'threadIds', 'snippets']) {
    if (data[category] === undefined) continue;
    if (!Array.isArray(data[category])) throw Error('마커 형식');
    for (const value of data[category]) {
      if (typeof value !== 'string' || value.length < 8 || value.length > 16384 || value.includes('\0')) throw Error('마커 형식');
      values.push(value);
    }
  }
  const unique = [...new Set(values)];
  if (!unique.length || unique.length > 256 || unique.reduce((sum, value) => sum + value.length, 0) > 262144) throw Error('마커 크기');
  const variants = unique.map(markerVariants);
  const escapedLength = Math.max(...unique.map(value => value.normalize('NFD').length * 6));
  return { variants, count: unique.length, tailLength: Math.max(escapedLength, ...variants.flat().map(value => value.length)) + 32 };
}

class Matcher {
  constructor(markers) {
    this.markers = markers;
    this.decoder = new StringDecoder('utf8');
    this.tail = '';
    this.found = new Set();
  }
  text(value) {
    if (!this.markers || !value) return;
    const combined = this.tail + value;
    const representations = [...new Set([combined, combined.normalize('NFC'), combined.normalize('NFD')].map(percentCase))];
    // JSON의 유니코드 이스케이프도 풀어서 검사한다. 해석 결과는 외부로 내보내지 않는다.
    if (/\\u[0-9a-f]{4}/i.test(combined)) {
      const decoded = combined.replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
      representations.push(percentCase(decoded.normalize('NFC')), percentCase(decoded.normalize('NFD')));
    }
    this.markers.variants.forEach((variants, index) => {
      if (!this.found.has(index) && variants.some(form => representations.some(text => text.includes(form)))) this.found.add(index);
    });
    this.tail = combined.slice(-this.markers.tailLength);
  }
  write(buffer) { this.text(this.decoder.write(buffer)); }
  end() { this.text(this.decoder.end()); return this.found.size; }
}

function buildPolicy(pkg) {
  const build = pkg && pkg.build;
  if (!build || !Array.isArray(build.files) || !build.files.length) return false;
  let positive = false;
  for (const entry of build.files) {
    if (typeof entry !== 'string') return false;
    if (entry.startsWith('!')) continue;
    positive = true;
    if (entry !== 'package.json' && !/^(?:dist|electron|assets)\//.test(entry)) return false;
    if (entry.includes('..') || entry.includes('\\') || sensitivePath(entry)) return false;
  }
  if (build.extraResources !== undefined && !Array.isArray(build.extraResources)) return false;
  for (const entry of build.extraResources || []) {
    const from = typeof entry === 'string' ? entry : entry && entry.from;
    if (typeof from !== 'string') return false;
    // 배포용 런타임만 예외로 허용한다. 같은 임시 폴더의 다른 자료는 포함할 수 없다.
    if (from !== '.flowrium-tmp/runtime' && !/^(?:assets|electron\/native)\//.test(from)) return false;
    if (from.includes('..') || from.includes('\\') || sensitivePath(from)) return false;
  }
  return positive;
}

function reportTemplate(markers) {
  return {
    ok: false,
    checked: Object.fromEntries(SOURCES.map(source => [source, 0])),
    findings: { sensitivePaths: 0, markerPaths: 0, markerFiles: 0, markerMatches: 0, unsafeEntries: 0, unreadable: 0, buildPolicy: 0, archivePolicy: 0 },
    markers: markers ? markers.count : 0,
    skippedVendorBinaries: 0,
  };
}

function pathCheck(relative, report, markers) {
  if (!safeRelative(relative)) { report.findings.unsafeEntries++; return false; }
  if (sensitivePath(relative)) report.findings.sensitivePaths++;
  if (markers) {
    const matcher = new Matcher(markers);
    matcher.text(relative);
    if (matcher.end()) report.findings.markerPaths++;
  }
  return true;
}

function contentResult(matcher, report) {
  const found = matcher.end();
  if (found) { report.findings.markerFiles++; report.findings.markerMatches += found; }
}

function vendorBinary(relative, size, sample) {
  return size > 8 * 1024 * 1024 && /(?:^|\/)(?:node_modules|runtime)\//.test(relative) &&
    !TEXT_EXTENSION.test(relative) && sample.includes(0);
}

async function checkStream(stream, relative, size, report, markers, policy) {
  if (!markers && !policy) { stream.destroy(); return; }
  const matcher = new Matcher(markers);
  const packageParts = [];
  let first = true, read = 0;
  try {
    for await (const chunk of stream) {
      if (first && !policy && vendorBinary(relative, size, chunk.subarray(0, 8192))) {
        report.skippedVendorBinaries++;
        stream.destroy();
        return;
      }
      first = false;
      read += chunk.length;
      if (policy && read > MAX_PACKAGE_FILE) throw Error('정책 크기');
      if (policy) packageParts.push(chunk);
      if (markers) matcher.write(chunk);
    }
    if (read !== size) throw Error('크기 불일치');
    if (markers) contentResult(matcher, report);
    if (policy) {
      const pkg = JSON.parse(Buffer.concat(packageParts).toString('utf8'));
      // 앱 패키징 도구는 build 필드를 제거한다. 완성 앱은 실제 파일 루트도 별도로 검사한다.
      const valid = policy === 'app'
        ? pkg.name === 'flowrium' && typeof pkg.version === 'string' && (pkg.build === undefined || buildPolicy(pkg))
        : buildPolicy(pkg);
      if (!valid) report.findings.buildPolicy++;
    }
  } catch { report.findings.unreadable++; }
}

async function checkFile(file, relative, source, report, markers, policy = false, boundary) {
  report.checked[source]++;
  if (!pathCheck(relative, report, markers)) return;
  try {
    const stat = await fsp.lstat(file);
    if (!stat.isFile()) { report.findings.unsafeEntries++; return; }
    if (boundary && !(await fsp.realpath(file)).startsWith(boundary + path.sep)) { report.findings.unsafeEntries++; return; }
    if (!markers && !policy) return;
    await checkStream(fs.createReadStream(file, { highWaterMark: CHUNK_SIZE }), relative, stat.size, report, markers, policy);
  } catch { report.findings.unreadable++; }
}

async function scanGit(root, report, markers) {
  try {
    const boundary = await fsp.realpath(root);
    const { stdout } = await run('git', ['ls-files', '--cached', '-z'], { cwd: root, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    const names = stdout.toString('utf8').split('\0').filter(Boolean);
    if (!names.includes('package.json')) report.findings.buildPolicy++;
    for (const relative of names) {
      if (!safeRelative(relative)) { report.findings.unsafeEntries++; continue; }
      await checkFile(path.join(root, relative), relative, 'git', report, markers, relative === 'package.json', boundary);
    }
    if (names.includes('scripts/prepare-release-assets.mjs')) {
      const source = await fsp.readFile(path.join(root, 'scripts/prepare-release-assets.mjs'), 'utf8');
      if (!/spawn\(\s*['"]git['"]\s*,\s*\[\s*['"]archive['"]/.test(source) || !source.includes("['status','--porcelain'")) report.findings.archivePolicy++;
    }
  } catch { report.findings.unreadable++; }
}

async function scanAsar(file, resources, report, markers) {
  try {
    if (!(await fsp.realpath(file)).startsWith(resources + path.sep) || !(await fsp.lstat(file)).isFile()) throw Error('묶음 경계');
    const handle = await fsp.open(file, 'r');
    try {
      const prefix = Buffer.alloc(8);
      if ((await handle.read(prefix, 0, 8, 0)).bytesRead !== 8 || prefix.readUInt32LE(4) > 64 * 1024 * 1024) throw Error('묶음 헤더 크기');
    } finally { await handle.close(); }
    const asar = require('@electron/asar');
    const { header, headerSize } = asar.getRawHeader(file);
    const archiveSize = (await fsp.stat(file)).size;
    if (!header || !header.files || !Number.isSafeInteger(headerSize) || headerSize < 0) throw Error('묶음 형식');
    let hasPackage = false;
    async function visit(entries, prefix = '') {
      for (const [name, entry] of Object.entries(entries)) {
        const relative = prefix + name;
        if (!pathCheck(relative, report, markers)) continue;
        if (!prefix && !APP_ROOTS.has(name)) report.findings.buildPolicy++;
        if (entry.files) { await visit(entry.files, relative + '/'); continue; }
        report.checked.asar++;
        if (entry.link !== undefined) {
          if (!safeRelative(entry.link)) report.findings.unsafeEntries++;
          else pathCheck(entry.link, report, markers);
          continue;
        }
        const policy = relative === 'package.json' ? 'app' : false;
        hasPackage ||= !!policy;
        if (!Number.isSafeInteger(entry.size) || entry.size < 0) { report.findings.unsafeEntries++; continue; }
        if (entry.unpacked) {
          await checkFile(path.join(resources, 'app.asar.unpacked', relative), relative, 'resources', report, markers, policy, resources);
          continue;
        }
        const offset = Number(entry.offset), start = 8 + headerSize + offset;
        if (!/^(?:0|[1-9]\d*)$/.test(String(entry.offset)) || !Number.isSafeInteger(start) || start < 8 + headerSize || start + entry.size > archiveSize) { report.findings.unsafeEntries++; continue; }
        if (!entry.size) {
          if (policy) report.findings.buildPolicy++;
          continue;
        }
        if (markers || policy) await checkStream(fs.createReadStream(file, { start, end: start + entry.size - 1, highWaterMark: CHUNK_SIZE }), relative, entry.size, report, markers, policy);
      }
    }
    await visit(header.files);
    if (!hasPackage) report.findings.buildPolicy++;
  } catch { report.findings.unreadable++; }
}

async function scanResources(resources, report, markers) {
  try {
    const base = await fsp.realpath(resources);
    const archive = path.join(base, 'app.asar');
    await scanAsar(archive, base, report, markers);
    async function walk(folder, prefix = '') {
      for (const entry of await fsp.readdir(folder, { withFileTypes: true })) {
        const relative = prefix + entry.name;
        if (relative === 'app.asar') continue;
        if (!pathCheck(relative, report, markers)) continue;
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) await walk(file, relative + '/');
        else if (entry.isSymbolicLink()) {
          // 런타임의 내부 링크는 원본 파일에서 검사한다. 경계 밖 링크는 읽지 않는다.
          const resolved = await fsp.realpath(file);
          if (!resolved.startsWith(base + path.sep)) report.findings.unsafeEntries++;
          else {
            const target = path.relative(base, resolved).split(path.sep).join('/');
            pathCheck(target, report, markers);
          }
        } else await checkFile(file, relative, 'resources', report, markers, false, base);
      }
    }
    await walk(base);
  } catch { report.findings.unreadable++; }
}

async function scanSource(file, report, markers) {
  try {
    if ((await fsp.stat(file)).size > 64 * 1024 * 1024) throw Error('소스 크기');
    const { root, entries } = parseArchive(await fsp.readFile(file));
    pathCheck(root, report, markers);
    let hasPackage = false;
    for (const entry of entries) {
      if (entry.name === root) continue;
      const relative = entry.name.slice(root.length + 1);
      if (!pathCheck(relative, report, markers) || entry.directory) continue;
      report.checked.source++;
      if (markers) {
        const matcher = new Matcher(markers);
        for (let at = 0; at < entry.body.length; at += CHUNK_SIZE) matcher.write(entry.body.subarray(at, at + CHUNK_SIZE));
        contentResult(matcher, report);
      }
      if (relative === 'package.json') {
        hasPackage = true;
        if (entry.body.length > MAX_PACKAGE_FILE) throw Error('정책 크기');
        if (!buildPolicy(JSON.parse(entry.body.toString('utf8')))) report.findings.buildPolicy++;
      }
    }
    if (!hasPackage) report.findings.buildPolicy++;
  } catch { report.findings.unreadable++; }
}

async function verify(options = {}) {
  let markers;
  if (options.markers) {
    try {
      if ((await fsp.stat(options.markers)).size > MAX_MARKER_FILE) throw Error('마커 크기');
      markers = prepareMarkers(JSON.parse(await fsp.readFile(options.markers, 'utf8')));
    } catch {
      return { ...reportTemplate(), findings: { ...reportTemplate().findings, unreadable: 1 } };
    }
  }
  const report = reportTemplate(markers);
  if (options.git !== false) await scanGit(path.resolve(options.root || process.cwd()), report, markers);
  if (options.resources) await scanResources(path.resolve(options.resources), report, markers);
  if (options.source) await scanSource(path.resolve(options.source), report, markers);
  if (options.git === false && !options.resources && !options.source) report.findings.unreadable++;
  report.ok = Object.values(report.findings).every(count => count === 0);
  return report;
}

function argumentsFor(argv) {
  const options = { git: true };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--git') options.git = true;
    else if (argument === '--no-git') options.git = false;
    else if (['--root', '--resources', '--source', '--markers'].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw Error('검증 옵션');
      options[argument.slice(2)] = value;
    } else throw Error('검증 옵션');
  }
  return options;
}

module.exports = { verify, prepareMarkers, sensitivePath, buildPolicy, Matcher, argumentsFor };
if (require.main === module) {
  (async () => {
    const report = await verify(argumentsFor(process.argv.slice(2)));
    console.log(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  })().catch(() => {
    console.error('배포 개인정보 검증을 완료하지 못했습니다. 옵션과 입력 자료를 확인해 주세요.');
    process.exitCode = 1;
  });
}
