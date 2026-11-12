import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { validRepository, platforms, releaseAssets, formatSize } from "../docs/releases.mjs";
import { releaseConfig } from "../docs/release-config.mjs";

assert.equal(validRepository(releaseConfig.repository), true);
assert.equal(validRepository("owner/repo/extra"), false);
assert.equal(validRepository("../repo"), false);

const repository = "example/flowrium";
function release(tag = "v0.2.0") {
  const version = tag.slice(1);
  const names = [
    `Flowrium-${version}-mac-arm64.dmg`,
    `Flowrium-${version}-mac-arm64.zip`,
    `Flowrium-${version}-win-x64.exe`,
    "SHA256SUMS.txt",
  ];
  return {
    tag_name: tag, draft: false, prerelease: false,
    assets: names.map((name) => ({
      name, state: "uploaded", size: 140 * 1024 ** 2,
      browser_download_url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
    })),
  };
}
const assetIds = (data) => Object.keys(releaseAssets(data, repository)).sort();
const current = release();
const [dmg, zip, windows, hashes] = current.assets;
const match = releaseAssets(current, repository);
assert.deepEqual(assetIds(current), ["mac-arm64", "win-x64"]);
assert.equal(match["mac-arm64"].url, dmg.browser_download_url);
assert.equal(match["win-x64"].name, windows.name);
assert.equal(formatSize(windows.size), "140 MB");
assert.deepEqual(assetIds({...current, draft: true}), []);
assert.deepEqual(assetIds({...current, prerelease: true}), []);
assert.deepEqual(assetIds({...current, tag_name: "v0.3.0"}), []);
assert.deepEqual(assetIds(release("v0.2.1-beta.1")), []);
assert.deepEqual(assetIds(release("v0.1.2")), ["win-x64"]);
assert.deepEqual(assetIds({...current, assets: [windows, hashes]}), ["win-x64"]);
assert.deepEqual(assetIds({...current, assets: [windows, dmg, hashes]}), ["win-x64"]);
assert.deepEqual(assetIds({...current, assets: [zip, dmg, windows]}), []);
assert.deepEqual(assetIds({...current, assets: [zip, dmg, hashes]}), ["mac-arm64"]);
for (const invalid of [
  {size: 0}, {state: "new"},
  {browser_download_url: "https://malicious.invalid/setup.dmg"},
  {browser_download_url: dmg.browser_download_url + "?redirect=other"},
  {browser_download_url: dmg.browser_download_url.replace("v0.2.0", "v0.1.2")},
  {browser_download_url: dmg.browser_download_url.replace("mac-arm64.dmg", "mac-x64.dmg")},
]) {
  assert.deepEqual(assetIds({...current, assets: [{...dmg, ...invalid}, zip, hashes]}), []);
}
const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)) {
  await access(new URL(`../docs/${match[1]}`, import.meta.url));
}
assert.deepEqual([...html.matchAll(/data-download="([^"]+)"/g)].map(([,id])=>id), platforms.map(({id})=>id));
assert.equal((html.match(/aria-disabled="true"/g) || []).length, platforms.length);
assert.ok(html.includes('<html lang="ko">'));
console.log("다운로드 페이지 확인 / 두 플랫폼 / 이전 Mac 설치 파일 제외 / 현재 태그의 설치 파일과 해시 목록 / 로컬 링크 정상");
