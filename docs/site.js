import { releaseConfig } from "./release-config.mjs";
import { monthlySales, amount, salesAnswer, growthPercent } from "./sales-example.mjs";
import {
  platforms,
  validRepository,
  releaseAssets,
  formatSize,
} from "./releases.mjs";

const status = document.getElementById("release-status");
const retry = document.getElementById("retry-releases");
const repository = releaseConfig.repository;
let loading = false;

const bars = document.querySelector(".sales-bars");
const table = document.querySelector(".input-table tbody");
const maximum = Math.max(...monthlySales);
monthlySales.forEach((value, index) => {
  const month = `${index + 1}월`;
  const item = document.createElement("li");
  const label = document.createElement("data");
  label.value = String(value);
  label.textContent = amount(value);
  const bar = document.createElement("i");
  bar.setAttribute("aria-hidden", "true");
  bar.style.setProperty("--ratio", String(value / maximum));
  const period = document.createElement("span");
  period.textContent = month;
  item.append(label, bar, period);
  bars.append(item);
  const row = table.insertRow();
  const heading = document.createElement("th");
  heading.scope = "row";
  heading.textContent = month;
  row.append(heading);
  row.insertCell().textContent = amount(value);
});
document.querySelector("[data-sales-change]").textContent = `+${growthPercent}%`;
document.querySelector("[data-sales-summary]").textContent = salesAnswer;
const example = document.getElementById("example-dialog");
document.getElementById("example-open").addEventListener("click", event => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !example.showModal) return;
  event.preventDefault();
  example.showModal();
  example.querySelector("img").loading = "eager";
});

if (validRepository(repository)) {
  document.getElementById("source-link").href =
    `https://github.com/${repository}`;
  document.getElementById("releases-link").href =
    `https://github.com/${repository}/releases`;
} else {
  status.textContent = "다운로드 저장소 설정을 확인해 주세요.";
}

async function loadRelease() {
  if (loading || !validRepository(repository)) return;
  loading = true;
  retry.hidden = true;
  status.textContent = "공개된 설치 파일을 확인하고 있습니다.";
  for (const platform of platforms) {
    const button = document.querySelector(`[data-download="${platform.id}"]`);
    button.removeAttribute("href");
    button.tabIndex = -1;
    button.setAttribute("aria-disabled", "true");
    button.textContent = "설치 파일 준비 중";
    document.querySelector(`[data-file="${platform.id}"]`).textContent = "공개 릴리스의 설치 파일을 확인합니다.";
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
        credentials: "omit",
        cache: "no-cache",
      },
    );
    if (response.status === 404) {
      status.textContent =
        "첫 공개 릴리스를 준비하고 있습니다. 설치 파일이 등록되면 이곳에서 받을 수 있어요.";
      retry.hidden = false;
      return;
    }
    if (!response.ok) throw new Error("release-fetch");
    const release = await response.json();
    const assets = releaseAssets(release, repository);
    let available = 0;
    for (const platform of platforms) {
      const asset = assets[platform.id];
      if (!asset) {
        document.querySelector(`[data-file="${platform.id}"]`).textContent = "이 플랫폼의 설치 파일 등록을 기다리고 있습니다.";
        continue;
      }
      const button = document.querySelector(`[data-download="${platform.id}"]`);
      button.href = asset.url;
      button.removeAttribute("tabindex");
      button.setAttribute("aria-disabled", "false");
      button.textContent = "다운로드";
      const arrow = document.createElement("span");
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↓";
      button.append(arrow);
      document.querySelector(`[data-file="${platform.id}"]`).textContent =
        `${release.tag_name || "공개 버전"} / ${formatSize(asset.size)}`;
      available += 1;
    }
    status.textContent = available
      ? `${release.tag_name || "새 버전"} 공개 / ${available}개 플랫폼의 설치 파일을 받을 수 있습니다.`
      : "공개 릴리스에 설치 파일을 추가하고 있습니다. 잠시 후 다시 확인해 주세요.";
    retry.hidden = available === platforms.length;
  } catch {
    status.textContent =
      "설치 파일 목록을 불러오지 못했습니다. 다시 확인하거나 전체 릴리스에서 확인해 주세요.";
    retry.hidden = false;
  } finally {
    clearTimeout(timeout);
    loading = false;
  }
}

retry.addEventListener("click", loadRelease);
void loadRelease();
