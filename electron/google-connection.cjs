const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {createHash, randomBytes, randomUUID, timingSafeEqual} = require('node:crypto');
const {createGoogleReader} = require('./google-reader.cjs');

const authorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const revokeUrl = 'https://oauth2.googleapis.com/revoke';
const userInfoUrl = 'https://openidconnect.googleapis.com/v1/userinfo';
const requiredScopes = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];
const scopes = ['openid', 'email', ...requiredScopes];
const oauthFileLimit = 32768;
const encryptedFileLimit = 131072;
const callbackPath = '/oauth/google';
const callbackHeaders = {
  'content-type':'text/plain; charset=utf-8', 'cache-control':'no-store',
  'referrer-policy':'no-referrer', 'x-content-type-options':'nosniff',
};
const sha = value => createHash('sha256').update(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 &&
  !/[\x00-\x1f\x7f]/.test(value);

function parseClient(client) {
  if (!object(client) || typeof client.clientId !== 'string' || client.clientId.length > 300 ||
      !/^[\w-]+\.apps\.googleusercontent\.com$/.test(client.clientId) ||
      typeof client.clientSecret !== 'string' || client.clientSecret.length > 500 ||
      /[\x00-\x1f\x7f]/.test(client.clientSecret)) {
    throw Error('Google에서 내려받은 데스크톱 앱 OAuth 파일을 선택해 주세요.');
  }
  return {clientId:client.clientId,clientSecret:client.clientSecret};
}

function desktopClient(value) {
  if (!object(value) || Object.keys(value).length !== 1 || !object(value.installed)) {
    throw Error('Google에서 내려받은 데스크톱 앱 OAuth 파일을 선택해 주세요.');
  }
  const installed = value.installed;
  if (['access_token','refresh_token','private_key'].some(key => Object.hasOwn(installed,key))) {
    throw Error('계정 인증 자료 대신 데스크톱 앱 OAuth 파일을 선택해 주세요.');
  }
  return parseClient({clientId:installed.client_id,clientSecret:installed.client_secret ?? ''});
}

async function readLocal(file, limit) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw Error('파일 형식이나 크기를 확인해 주세요.');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) throw Error('선택한 파일이 변경됐습니다.');
    const bytes = Buffer.alloc(opened.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const {bytesRead} = await handle.read(bytes,total,bytes.length-total,total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total !== opened.size || (await handle.stat()).mtimeMs !== stat.mtimeMs) {
      throw Error('선택한 파일이 변경됐습니다.');
    }
    return bytes.subarray(0,total);
  } finally { await handle.close(); }
}

