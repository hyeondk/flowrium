import { readFile } from "node:fs/promises";

const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const tag = process.env.GITHUB_REF_NAME;
if (
  tag !== `v${pkg.version}` ||
  !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)
) {
  throw new Error(
    `태그가 앱 버전과 일치해야 합니다. 필요한 태그: v${pkg.version}`,
  );
}
console.log(`릴리스 버전 확인: ${tag}`);
