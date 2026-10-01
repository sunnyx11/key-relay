import fs from "node:fs";
import path from "node:path";

const REQUIRED_PROJECT_FILES = ["context.md", "principles.md", "architecture.md", "glossary.md"];
const REQUIRED_DOMAIN_FILES = ["overview.md", "requirements.md", "design.md"];
const FIXED_DOMAIN_FILES = new Set(["overview.md", "design.md"]);
const CHANGE_STATUSES = ["proposed", "accepted", "completed", "cancelled"];
const TEMPLATE_HEADINGS = new Map();
const MARKDOWN_LINK = /(?<!!)\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))(?:[ \t]+"[^"]*")?\)/g;

/**
 * Parse --root and --specs-dir into absolute directories without file operations.
 * Reject missing, duplicate or unknown options and Spec directories outside the repository.
 */
export function parseOptions(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    if (!["--root", "--specs-dir"].includes(option)) throw new Error(`未知参数：${option}`);
    if (values.has(option)) throw new Error(`${option} 不能重复`);
    values.set(option, requiredValue(argv, index + 1, option));
  }
  const root = path.resolve(values.get("--root") ?? ".");
  const specsDir = values.get("--specs-dir") ?? "specs";
  if (path.isAbsolute(specsDir) || path.win32.isAbsolute(specsDir)) {
    throw new Error("--specs-dir 必须使用仓库内相对目录");
  }
  const specsRoot = path.resolve(root, specsDir);
  if (!within(root, specsRoot)) throw new Error("--specs-dir 不能超出仓库根目录");
  return { root, specsRoot };
}

/**
 * Inspect required files, template heading structures, current requirements, references and Changes.
 * Return diagnostics and index data without writes; content accuracy requires human or agent review.
 */
export function inspectSpecs(options) {
  const { root, specsRoot } = options;
  if (fs.existsSync(root) && fs.existsSync(specsRoot) && !withinRealPath(root, specsRoot)) {
    throw new Error("--specs-dir 不能超出仓库根目录");
  }
  const errors = [];
  const documents = new Map();
  const domains = [];
  const changes = [];
  const ids = new Map();
  for (const name of REQUIRED_PROJECT_FILES) {
    const file = `project/${name}`;
    const text = readRequired(specsRoot, file, errors);
    documents.set(file, text);
    validateTemplateStructure(text, file, `project-${name}`, errors);
  }
  const domainsRoot = path.join(specsRoot, "domains");
  for (const name of listDirs(domainsRoot, specsRoot)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) errors.push(`Domain 名称无效：${name}`);
    for (const file of REQUIRED_DOMAIN_FILES) {
      const relative = `domains/${name}/${file}`;
      const text = readRequired(specsRoot, relative, errors);
      documents.set(relative, text);
      if (FIXED_DOMAIN_FILES.has(file)) validateTemplateStructure(text, relative, `domain-${file}`, errors);
    }
    const requirementsFile = `domains/${name}/requirements.md`;
    const requirements = parseRequirements(documents.get(requirementsFile), requirementsFile, errors);
    for (const entry of requirements) {
      if (ids.has(entry.id)) {
        errors.push(`需求 ID 重复：${entry.id}，所属文档：${ids.get(entry.id)}、${requirementsFile}`);
      } else {
        ids.set(entry.id, requirementsFile);
      }
    }
    domains.push({ name, requirements });
    const directory = `domains/${name}/changes`;
    const changesRoot = path.join(specsRoot, directory);
    if (fs.existsSync(changesRoot) && !withinRealPath(specsRoot, changesRoot)) {
      errors.push(`${directory}：changes 目录必须位于 Spec 目录内`);
      continue;
    }
    let files;
    try {
      files = listChangeFiles(changesRoot);
    } catch (error) {
      errors.push(`${directory}：${error.message}`);
      continue;
    }
    for (const { name: filename, sequence } of files) {
      const file = `${directory}/${filename}`;
      const change = parseChange(readRequired(specsRoot, file, errors), file, errors);
      if (!change) continue;
      changes.push({ ...change, key: `${name}/${sequence}`, file });
    }
  }
  if (domains.length === 0) errors.push("至少需要一个 Domain");
  // All domains must be collected before resolving cross-domain references.
  for (const [file, text] of documents) validateReferences(text, file, root, specsRoot, ids, errors);
  for (const change of changes) {
    const requireCurrentTarget = ["proposed", "accepted"].includes(change.status);
    validateReferences(change.related, change.file, root, specsRoot, ids, errors, requireCurrentTarget);
  }
  return { specsRoot, errors, domains, changes };
}

