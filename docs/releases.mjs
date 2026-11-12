export const platforms = Object.freeze([
  { id: 'mac-arm64', os: 'mac', arch: 'arm64', extension: 'dmg' },
  { id: 'mac-x64', os: 'mac', arch: 'x64', extension: 'dmg' },
  { id: 'win-x64', os: 'win', arch: 'x64', extension: 'exe' },
]);

export function validRepository(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) && !value.split('/').some((part) => part === '.' || part === '..');
}

export function releaseAssets(release, repository) {
  if (!validRepository(repository) || !release || release.draft || release.prerelease || !Array.isArray(release.assets)) return {};
  const result = {};
  const prefix = `https://github.com/${repository}/releases/download/`;
  for (const platform of platforms) {
    const suffix = `-${platform.os}-${platform.arch}.${platform.extension}`;
    const asset = release.assets.find((entry) => {
      if (!entry || typeof entry.name !== 'string' || !entry.name.startsWith('Flowrium-') || !entry.name.endsWith(suffix) || entry.state !== 'uploaded' || !(entry.size > 0) || typeof entry.browser_download_url !== 'string') return false;
      try {
        const url = new URL(entry.browser_download_url);
        return url.href.startsWith(prefix) && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && decodeURIComponent(url.pathname.split('/').pop()) === entry.name;
      } catch { return false; }
    });
    if (asset) result[platform.id] = { name: asset.name, url: asset.browser_download_url, size: asset.size };
  }
  return result;
}

export function formatSize(bytes) {
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}
