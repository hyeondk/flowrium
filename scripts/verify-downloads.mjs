import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import {
  validRepository,
  releaseAssets,
  formatSize,
} from "../docs/releases.mjs";
import { releaseConfig } from "../docs/release-config.mjs";

assert.equal(
  validRepository(releaseConfig.repository),
  true,
  "다운로드 저장소 설정이 유효해야 합니다.",
);
assert.equal(validRepository("owner/repo/extra"), false);
assert.equal(validRepository("../repo"), false);
const repository = "example/flowrium";
const asset = (name, overrides = {}) => ({
  name,
  state: "uploaded",
  size: 1024 * 1024 * 140,
  browser_download_url: `https://github.com/${repository}/releases/download/v0.1.0/${name}`,
  ...overrides,
});
const valid = asset("Flowrium-0.1.0-mac-arm64.dmg");
assert.equal(
  releaseAssets({ assets: [valid] }, repository)["mac-arm64"].url,
  valid.browser_download_url,
);
assert.deepEqual(
  releaseAssets({ draft: true, assets: [valid] }, repository),
  {},
);
assert.deepEqual(
  releaseAssets({ prerelease: true, assets: [valid] }, repository),
  {},
);
assert.deepEqual(
  releaseAssets({ assets: [asset(valid.name, { size: 0 })] }, repository),
  {},
);
assert.deepEqual(
  releaseAssets({ assets: [asset(valid.name, { state: "new" })] }, repository),
  {},
);
assert.deepEqual(
  releaseAssets(
    {
      assets: [
        asset(valid.name, {
          browser_download_url: "https://malicious.invalid/setup.dmg",
        }),
      ],
    },
    repository,
  ),
  {},
);
assert.deepEqual(
  releaseAssets(
    {
      assets: [
        asset(valid.name, {
          browser_download_url: `${valid.browser_download_url}?redirect=other`,
        }),
      ],
    },
    repository,
  ),
  {},
);
assert.deepEqual(
  releaseAssets(
    {
      assets: [
        asset(valid.name, {
          browser_download_url: valid.browser_download_url.replace(
            "mac-arm64.dmg",
            "mac-x64.dmg",
          ),
        }),
      ],
    },
    repository,
  ),
  {},
);
const windows = asset("Flowrium-0.1.0-win-x64.exe");
assert.equal(
  releaseAssets({ assets: [windows] }, repository)["win-x64"].name,
  windows.name,
);
assert.equal(formatSize(valid.size), "140 MB");
const html = await readFile(
  new URL("../docs/index.html", import.meta.url),
  "utf8",
);
for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g))
  await access(new URL(`../docs/${match[1]}`, import.meta.url));
assert.equal((html.match(/data-download=/g) || []).length, 3);
assert.equal((html.match(/aria-disabled="true"/g) || []).length, 3);
assert.equal(html.includes('<html lang="ko">'), true);
console.log(
  "다운로드 페이지 확인 완료 / 실제 자산만 활성화 / 초안과 사전 공개 버전 제외 / 잘못된 주소 차단 / 로컬 파일 연결 정상",
);
