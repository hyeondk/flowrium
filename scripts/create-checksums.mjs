import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const directory = resolve(process.argv[2] || "release");
const names = (await readdir(directory))
  .filter((name) =>
    ['install.sh','install.ps1','flowrium-install-support.cjs','SOURCE-COMMIT.txt'].includes(name) || /^Flowrium-[0-9A-Za-z.-]+-(?:mac-arm64\.(?:dmg|zip)|win-x64\.exe|source\.tar\.gz)$/.test(
      name,
    ),
  )
  .sort();
if (!names.length)
  throw new Error("체크섬을 만들 Flowrium 설치 파일이 없습니다.");
const lines = [];
for (const name of names) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(directory, name)))
    hash.update(chunk);
  lines.push(`${hash.digest("hex")}  ${name}`);
}
await writeFile(
  join(directory, "SHA256SUMS.txt"),
  `${lines.join("\n")}\n`,
  "utf8",
);
console.log(`설치 파일 ${names.length}개의 SHA256SUMS.txt를 생성했습니다.`);
