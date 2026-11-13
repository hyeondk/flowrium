const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const {
  kickoffFields,
  readDetails,
  updateDetails,
} = require("./project-details.cjs");

const run = promisify(execFile);
const categories = {
  rules: {
    roots: ["docs/규칙", "docs/rules", "규칙", ".github/instructions"],
    singles: [
      "AGENTS.md",
      "CONTRIBUTING.md",
      "RULES.md",
      ".github/copilot-instructions.md",
    ],
  },
  design: {
    roots: ["docs/디자인", "docs/design", "디자인 시안", "design"],
    singles: [],
  },
  meetings: {
    roots: ["docs/회의록", "docs/meetings", "회의록", "meetings"],
    singles: [],
  },
};
const texts = new Set([".md", ".markdown", ".txt", ".html", ".htm", ".css"]);
const visuals = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".pdf",
  ".pptx",
  ".docx",
]);
const unknown = () => new Error("선택한 프로젝트의 문서 위치를 확인해 주세요.");
function group(kind) {
  if (!Object.hasOwn(categories, kind)) throw unknown();
  return categories[kind];
}
function safeName(name) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 140 ||
    /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
    name.startsWith(".") ||
    /[ .]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error("폴더와 파일에 사용할 수 있는 이름을 입력해 주세요.");
  return name;
}
async function checkedRoot(store, id) {
  const project = store.project(id);
  const root = await fs.realpath(project.path);
  if (path.relative(project.path, root)) throw unknown();
  return root;
}
async function descend(root, parts, create = false) {
  let at = root;
  for (const name of parts) {
    at = path.join(at, name);
    if (create) {
      try {
        await fs.mkdir(at);
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
    }
    const stat = await fs.lstat(at);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      path.relative(at, await fs.realpath(at))
    )
      throw unknown();
  }
  return at;
}
function permitted(spec, relative) {
  if (
    typeof relative !== "string" ||
    relative.length > 1200 ||
    relative.includes("\\") ||
    /[:\x00-\x1f]/.test(relative)
  )
    return false;
  if (!relative.split("/").every((s) => s && s !== "." && s !== ".."))
    return false;
  const ext = path.extname(relative).toLowerCase();
  return (
    (texts.has(ext) || visuals.has(ext)) &&
    (spec.singles.includes(relative) ||
      spec.roots.some((dir) => relative.startsWith(dir + "/")))
  );
}
async function noteAt(root, spec, relative) {
  if (!permitted(spec, relative)) throw unknown();
  const parts = relative.split("/");
  const name = parts.pop();
  const file = path.join(await descend(root, parts), name);
  const stat = await fs.lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    path.relative(file, await fs.realpath(file))
  )
    throw unknown();
  const info = {
    path: relative,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    preview:
      texts.has(path.extname(name).toLowerCase()) && stat.size <= 512 * 1024,
  };
  return { file, info };
}
async function optional(action) {
  try {
    return await action();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
async function notes(root, spec) {
  const out = [];
  let visited = 0;
  for (const relative of spec.singles) {
    const entry = await optional(() => noteAt(root, spec, relative));
    if (entry) out.push(entry.info);
  }
  const queue = [...spec.roots];
  while (queue.length && visited < 10000 && out.length < 1000) {
    const dir = queue.shift();
    const location = await optional(() => descend(root, dir.split("/")));
    if (!location) continue;
    const entries = await fs.readdir(location, { withFileTypes: true });
    for (const entry of entries) {
      if (++visited > 10000 || out.length >= 1000) break;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const relative = dir + "/" + entry.name;
      if (entry.isDirectory()) queue.push(relative);
      else if (entry.isFile() && permitted(spec, relative)) {
        const entry = await optional(() => noteAt(root, spec, relative));
        if (entry) out.push(entry.info);
      }
    }
  }
  return out.sort(
    (a, b) =>
      b.modifiedAt.localeCompare(a.modifiedAt) || a.path.localeCompare(b.path),
  );
}
function registerPortfolio(register, store, { chooseFolder, reveal }) {
  require("./portfolio-operations.cjs").registerPortfolioOperations(register,store,{chooseFolder});
  register("readPortfolio", async () =>
    Promise.all(
      store.state.projects.map(async (project) => {
        try {
          return { project, details: await readDetails(store, project.id) };
        } catch {
          return {
            project,
            details: null,
            error: "프로젝트 폴더의 정보를 읽지 못했습니다.",
          };
        }
      }),
    ),
  );
  register("setKickoffDetails", (id, revision, input) =>
    updateDetails(store, id, revision, {
      action: "kickoff",
      input: kickoffFields(input),
    }),
  );
  register("kickoffProject", async (input) => {
    const settings = kickoffFields(input);
    const createFolder = input.createFolder === true,
      clone = input.clone === true;
    if (createFolder) safeName(settings.name);
    if (clone && !settings.repository)
      throw new Error("복제할 GitHub 저장소를 입력해 주세요.");
    const picked = await chooseFolder(createFolder);
    if (!picked) return null;
    const parent = await fs.realpath(picked);
    const folder = createFolder ? path.join(parent, settings.name) : parent;
    if (createFolder) {
      try {
        await fs.mkdir(folder);
      } catch (e) {
        if (e.code === "EEXIST")
          throw new Error(
            "같은 이름의 폴더가 있습니다. 기존 폴더 사용을 선택하세요.",
          );
        throw e;
      }
    }
    if (clone) {
      if ((await fs.readdir(folder)).length)
        throw new Error("저장소를 복제할 폴더가 비어 있어야 합니다.");
      try {
        await run(
          "git",
          [
            "-c",
            "protocol.file.allow=never",
            "clone",
            "--",
            settings.repository,
            folder,
          ],
          {
            timeout: 180000,
            maxBuffer: 2 * 1024 * 1024,
            windowsHide: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          },
        );
      } catch {
        if (createFolder) await fs.rmdir(folder).catch(() => {});
        throw new Error(
          "GitHub 저장소를 복제하지 못했습니다. Git 설치와 저장소 접근 권한을 확인하세요.",
        );
      }
    }
    const project = await store.addProject(folder);
    const existing = await readDetails(store, project.id);
    if (existing.revision)
      throw new Error(
        "상세 정보가 있는 프로젝트입니다. 프로젝트 설정에서 킥오프 정보를 수정하세요.",
      );
    if (input.scaffold === true)
      for (const spec of Object.values(categories))
        await descend(folder, spec.roots[0].split("/"), true);
    await updateDetails(store, project.id, null, {
      action: "kickoff",
      input: settings,
    });
    return project;
  });
  register("listProjectNotes", (id, kind) =>
    checkedRoot(store, id).then((root) => notes(root, group(kind))),
  );
  register("readProjectNote", async (id, kind, relative) => {
    const { file, info } = await noteAt(
      await checkedRoot(store, id),
      group(kind),
      relative,
    );
    if (!info.preview) throw new Error("이 문서는 파일 위치에서 열어 주세요.");
    const bytes = await fs.readFile(file);
    if (bytes.length > 512 * 1024 || bytes.includes(0))
      throw new Error("미리보기할 수 없는 문서입니다.");
    return bytes.toString("utf8");
  });
  register("revealProjectNote", async (id, kind, relative) => {
    const { file } = await noteAt(
      await checkedRoot(store, id),
      group(kind),
      relative,
    );
    await reveal(file);
  });
  register("createProjectNote", async (id, kind, title, body) => {
    const name = safeName(title);
    if (
      typeof body !== "string" ||
      !body.trim() ||
      Buffer.byteLength(body) > 512 * 1024
    )
      throw new Error("문서 본문을 512KB 이내로 입력해 주세요.");
    const root = await checkedRoot(store, id),
      spec = group(kind);
    const dir = await descend(root, spec.roots[0].split("/"), true);
    const filename = name.toLowerCase().endsWith(".md") ? name : name + ".md";
    try {
      await fs.writeFile(path.join(dir, filename), body, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (e) {
      if (e.code === "EEXIST")
        throw new Error("같은 이름의 문서가 있습니다. 다른 이름을 입력하세요.");
      throw e;
    }
    return (await noteAt(root, spec, spec.roots[0] + "/" + filename)).info;
  });
}
module.exports = { registerPortfolio };
