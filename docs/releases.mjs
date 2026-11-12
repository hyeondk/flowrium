export const platforms = Object.freeze([
  { id: "mac-arm64", os: "mac", arch: "arm64", extension: "dmg" },
  { id: "win-x64", os: "win", arch: "x64", extension: "exe" },
]);

export function validRepository(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) &&
    !value.split("/").some((part) => part === "." || part === "..")
  );
}

export function releaseAssets(release, repository) {
  if (
    !validRepository(repository) ||
    !release ||
    release.draft !== false ||
    release.prerelease !== false ||
    !Array.isArray(release.assets)
  ) return {};

  const tag = release.tag_name;
  const version = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (!version) return {};
  const base = `https://github.com/${repository}/releases/download/${tag}/`;
  const uploaded = new Map(
    release.assets
      .filter((asset) =>
        asset && typeof asset.name === "string" && asset.state === "uploaded" &&
        Number.isSafeInteger(asset.size) && asset.size > 0 &&
        asset.browser_download_url === base + asset.name,
      )
      .map((asset) => [asset.name, asset]),
  );
  if (!uploaded.has("SHA256SUMS.txt")) return {};

  const result = {};
  for (const {id, extension} of platforms) {
    const stem = `Flowrium-${tag.slice(1)}-${id}`;
    const asset = uploaded.get(`${stem}.${extension}`);
    if (!asset) continue;
    if (id === "mac-arm64") {
      // 0.1.x 배포는 공증 확인 전 파일이다. 신규 Mac 배포에는 업데이트용 ZIP을 함께 게시한다.
      if ((version[1] === "0" && Number(version[2]) < 2) || !uploaded.has(`${stem}.zip`))
        continue;
    }
    result[id] = { name: asset.name, url: asset.browser_download_url, size: asset.size };
  }
  return result;
}

export function formatSize(bytes) {
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}