/** Render deterministic Markdown indexes from inspected data without file writes. */
export function renderIndexes(model) {
  return {
    "changes.md": renderChanges(model),
    "requirements-index.md": renderRequirements(model),
    "index.md": renderHome(model),
  };
}

/** Resolve a generated index target, rejecting directories, links and paths outside the Spec directory. */
export function indexFilePath(specsRoot, name) {
  const target = path.resolve(specsRoot, name);
  if (!within(specsRoot, target)
    || (fs.existsSync(target) && (!fs.lstatSync(target).isFile() || !withinRealPath(specsRoot, target)))) {
    throw new Error(`${name} 必须是 Spec 目录内普通文件`);
  }
  return target;
}

function parseRequirements(text, file, errors) {
  text = markdownProse(text);
  const structure = templateHeadings("domain-requirements.md");
  const requiredSections = structure.level3;
  validateTitle(text, file, structure.level1[0], errors);
  const headings = [...text.matchAll(/^## ([^\n]+)/gm)];
  return headings.flatMap((heading, index) => {
    const match = heading[1].trim().match(/^([A-Z][A-Z0-9]*-REQ-\d{3,})[ \t]+(.+)$/);
    if (!match) {
      errors.push(`${file} 需求标题无效：${heading[1]}`);
      return [];
    }
    const body = text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length);
    const sections = [...body.matchAll(/^### ([^\n]+)/gm)].map((item) => item[1].trim());
    for (const section of requiredSections) {
      if (sections.filter((name) => name === section).length !== 1) {
        errors.push(`${file} ${match[1]} 必须包含一个 ${section} 分节`);
      }
    }
    const unexpected = sections.filter((name) => !requiredSections.includes(name));
    if (unexpected.length > 0) {
      errors.push(`${file} ${match[1]} 包含额外三级分节：${unexpected.join("、")}`);
    }
    return [{ id: match[1], title: match[2] }];
  });
}

/**
 * List sorted {name, sequence} entries for 001-change.md through 999-change.md.
 * Read directory metadata only; reject non-files and invalid names without modifying files.
 */
export function listChangeFiles(directory) {
  if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) {
    throw new Error("缺少 changes 目录或输入不是目录");
  }
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile()) throw new Error(`Change 必须是普通文件：${entry.name}`);
    const match = entry.name.match(/^([0-9]{3})-change\.md$/);
    if (!match || match[1] === "000") throw new Error(`Change 文件名无效：${entry.name}，应为 <NNN>-change.md，序号范围 001 至 999`);
    return { name: entry.name, sequence: match[1] };
  }).sort((left, right) => left.sequence.localeCompare(right.sequence));
}

