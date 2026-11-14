const fs = require("node:fs/promises"),
  path = require("node:path"),
  http = require("node:http"),
  { randomBytes, createHash, randomUUID } = require("node:crypto");
const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];
function registerIntegrations(
  register,
  store,
  { directory, secretStorage, openExternal, fetchImpl = fetch, publicOAuthClient },
) {
  const file = path.join(directory, "google.enc");
  const publishedClient=require("./google-client.cjs").publishedGoogleClient(publicOAuthClient);
  let generation = 0;
  let googleTools;
  function current(expected) {
    if (expected !== generation)
      throw Error("Google 연결 설정이 바뀌었습니다. 다시 조회해 주세요.");
  }
  let data,
    auth,
    queue = Promise.resolve();
  async function load() {
    if (data) return data;
    try {
      data = JSON.parse(secretStorage.decryptString(await fs.readFile(file)));
    } catch (e) {
      if (e.code !== "ENOENT")
        throw Error(
          "연동 설정을 읽지 못했습니다. 운영체제의 보안 저장소를 확인해 주세요.",
        );
      data = {};
    }
    if(!data.clientId&&publishedClient)data={...data,...publishedClient};
    return data;
  }
  async function persist(value, expected = generation) {
    current(expected);
    if (!secretStorage.isEncryptionAvailable())
      throw Error("운영체제의 보안 저장소를 사용할 수 없습니다.");
    const next = JSON.parse(JSON.stringify(value)),
      p = queue
        .catch(() => {})
        .then(async () => {
          current(expected);
          await fs.mkdir(directory, { recursive: true });
          const tmp = file + "." + randomUUID() + ".tmp";
          try {
            await fs.writeFile(
              tmp,
              secretStorage.encryptString(JSON.stringify(next)),
              { mode: 0o600 },
            );
            current(expected);
            await fs.rename(tmp, file);
            data = next;
          } finally {
            await fs.rm(tmp, { force: true });
          }
        });
    queue = p;
    await p;
  }
  const state = async () => {
    const v = await load();
    return {
      configured: !!v.clientId,
      connected: !!v.refreshToken,
      account: v.email,
      authorizing: !!auth,
      ...(v.refreshToken && { calendarWrite: Array.isArray(v.scopes) && v.scopes.includes("https://www.googleapis.com/auth/calendar.events") }),
      ...(v.refreshToken && { mailSend: Array.isArray(v.scopes) && v.scopes.includes("https://www.googleapis.com/auth/gmail.send") }),
    };
  };
  async function request(url, options = {}) {
    const r = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) {
      let message;
      try {
        message = (await r.json()).error?.message;
      } catch {}
      throw Error(
        message || "Google 요청을 처리하지 못했습니다. (" + r.status + ")",
      );
    }
    return r;
  }
  async function token() {
    const expected = generation;
    const v = await load();
    current(expected);
    if (!v.refreshToken) throw Error("먼저 Google 계정을 연결해 주세요.");
    if (v.accessToken && v.expiresAt > Date.now() + 60000) return v.accessToken;
    const r = await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: v.clientId,
        client_secret: v.clientSecret || "",
        refresh_token: v.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const t = await r.json();
    await persist(
      {
        ...v,
        accessToken: t.access_token,
        expiresAt: Date.now() + Number(t.expires_in || 3600) * 1000,
      },
      expected,
    );
    return t.access_token;
  }
  async function get(url) {
    const expected = generation;
    const access = await token();
    current(expected);
    const value = await (
      await request(url, { headers: { Authorization: "Bearer " + access } })
    ).json();
    current(expected);
    return value;
  }
  register("openGoogleItem", (url) => {
    const target = new URL(url);
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      ![
        "calendar.google.com",
        "www.google.com",
        "drive.google.com",
        "docs.google.com",
        "mail.google.com",
      ].includes(target.hostname)
    )
      throw Error("Google 자료 주소를 확인해 주세요.");
    return openExternal(target.href);
  });
  register("googleStatus", state);
  register("configureGoogle", async (input) => {
    if (
      !input ||
      typeof input.clientId !== "string" ||
      !input.clientId.endsWith(".apps.googleusercontent.com") ||
      input.clientId.length > 300 ||
      typeof input.clientSecret !== "string" ||
      input.clientSecret.length > 500
    )
      throw Error(
        "Google 데스크톱 앱의 OAuth 클라이언트 정보를 확인해 주세요.",
      );
    if (auth)
      throw Error("진행 중인 로그인 창을 마친 뒤 설정을 변경해 주세요.");
    generation++;
    googleTools?.clear();
    await persist({
      clientId: input.clientId.trim(),
      clientSecret: input.clientSecret.trim(),
    });
    return state();
  });
  register("connectGoogle", async () => {
    if (auth)
      throw Error("브라우저에서 진행 중인 Google 로그인을 마쳐 주세요.");
    const expected = generation;
    const attempt = {};
    auth = attempt;
    try {
      const v = await load();
      current(expected);
      if (!v.clientId)
        throw Error(
          "설정에 데스크톱 앱 OAuth 클라이언트를 먼저 등록해 주세요.",
        );
      const verifier = randomBytes(48).toString("base64url"),
        nonce = randomBytes(32).toString("hex");
      let redirect;
      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, "http://127.0.0.1");
        if (
          req.method !== "GET" ||
          u.pathname !== "/callback" ||
          u.searchParams.get("state") !== nonce ||
          req.headers.host !== "127.0.0.1:" + server.address().port
        ) {
          res.writeHead(400).end("Invalid request");
          return;
        }
        try {
          current(expected);
          if (!u.searchParams.get("code"))
            throw Error("Google 로그인이 취소됐습니다.");
          const r = await request("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: v.clientId,
              client_secret: v.clientSecret || "",
              code: u.searchParams.get("code"),
              code_verifier: verifier,
              grant_type: "authorization_code",
              redirect_uri: redirect,
            }),
          });
          const t = await r.json();
          if (!t.refresh_token)
            throw Error(
              "Google의 오프라인 접근 권한을 받지 못했습니다. 권한 화면에서 다시 연결해 주세요.",
            );
          const identity = await (
            await request("https://openidconnect.googleapis.com/v1/userinfo", {
              headers: { Authorization: "Bearer " + t.access_token },
            })
          ).json();
          await persist(
            {
              ...v,
              refreshToken: t.refresh_token,
              accessToken: t.access_token,
              expiresAt: Date.now() + t.expires_in * 1000,
              email: identity.email,
              scopes: typeof t.scope === "string" ? t.scope.split(/\s+/) : [...scopes],
            },
            expected,
          );
          res
            .writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy":
                "default-src 'none'; style-src 'unsafe-inline'",
            })
            .end(
              "<html lang=ko><meta charset=utf-8><title>Flowrium 계정 연결</title><p>Google 계정이 연결됐습니다. Flowrium에서 연결 확인을 눌러 주세요.</p></html>",
            );
        } catch (e) {
          res
            .writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
            .end(
              "Google 연결을 마치지 못했습니다. Flowrium 설정에서 다시 시도해 주세요.",
            );
        } finally {
          if (auth?.server === server) {
            clearTimeout(auth.timer);
            auth = null;
          }
          server.close();
        }
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      redirect = "http://127.0.0.1:" + server.address().port + "/callback";
      const timer = setTimeout(() => {
        generation++;
        server.close();
        auth = null;
      }, 180000);
      timer.unref();
      if (generation !== expected || auth !== attempt) {
        clearTimeout(timer);
        server.close();
        throw Error("Google 연결이 취소됐습니다.");
      }
      Object.assign(attempt, { server, timer });
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.search = new URLSearchParams({
        client_id: v.clientId,
        redirect_uri: redirect,
        response_type: "code",
        scope: scopes.join(" "),
        state: nonce,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent select_account",
      }).toString();
      await openExternal(u.href);
    } catch (error) {
      if (auth === attempt) auth = null;
      clearTimeout(attempt.timer);
      attempt.server?.close();
      throw error;
    }
  });
  register("disconnectGoogle", async () => {
    generation++;
    googleTools?.clear();
    if (auth) {
      clearTimeout(auth.timer);
      auth.server?.close();
      auth = null;
    }
    const v = await load();
    await persist({ clientId: v.clientId, clientSecret: v.clientSecret });
    if (v.refreshToken)
      await fetchImpl("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        body: new URLSearchParams({ token: v.refreshToken }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});
  });
  register("readGoogle", async (input) => {
    if (
      !input ||
      !["calendar", "drive", "mail"].includes(input.kind) ||
      typeof (input.query || "") !== "string" ||
      (input.query || "").length > 1000
    )
      throw Error("연동 자료 조회 조건을 확인해 주세요.");
    const query = input.query || "";
    if (input.kind === "calendar") {
      const from = input.from || new Date().toISOString(),
        to = input.to || new Date(Date.now() + 7 * 86400000).toISOString();
      if (
        !Number.isFinite(Date.parse(from)) ||
        !Number.isFinite(Date.parse(to)) ||
        Date.parse(to) <= Date.parse(from)
      )
        throw Error("일정 조회 기간을 확인해 주세요.");
      const q = new URLSearchParams({
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "100",
        q: query,
      });
      const value = await get(
        "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(input.calendarId || "primary") + "/events?" + q,
      );
      return (value.items || []).map((e) => ({
        id: e.id,
        title: e.summary || "제목 없음",
        detail: [e.location, e.description]
          .filter(Boolean)
          .join(" / ")
          .slice(0, 2500),
        url: e.htmlLink,
        at: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        etag: e.etag,
        calendarId: input.calendarId || "primary",
        description: e.description || "",
        location: e.location || "",
      }));
    }
    if (input.kind === "drive") {
      const q = new URLSearchParams({
        pageSize: "60",
        fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
        orderBy: "modifiedTime desc",
        q:
          "trashed=false" +
          (query
            ? " and name contains '" +
              query.replace(/\\/g, "\\\\").replace(/'/g, "\\'") +
              "'"
            : ""),
      });
      const value = await get("https://www.googleapis.com/drive/v3/files?" + q);
      return (value.files || []).map((e) => ({
        id: e.id,
        title: e.name,
        detail: e.mimeType,
        url: e.webViewLink,
        at: e.modifiedTime,
        mimeType: e.mimeType,
      }));
    }
    const list = await get(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?" +
        new URLSearchParams({ maxResults: "20", q: query }),
    );
    return Promise.all(
      (list.messages || []).map(async (e) => {
        const v = await get(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/" +
            encodeURIComponent(e.id) +
            "?format=metadata&metadataHeaders=Subject&metadataHeaders=From",
        );
        const header = (n) =>
          v.payload?.headers?.find(
            (h) => h.name.toLowerCase() === n.toLowerCase(),
          )?.value;
        return {
          id: e.id,
          title: header("Subject") || "제목 없음",
          detail: [header("From"), v.snippet].filter(Boolean).join(" / "),
          from: header("From"),
          at: new Date(Number(v.internalDate)).toISOString(),
          url: "https://mail.google.com/mail/u/0/#inbox/" + e.id,
        };
      }),
    );
  });
  register("importGoogleDocument", async (projectId, id) => {
    const project = store.project(projectId);
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{5,200}$/.test(id))
      throw Error("문서를 확인해 주세요.");
    const meta = await get(
      "https://www.googleapis.com/drive/v3/files/" +
        id +
        "?fields=id,name,mimeType",
    );
    const googleDoc = meta.mimeType === "application/vnd.google-apps.document";
    if (!googleDoc && !/^text\//.test(meta.mimeType))
      throw Error("Google 문서와 텍스트 파일을 가져올 수 있습니다.");
    const endpoint =
      "https://www.googleapis.com/drive/v3/files/" +
      id +
      (googleDoc ? "/export?mimeType=text%2Fplain" : "?alt=media");
    const access = await token(),
      response = await request(endpoint, {
        headers: { Authorization: "Bearer " + access },
      });
    let bytes = 0,
      content = [];
    for await (const part of response.body) {
      bytes += part.length;
      if (bytes > 5 * 1024 * 1024) throw Error("문서 크기가 5MB를 초과합니다.");
      content.push(part);
    }
    const root = await fs.realpath(project.path);
    if (path.resolve(root) !== path.resolve(project.path))
      throw Error(
        "프로젝트 폴더의 실제 위치가 바뀌었습니다. 다시 연결해 주세요.",
      );
    const metadataDirectory = path.join(root, ".flowrium");
    const { readJSON, projectDirectory } = require("./project-store.cjs");
    await projectDirectory(metadataDirectory);
    if (
      (await readJSON(path.join(metadataDirectory, "project.json"))).id !==
      project.id
    )
      throw Error("프로젝트 식별자가 바뀌었습니다.");
    const folder = path.join(root, "산출물");
    await projectDirectory(folder);
    const name =
        (meta.name || "Google 문서")
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
          .slice(0, 90) +
        "-" +
        Date.now() +
        ".txt",
      target = path.join(folder, name);
    await fs.writeFile(target, Buffer.concat(content), {
      flag: "wx",
      mode: 0o600,
    });
    return { path: path.relative(root, target) };
  });
  googleTools = require("./google-tools.cjs").installGoogleTools(register, { get, request, token, current, generation: () => generation, store,
    canWrite: async () => (await load()).scopes?.includes("https://www.googleapis.com/auth/calendar.events") === true });
  return {
    async sendMail({to,subject,body}) {
      if(typeof to!=='string'||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)||/[\r\n]/.test(to)||typeof subject!=='string'||subject.length>300||/[\r\n]/.test(subject)||typeof body!=='string'||body.length>20000)throw Error('연결 메일 내용을 확인해 주세요.');
      const expected=generation,value=await load();current(expected);
      if(!value.scopes?.includes('https://www.googleapis.com/auth/gmail.send'))throw Error('Google 메일 보내기 권한으로 계정을 다시 연결해 주세요.');
      const access=await token();current(expected);
      const raw=['To: '+to,'Subject: =?UTF-8?B?'+Buffer.from(subject).toString('base64')+'?=','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(body).toString('base64').match(/.{1,76}/g)?.join('\r\n')||''].join('\r\n');
      const response=await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({raw:Buffer.from(raw).toString('base64url')})});current(expected);
      const sent=await response.json();return{id:sent.id};
    },
    invalidate() { generation++; googleTools.clear(); },
    shutdown() {
      generation++;
      googleTools.clear();
      if (auth) {
        clearTimeout(auth.timer);
        auth.server?.close();
        auth = null;
      }
    },
  };
}
module.exports = { registerIntegrations };
