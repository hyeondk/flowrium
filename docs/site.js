import { releaseConfig } from './release-config.mjs';
import { platforms, validRepository, releaseAssets, formatSize } from './releases.mjs';

const status = document.getElementById('release-status');
const retry = document.getElementById('retry-releases');
const repository = releaseConfig.repository;
let loading = false;

if (validRepository(repository)) {
  document.getElementById('source-link').href = `https://github.com/${repository}`;
  document.getElementById('releases-link').href = `https://github.com/${repository}/releases`;
} else {
  status.textContent = '다운로드 저장소 설정을 확인해 주세요.';
}

async function loadRelease() {
  if (loading || !validRepository(repository)) return;
  loading = true;
  retry.hidden = true;
  status.textContent = '공개된 설치 파일을 확인하고 있습니다.';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-cache',
    });
    if (response.status === 404) {
      status.textContent = '첫 공개 릴리스를 준비하고 있습니다. 설치 파일이 등록되면 이곳에서 받을 수 있어요.';
      return;
    }
    if (!response.ok) throw new Error('release-fetch');
    const release = await response.json();
    const assets = releaseAssets(release, repository);
    let available = 0;
    for (const platform of platforms) {
      const asset = assets[platform.id];
      if (!asset) continue;
      const button = document.querySelector(`[data-download="${platform.id}"]`);
      button.href = asset.url;
      button.removeAttribute('tabindex');
      button.setAttribute('aria-disabled', 'false');
      button.textContent = '다운로드';
      const arrow = document.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↓';
      button.append(arrow);
      document.querySelector(`[data-file="${platform.id}"]`).textContent = `${release.tag_name || '공개 버전'} / ${formatSize(asset.size)}`;
      available += 1;
    }
    status.textContent = available ? `${release.tag_name || '새 버전'} 공개 / ${available}개 플랫폼의 설치 파일을 받을 수 있습니다.` : '공개 릴리스에 설치 파일을 추가하고 있습니다. 잠시 후 다시 확인해 주세요.';
    if (!available) retry.hidden = false;
  } catch {
    status.textContent = '설치 파일 목록을 불러오지 못했습니다. 다시 확인하거나 전체 릴리스에서 확인해 주세요.';
    retry.hidden = false;
  } finally {
    clearTimeout(timeout);
    loading = false;
  }
}

retry.addEventListener('click', loadRelease);
void loadRelease();