function parseChange(text, file, errors) {
  const metadata = text.match(/^---\n([^]*?)\n---(?:\n|$)/);
  if (!metadata) {
    errors.push(`${file} 缺少 frontmatter`);
    return null;
  }
  const lines = metadata[1].split("\n").map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter((line) => line && !line.startsWith("#"));
  const allowedFields = new Set(["status", "created_at", "completed_at"]);
  const fields = new Map();
  let fieldsValid = lines.length === allowedFields.size;
  for (const line of lines) {
    const match = line.match(/^([a-z_]+):[ \t]*(.*)$/);
    if (!match || !allowedFields.has(match[1]) || fields.has(match[1])) {
      fieldsValid = false;
      continue;
    }
    fields.set(match[1], match[2].trim());
  }
  if (!fieldsValid || fields.size !== allowedFields.size) {
    errors.push(`${file} frontmatter 必须且只能包含 status、created_at 和 completed_at`);
  }

  const status = fields.get("status");
  if (!CHANGE_STATUSES.includes(status)) errors.push(`${file} status 无效`);

  const createdAt = fields.get("created_at") ?? "";
  const completedAt = fields.get("completed_at") ?? "";
  const createdAtValid = isValidBeijingDateTime(createdAt);
  const completedAtValid = !completedAt || isValidBeijingDateTime(completedAt);
  if (!createdAtValid) errors.push(`${file} created_at 必须是有效的北京时间，格式为 YYYY-MM-DD HH:mm:ss`);
  if (!completedAtValid) errors.push(`${file} completed_at 必须是有效的北京时间，格式为 YYYY-MM-DD HH:mm:ss`);
  if (status === "completed") {
    if (!completedAt) errors.push(`${file} completed 状态必须填写 completed_at`);
    if (createdAtValid && completedAt && completedAtValid && completedAt < createdAt) {
      errors.push(`${file} 完成时间不得早于创建时间`);
    }
  } else if (CHANGE_STATUSES.includes(status) && completedAt) {
    errors.push(`${file} 仅 completed 状态可以填写 completed_at`);
  }

  const source = text.slice(metadata[0].length);
  const body = markdownProse(source);
  const structure = templateHeadings("change.md");
  const changeSections = structure.level2;
  const titles = [...body.matchAll(/^# ([^\n]+)/gm)];
  const title = titles[0]?.[1].trim() ?? "";
  if (titles.length !== 1 || !title || title === structure.level1[0]) errors.push(`${file} 必须包含一个已填写的一级标题`);
  const relatedLines = [...body.matchAll(/^关联规范：[ \t]*([^\n]*)/gm)];
  const related = relatedLines[0]?.[1].trim() ?? "";
  const localLinks = [...related.matchAll(MARKDOWN_LINK)].filter((link) => {
    const href = link[1] ?? link[2];
    return !/^(?:[a-z][a-z0-9+.-]*:|[/\\])/i.test(href) && /\.md(?:#.*)?$/i.test(href);
  });
  if (relatedLines.length !== 1 || !(localLinks.length || /(?<![A-Za-z0-9_-])[A-Z][A-Z0-9]*-REQ-\d{3,}(?![A-Za-z0-9_-])/.test(related))) {
    errors.push(`${file} 关联规范须包含文件链接或具体 REQ ID`);
  }
  const headings = [...body.matchAll(/^## ([^\n]+)/gm)];
  const unexpected = headings.map((heading) => heading[1].trim()).filter((name) => !changeSections.includes(name));
  if (unexpected.length > 0) errors.push(`${file} 包含额外二级分节：${unexpected.join("、")}`);
  const sections = new Map();
  for (const name of changeSections) {
    const matches = headings.filter((heading) => heading[1].trim() === name);
    if (matches.length !== 1) {
      errors.push(`${file} 必须包含一个 ${name} 分节`);
      continue;
    }
    const heading = matches[0];
    const next = headings[headings.indexOf(heading) + 1]?.index ?? body.length;
    const content = source.slice(heading.index + heading[0].length, next).replace(/<!--[^]*?-->/g, "").trim();
    if (!content) errors.push(`${file} ${name} 正文为空`);
    sections.set(name, content);
  }
  return {
    status,
    title,
    related,
    reason: sections.get(changeSections[0]) ?? "",
    createdAt,
    completedAt,
  };
}

function isValidBeijingDateTime(value) {
  const match = value.match(/^([1-9]\d{3})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validateReferences(text, file, root, specsRoot, ids, errors, requireCurrentTarget = true) {
  text = markdownProse(text);
  if (requireCurrentTarget) {
    const references = new Set(text.match(/(?<![A-Za-z0-9_-])[A-Z][A-Z0-9]*-REQ-\d{3,}(?![A-Za-z0-9_-])/g));
    for (const id of references) {
      if (!ids.has(id)) errors.push(`${file} 引用需求不存在：${id}`);
    }
  }
  for (const link of text.matchAll(MARKDOWN_LINK)) {
    const href = link[1] ?? link[2];
    if (href.startsWith("#") || /^(?:https?:|mailto:)/i.test(href)) continue;
    let target;
    try {
      target = decodeURIComponent(href.split("#")[0]);
    } catch {
      errors.push(`${file} 文档链接编码无效：${href}`);
      continue;
    }
    const resolved = path.resolve(specsRoot, path.dirname(file), target);
    if (path.isAbsolute(target) || path.win32.isAbsolute(target) || !within(root, resolved)) {
      errors.push(`${file} 文档链接必须指向仓库内相对文件：${href}`);
    } else if (!fs.existsSync(resolved)) {
      if (requireCurrentTarget) errors.push(`${file} 文档链接不存在：${href}`);
    } else if (!withinRealPath(root, resolved)) {
      errors.push(`${file} 文档链接必须指向仓库内相对文件：${href}`);
    } else if (requireCurrentTarget && !fs.statSync(resolved).isFile()) {
      errors.push(`${file} 文档链接不存在：${href}`);
    }
  }
}

function renderChanges(model) {
  const lines = ["# 变更索引", "", "> 由 `update-specs.mjs` 生成，请勿手工编辑。", ""];
  for (const status of CHANGE_STATUSES) {
    lines.push(`## ${status}`, "");
    const group = model.changes.filter((item) => item.status === status);
    if (group.length === 0) {
      lines.push("无", "");
      continue;
    }
    for (const item of group) {
      const purpose = markdownInlineText(item.reason.split(/\n[ \t]*\n/, 1)[0])
        .replace(/\s+/g, " ").trim();
      lines.push(
        `- [${item.key}](${item.file})：`,
        "",
        `  - 变更目的：${escapeLabel(purpose)}`,
        "",
        `  - 创建时间：${item.createdAt}`,
        "",
        `  - 完成时间：${item.completedAt || "无"}`,
        "",
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderRequirements(model) {
  const lines = ["# 需求索引", "", "> 由 `update-specs.mjs` 生成，请勿手工编辑。", ""];
  for (const domain of model.domains) {
    lines.push(`## ${domain.name}`, "", "| ID | 标题 |", "| --- | --- |");
    for (const item of domain.requirements) {
      const title = markdownInlineText(item.title);
      const anchor = `${item.id}-${title}`.toLowerCase().replace(/[^\w\u4e00-\u9fff\s-]/g, "").replace(/\s+/g, "-");
      lines.push(`| [${item.id}](domains/${domain.name}/requirements.md#${anchor}) | ${escapeLabel(title)} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderHome(model) {
  const lines = [
    "# Spec 索引", "", "> 由 `update-specs.mjs` 生成，请勿手工编辑。", "",
    "## Project", "",
  ];
  for (const file of REQUIRED_PROJECT_FILES) {
    lines.push(`- [${file.replace(".md", "")}](project/${file})`);
  }
  lines.push("", "## Domain", "");
  for (const domain of model.domains) {
    lines.push(`### ${domain.name}`, "");
    for (const file of REQUIRED_DOMAIN_FILES) {
      lines.push(`- [${file.replace(".md", "")}](domains/${domain.name}/${file})`);
    }
    lines.push("");
  }
  lines.push("", "## 索引", "", "- [变更索引](changes.md)", "- [需求索引](requirements-index.md)", "");
  return `${lines.join("\n").trimEnd()}\n`;
}

function readRequired(root, file, errors) {
  const target = path.join(root, file);
  if (!fs.existsSync(target) || !fs.lstatSync(target).isFile() || !withinRealPath(root, target)) {
    errors.push(`缺少普通文件 ${file}`);
    return "";
  }
  return normalizeMarkdown(fs.readFileSync(target, "utf8"));
}

function validateTemplateStructure(text, file, templateName, errors) {
  const source = markdownProse(text);
  const expected = templateHeadings(templateName);
  const actual = headings(source);
  if (actual.level1.length !== 1 || actual.level1[0] !== expected.level1[0]) {
    errors.push(`${file} 一级标题必须为：${expected.level1[0]}`);
  }
  if (actual.level2.length !== expected.level2.length
    || actual.level2.some((name, index) => name !== expected.level2[index])) {
    errors.push(`${file} 二级分节必须依次为：${expected.level2.join("、")}`);
  }
}

function validateTitle(text, file, expected, errors) {
  const titles = headings(text).level1;
  if (titles.length !== 1 || titles[0] !== expected) errors.push(`${file} 一级标题必须为：${expected}`);
}

function headings(text) {
  return {
    level1: [...text.matchAll(/^# ([^\n]+)/gm)].map((item) => item[1].trim()),
    level2: [...text.matchAll(/^## ([^\n]+)/gm)].map((item) => item[1].trim()),
    level3: [...text.matchAll(/^### ([^\n]+)/gm)].map((item) => item[1].trim()),
  };
}

function templateHeadings(name) {
  if (TEMPLATE_HEADINGS.has(name)) return TEMPLATE_HEADINGS.get(name);
  const target = new URL(`../../templates/${name}`, import.meta.url);
  if (!fs.existsSync(target)) throw new Error(`缺少 Skill 模板：${name}`);
  const structure = headings(normalizeMarkdown(fs.readFileSync(target, "utf8")));
  if (structure.level1.length !== 1) throw new Error(`Skill 模板必须包含一个一级标题：${name}`);
  TEMPLATE_HEADINGS.set(name, structure);
  return structure;
}

function normalizeMarkdown(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

// Preserve offsets so structural matches can slice the original data examples.
function markdownProse(text) {
  const mask = (value) => value.replace(/[^\n]/g, " ");
  let fence;
  return text.replace(/<!--[^]*?-->/g, mask).split("\n").map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      return mask(line);
    }
    if (marker) {
      fence = marker[1];
      return mask(line);
    }
    return line;
  }).join("\n");
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function withinRealPath(root, target) {
  return within(fs.realpathSync(root), fs.realpathSync(target));
}

function markdownInlineText(text) {
  return text.replace(MARKDOWN_LINK, (link) => link.slice(1, link.indexOf("]")));
}

function escapeLabel(text) {
  return text.replace(/[\\[\]|]/g, "\\$&");
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} 缺少值`);
  }
  return value;
}

function listDirs(root, boundary) {
  return fs.existsSync(root) && fs.lstatSync(root).isDirectory() && withinRealPath(boundary, root)
    ? fs.readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name).sort()
    : [];
}
