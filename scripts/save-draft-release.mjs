import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { validRepository } from "../docs/releases.mjs";

const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME;
const token = process.env.GITHUB_TOKEN;
const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
if (
  !validRepository(repository) ||
  !token ||
  tag !== `v${pkg.version}` ||
  !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)
)
  throw new Error("릴리스 저장소 / 토큰 / 버전을 확인해 주세요.");

const directory = resolve("release");
const names = (await readdir(directory)).filter(
  (name) =>
    name === "SHA256SUMS.txt" ||
    /^Flowrium-[0-9A-Za-z.-]+-(?:mac-arm64\.(?:dmg|zip)|win-x64\.exe)$/.test(
      name,
    ),
);
for (const required of [
  ...(process.env.EXPECT_MAC === "true" ? [`Flowrium-${pkg.version}-mac-arm64.dmg`, `Flowrium-${pkg.version}-mac-arm64.zip`] : []),
  `Flowrium-${pkg.version}-win-x64.exe`,
  "SHA256SUMS.txt",
]) {
  if (!names.includes(required))
    throw new Error(`필수 릴리스 파일이 없습니다: ${required}`);
}

const api = `https://api.github.com/repos/${repository}`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "flowrium-release",
};
async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  if (!response.ok)
    throw new Error(
      `GitHub 릴리스 요청에 실패했습니다. 응답 상태: ${response.status}`,
    );
  return response.status === 204 ? null : response.json();
}

const lookup = await fetch(`${api}/releases/tags/${encodeURIComponent(tag)}`, {
  headers,
});
let release;
if (lookup.ok) {
  release = await lookup.json();
  if (!release.draft)
    throw new Error(
      "이미 공개된 릴리스는 이 작업으로 변경하지 않습니다. 새 버전 태그를 사용해 주세요.",
    );
} else if (lookup.status === 404) {
  release = await request(`${api}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: `Flowrium ${tag}`,
      draft: true,
      prerelease: false,
      body: await readFile(
        new URL("../docs/release-notes.md", import.meta.url),
        "utf8",
      ),
    }),
  });
} else
  throw new Error(
    `기존 릴리스를 확인하지 못했습니다. 응답 상태: ${lookup.status}`,
  );

const existing = await request(
  `${api}/releases/${release.id}/assets?per_page=100`,
);
for (const name of names.sort()) {
  const previous = existing.find((asset) => asset.name === name);
  if (previous)
    await request(`${api}/releases/assets/${previous.id}`, {
      method: "DELETE",
    });
  await request(
    `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: await readFile(join(directory, name)),
    },
  );
}
console.log(
  `Flowrium ${tag} 초안에 설치 파일과 체크섬을 저장했습니다. 공개 게시 전 실제 기기 검증이 필요합니다.`,
);