async function readJSON(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel().catch(() => {});
    throw Error('Google 응답이 너무 큽니다.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > limit) throw Error('Google 응답이 너무 큽니다.');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Error('Google에서 보낸 응답을 읽지 못했습니다.'); }
}

function registerGoogleConnection(register, {
  directory, secretStorage, openExternal, chooseClient, getContext,
  fetchImpl = fetch, now = Date.now, loginTimeout = 300000,
}) {
  let generation = 0, pending, lastNotice, refresh, changing = false;
  let contextAbort = new AbortController();

  function capture() {
    const owner = getContext();
    if (!owner) throw Error('화면 잠금을 해제한 뒤 다시 시도해 주세요.');
    return {owner,generation,signal:contextAbort.signal};
  }

  function current(stamp) {
    if (getContext() !== stamp.owner || stamp.generation !== generation) {
      throw Error('계정이나 화면 잠금 상태가 바뀌었습니다. 다시 시도해 주세요.');
    }
  }

  function storedPath(stamp) {
    return path.join(directory, 'oauth-google-' + sha(stamp.owner).digest('hex') + '.enc');
  }

  function canEncrypt() {
    return secretStorage.isEncryptionAvailable() && secretStorage.getSelectedStorageBackend?.() !== 'basic_text';
  }

  async function read(stamp) {
    let bytes;
    try { bytes = await readLocal(storedPath(stamp),encryptedFileLimit); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw Error('저장된 Google 연결 정보를 읽지 못했습니다.');
    }
    current(stamp);
    if (!canEncrypt()) throw Error('운영체제의 보안 저장소를 사용할 수 없습니다.');
    try {
      const data = JSON.parse(secretStorage.decryptString(bytes));
      if (data.version !== 1) throw Error();
      data.client = parseClient(data.client);
      if (data.tokens && (!nonempty(data.tokens.access) || !nonempty(data.tokens.refresh) ||
          !Number.isSafeInteger(data.tokens.expiresAt) || typeof data.tokens.email !== 'string' ||
          data.tokens.email.length > 320)) throw Error();
      return data;
    } catch { throw Error('저장된 Google 연결 정보를 읽지 못했습니다.'); }
  }

  async function save(stamp, record) {
    current(stamp);
    if (!canEncrypt()) throw Error('운영체제의 보안 저장소를 사용할 수 없습니다.');
    const destination = storedPath(stamp), staged = destination + '.' + randomUUID() + '.tmp';
    await fs.mkdir(directory,{recursive:true});
    try {
      await fs.writeFile(staged,secretStorage.encryptString(JSON.stringify({version:1,...record})),{flag:'wx',mode:0o600});
      current(stamp);
      await fs.rename(staged,destination);
      current(stamp);
    } finally { await fs.rm(staged,{force:true}); }
  }

  async function call(url, init, stamp, signal = stamp.signal) {
    current(stamp);
    let result;
    try {
      result = await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
    } catch {
      current(stamp);
      throw Error('Google에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    }
    if (stamp.generation !== generation || getContext() !== stamp.owner || signal.aborted) {
      await result.body?.cancel().catch(() => {});
      throw Error('Google 연결 상태가 바뀌었습니다.');
    }
    return result;
  }

  async function exchange(client, fields, stamp, signal, previous) {
    const reply = await call(tokenUrl,{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({...fields,client_id:client.clientId,
        ...(client.clientSecret && {client_secret:client.clientSecret})}),
    },stamp,signal);
    const data = await readJSON(reply,65536);
    current(stamp);
    if (!reply.ok) throw Error(data.error === 'invalid_grant'
      ? 'Google 로그인 권한이 만료됐습니다. 계정을 다시 연결해 주세요.'
      : 'Google이 로그인을 승인하지 않았습니다. 데스크톱 앱 OAuth 설정과 접근 권한을 확인해 주세요.');
    if (!nonempty(data.access_token) || !nonempty(data.refresh_token || previous?.refresh) ||
        !Number.isSafeInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 86400 ||
        String(data.token_type).toLowerCase() !== 'bearer') throw Error('Google 로그인 정보를 확인하지 못했습니다.');
    if ((!previous || data.scope !== undefined) &&
        !requiredScopes.every(scope => typeof data.scope === 'string' && data.scope.split(/\s+/).includes(scope))) {
      throw Error('메일과 캘린더의 읽기 권한을 모두 허용해 주세요.');
    }
    return {access:data.access_token,refresh:data.refresh_token || previous.refresh,
      expiresAt:now()+data.expires_in*1000,email:previous?.email || ''};
  }

  function close(attempt, abort = false) {
    if (pending !== attempt) return;
    pending = undefined;
    clearTimeout(attempt.timer);
    attempt.server.close();
    if (abort) {
      attempt.abort.abort();
      attempt.server.closeAllConnections();
    }
  }

  function invalidate() {
    generation++;
    contextAbort.abort();
    contextAbort = new AbortController();
    if (pending) close(pending,true);
    lastNotice = undefined;
  }

  async function status() {
    const stamp = capture();
    if (pending?.stamp.owner === stamp.owner) return {phase:'pending'};
    const record = await read(stamp);
    current(stamp);
    const notice = lastNotice?.owner === stamp.owner ? lastNotice.text : undefined;
    if (record?.tokens) return {phase:'connected',email:record.tokens.email,notice};
    return {phase:record ? 'ready' : 'unconfigured',notice};
  }

  async function begin() {
    if (pending) return status();
    invalidate();
    const stamp = capture(), record = await read(stamp);
    current(stamp);
    if (pending) return status();
    if (!record) throw Error('데스크톱 앱 OAuth 파일을 먼저 선택해 주세요.');
    const nonce = randomBytes(32).toString('hex'), verifier = randomBytes(48).toString('base64url');
    const attempt = {stamp,abort:new AbortController(),used:false};
    lastNotice = undefined;
    let redirect;
    attempt.server = http.createServer({requestTimeout:15000,headersTimeout:10000,maxHeaderSize:8192},async (req,res) => {
      let url;
      try {
        if (req.method === 'GET' && req.headers.host === new URL(redirect).host && req.url.length <= 4096) {
          url = new URL(req.url,redirect);
        }
      } catch {}
      const state = url?.searchParams.get('state') ?? '', got = Buffer.from(state);
      if (!url || url.origin !== new URL(redirect).origin || url.pathname !== callbackPath ||
          url.searchParams.getAll('state').length !== 1 ||
          got.length !== nonce.length || !timingSafeEqual(got,Buffer.from(nonce))) {
        res.writeHead(400,callbackHeaders).end('Google 로그인 요청을 확인해 주세요.');
        return;
      }
      if (attempt.used || pending !== attempt) {
        res.writeHead(409,callbackHeaders).end('이미 처리한 Flowrium 로그인입니다.');
        return;
      }
      attempt.used = true;
      try {
        current(stamp);
        const code = url.searchParams.get('code');
        if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1 || !nonempty(code)) {
          throw Error('Google 로그인이 취소됐거나 권한을 받지 못했습니다.');
        }
        const signal = attempt.abort.signal;
        const tokens = await exchange(record.client,{grant_type:'authorization_code',redirect_uri:redirect,
          code,code_verifier:verifier},stamp,signal);
        const user = await call(userInfoUrl,{headers:{authorization:'Bearer '+tokens.access}},stamp,signal);
        if (user.ok) {
          const {email} = await readJSON(user,65536);
          if (typeof email === 'string' && email.length <= 320) tokens.email = email;
        } else await user.body?.cancel().catch(() => {});
        if (pending !== attempt) throw Error('Google 연결 상태가 바뀌었습니다.');
        await save(stamp,{client:record.client,tokens});
        res.writeHead(200,callbackHeaders).end('Google 계정을 연결했습니다. Flowrium으로 돌아가세요.');
      } catch (error) {
        if (pending === attempt && getContext() === stamp.owner) {
          lastNotice = {owner:stamp.owner,text:error.message?.startsWith('Google') ||
            error.message?.startsWith('메일과 캘린더') ? error.message : 'Google 연결을 완료하지 못했습니다.'};
        }
        res.writeHead(400,callbackHeaders).end('Google 연결을 완료하지 못했습니다. Flowrium에서 확인해 주세요.');
      } finally { close(attempt); }
    });
    pending = attempt;
    const server = attempt.server;
    try {
      await new Promise((resolve,reject) => {
        server.once('error',reject);
        server.listen(0,'127.0.0.1',resolve);
      });
      current(stamp);
      redirect = 'http://127.0.0.1:' + server.address().port + callbackPath;
      attempt.timer = setTimeout(() => {
        if (pending !== attempt) return;
        lastNotice = {owner:stamp.owner,text:'Google 로그인 시간이 지났습니다. 다시 연결해 주세요.'};
        close(attempt,true);
      },loginTimeout);
      attempt.timer.unref();
      const search = new URLSearchParams({
        client_id:record.client.clientId,response_type:'code',redirect_uri:redirect,state:nonce,
        code_challenge:sha(verifier).digest('base64url'),code_challenge_method:'S256',
        scope:scopes.join(' '),access_type:'offline',prompt:'consent select_account',
      });
      await openExternal(authorizeUrl + '?' + search);
      return status();
    } catch {
      close(attempt,true);
      throw Error('브라우저에서 Google 로그인을 열지 못했습니다.');
    }
  }

  async function revoke(tokens, stamp) {
    if (!tokens) return;
    try {
      const result = await call(revokeUrl,{
        method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({token:tokens.refresh}),
      },stamp);
      await result.body?.cancel().catch(() => {});
    } catch {}
  }

  async function action(input) {
    if (!input || typeof input !== 'object' || Object.keys(input).length !== 1) throw Error('Google 연결 작업을 확인해 주세요.');
    if (input.action === 'console') {
      const stamp = capture();
      await openExternal('https://console.cloud.google.com/auth/clients');
      current(stamp);
      return status();
    }
    if (input.action === 'cancel') {
      invalidate();
      return status();
    }
    if (changing) throw Error('Google 연결 설정을 변경하고 있습니다.');
    if (input.action === 'connect') return begin();
    if (input.action !== 'configure' && input.action !== 'disconnect') throw Error('Google 연결 작업을 확인해 주세요.');
    changing = true;
    try {
      if (input.action === 'configure') {
        const selecting = capture();
        if (!canEncrypt()) throw Error('운영체제의 보안 저장소를 사용할 수 없습니다.');
        const chosen = await chooseClient();
        if (!chosen) return status();
        current(selecting);
        let client;
        try { client = desktopClient(JSON.parse((await readLocal(chosen,oauthFileLimit)).toString('utf8'))); }
        catch { throw Error('Google에서 내려받은 데스크톱 앱 OAuth 파일을 선택해 주세요.'); }
        current(selecting);
        const previous = await read(selecting);
        current(selecting);
        invalidate();
        const stamp = capture();
        await save(stamp,{client});
        if (previous?.tokens) await revoke(previous.tokens,stamp);
      } else {
        invalidate();
        const stamp = capture(), record = await read(stamp);
        if (record?.tokens) {
          await save(stamp,{client:record.client});
          await revoke(record.tokens,stamp);
        }
      }
      return status();
    } finally { changing = false; }
  }

  async function access(stamp, rejectedAccess) {
    if (pending) throw Error('진행 중인 Google 로그인을 마쳐 주세요.');
    const record = await read(stamp);
    current(stamp);
    if (!record?.tokens) throw Error('Google 계정을 먼저 연결해 주세요.');
    if (record.tokens.expiresAt > now()+60000 && record.tokens.access !== rejectedAccess) return record.tokens.access;
    if (refresh?.stamp.owner === stamp.owner && refresh.stamp.generation === stamp.generation) return refresh.flight;
    const attempt = {stamp};
    attempt.flight = (async () => {
      const tokens = await exchange(record.client,{grant_type:'refresh_token',refresh_token:record.tokens.refresh},
        stamp,stamp.signal,record.tokens);
      await save(stamp,{client:record.client,tokens});
      return tokens.access;
    })().finally(() => { if (refresh === attempt) refresh = undefined; });
    refresh = attempt;
    return attempt.flight;
  }

  async function googleGet(url, stamp, limit = 1024*1024) {
    const get = value => call(url,{headers:{authorization:'Bearer '+value}},stamp);
    const value = await access(stamp);
    let response = await get(value);
    if (response.status === 401) {
      await response.body?.cancel().catch(() => {});
      response = await get(await access(stamp,value));
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if ([401,403].includes(response.status)) throw Error('Google 메일이나 일정의 읽기 권한을 확인해 주세요. 필요한 경우 계정을 다시 연결하세요.');
      if (response.status === 404) throw Error('Google에서 선택한 자료를 찾지 못했습니다.');
      if (response.status === 429) throw Error('Google 조회 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      throw Error('Google 자료를 불러오지 못했습니다.');
    }
    const data = await readJSON(response,limit);
    current(stamp);
    return data;
  }

  const readData = createGoogleReader(googleGet,now);
  register('readGoogleConnection',status);
  register('googleConnectionAction',action);
  register('readGoogleData',async input => {
    const stamp = capture(), result = await readData(input,stamp);
    current(stamp);
    return result;
  });
  return {invalidate};
}

module.exports = {registerGoogleConnection,desktopClient};
