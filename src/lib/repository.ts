import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  CommandHints,
  GitHubRepositoryRef,
  PackageManager,
  RepositoryAnalysis
} from "./types.js";

const execFileAsync = promisify(execFile);

interface PackageJsonShape {
  name?: string;
  description?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
}

export function parseGitHubRemote(remoteUrl: string): GitHubRepositoryRef | undefined {
  const sshMatch = remoteUrl.match(/^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/);

  if (sshMatch?.groups?.owner && sshMatch.groups.repo) {
    return {
      owner: sshMatch.groups.owner,
      repo: sshMatch.groups.repo
    };
  }

  const sshProtocolMatch = remoteUrl.match(
    /^ssh:\/\/git@github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/,
  );

  if (sshProtocolMatch?.groups?.owner && sshProtocolMatch.groups.repo) {
    return {
      owner: sshProtocolMatch.groups.owner,
      repo: sshProtocolMatch.groups.repo
    };
  }

  const httpsMatch = remoteUrl.match(
    /^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?(?:\/)?$/,
  );

  if (httpsMatch?.groups?.owner && httpsMatch.groups.repo) {
    return {
      owner: httpsMatch.groups.owner,
      repo: httpsMatch.groups.repo
    };
  }

  return undefined;
}

export async function analyzeRepository(inputPath: string): Promise<RepositoryAnalysis> {
  const rootPath = await getGitRoot(inputPath);
  const files = await listTrackedFiles(rootPath);
  const remoteUrl = await getGitConfig(rootPath, "remote.origin.url");
  const github = parseGitHubRemote(remoteUrl ?? "");

  if (github) {
    const defaultBranch = await getDefaultBranch(rootPath);

    if (defaultBranch) {
      github.defaultBranch = defaultBranch;
    }
  }

  const packageJson = await readPackageJson(rootPath);
  const packageManager = detectPackageManager(files, packageJson);
  const commandHints = buildCommandHints(files, packageManager, packageJson);
  const ecosystems = detectEcosystems(files, packageJson);
  const languages = detectLanguages(files);
  const readmeExcerpt = await getReadmeExcerpt(rootPath, files);
  const repoName = deriveRepoName(rootPath, github, packageJson);

  const result: RepositoryAnalysis = {
    rootPath,
    repoName,
    slug: slugify(repoName),
    ecosystems,
    languages,
    commandHints,
    files
  };

  if (remoteUrl) {
    result.remoteUrl = remoteUrl;
  }

  if (github) {
    result.github = github;
  }

  const description = packageJson?.description ?? readmeExcerpt;

  if (description) {
    result.description = description;
  }

  if (readmeExcerpt) {
    result.readmeExcerpt = readmeExcerpt;
  }

  if (packageManager) {
    result.packageManager = packageManager;
  }

  return result;
}

async function runGit(rootPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", rootPath, ...args], {
    encoding: "utf8"
  });
  return stdout.trim();
}

async function getGitRoot(inputPath: string): Promise<string> {
  const resolvedPath = path.resolve(inputPath);
  return runGit(resolvedPath, ["rev-parse", "--show-toplevel"]);
}

async function listTrackedFiles(rootPath: string): Promise<string[]> {
  const stdout = await runGit(rootPath, ["ls-files"]);
  return stdout
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean)
    .sort();
}

async function getGitConfig(rootPath: string, key: string): Promise<string | undefined> {
  try {
    const value = await runGit(rootPath, ["config", "--get", key]);
    return value || undefined;
  } catch {
    return undefined;
  }
}

async function getDefaultBranch(rootPath: string): Promise<string | undefined> {
  try {
    const symbolicRef = await runGit(rootPath, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    const pieces = symbolicRef.split("/");
    return pieces.at(-1);
  } catch {
    return undefined;
  }
}

async function readPackageJson(rootPath: string): Promise<PackageJsonShape | undefined> {
  try {
    const raw = await readFile(path.join(rootPath, "package.json"), "utf8");
    return JSON.parse(raw) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

async function getReadmeExcerpt(rootPath: string, files: string[]): Promise<string | undefined> {
  const readmeName = files.find((file) =>
    ["README.md", "README.mdx", "README.rst", "README.txt"].includes(path.basename(file)),
  );

  if (!readmeName) {
    return undefined;
  }

  try {
    const raw = await readFile(path.join(rootPath, readmeName), "utf8");
    return compactExcerpt(raw);
  } catch {
    return undefined;
  }
}

function compactExcerpt(raw: string): string | undefined {
  const normalized = raw
    .replace(/^#+\s+/gm, "")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, 320);
}

function deriveRepoName(
  rootPath: string,
  github: GitHubRepositoryRef | undefined,
  packageJson: PackageJsonShape | undefined,
): string {
  if (github?.repo) {
    return github.repo;
  }

  if (packageJson?.name) {
    return packageJson.name.split("/").at(-1) ?? packageJson.name;
  }

  return path.basename(rootPath);
}

function detectPackageManager(
  files: string[],
  packageJson: PackageJsonShape | undefined,
): PackageManager | undefined {
  const packageManagerField = packageJson?.packageManager?.split("@")[0];

  if (packageManagerField === "pnpm" || packageManagerField === "yarn" || packageManagerField === "npm") {
    return packageManagerField;
  }

  if (packageManagerField === "bun") {
    return "bun";
  }

  if (files.includes("pnpm-lock.yaml")) {
    return "pnpm";
  }

  if (files.includes("yarn.lock")) {
    return "yarn";
  }

  if (files.includes("bun.lockb") || files.includes("bun.lock")) {
    return "bun";
  }

  if (files.includes("package-lock.json") || files.includes("package.json")) {
    return "npm";
  }

  if (files.includes("uv.lock")) {
    return "uv";
  }

  if (files.includes("requirements.txt") || files.includes("pyproject.toml")) {
    return "pip";
  }

  if (files.includes("Cargo.toml")) {
    return "cargo";
  }

  if (files.includes("go.mod")) {
    return "go";
  }

  return undefined;
}

function buildCommandHints(
  files: string[],
  packageManager: PackageManager | undefined,
  packageJson: PackageJsonShape | undefined,
): CommandHints {
  const scripts = packageJson?.scripts ?? {};

  if (packageJson) {
    const hints: {
      install?: string;
      build?: string;
      test?: string;
      lint?: string;
    } = {};

    const install = installCommandFor(packageManager);
    const build = scriptCommand(packageManager, scripts.build, "build");
    const test = scriptCommand(packageManager, scripts.test, "test");
    const lint = scriptCommand(packageManager, scripts.lint, "lint");

    if (install) {
      hints.install = install;
    }

    if (build) {
      hints.build = build;
    }

    if (test) {
      hints.test = test;
    }

    if (lint) {
      hints.lint = lint;
    }

    return compactCommandHints(hints);
  }

  if (files.includes("uv.lock")) {
    return {
      install: "uv sync",
      test: "uv run pytest"
    };
  }

  if (files.includes("requirements.txt")) {
    return {
      install: "pip install -r requirements.txt",
      test: "pytest"
    };
  }

  if (files.includes("Cargo.toml")) {
    return {
      install: "cargo fetch",
      build: "cargo build",
      test: "cargo test"
    };
  }

  if (files.includes("go.mod")) {
    return {
      install: "go mod download",
      build: "go build ./...",
      test: "go test ./..."
    };
  }

  return {};
}

function installCommandFor(packageManager: PackageManager | undefined): string | undefined {
  switch (packageManager) {
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn install";
    case "bun":
      return "bun install";
    case "npm":
      return "npm install";
    case "uv":
      return "uv sync";
    case "pip":
      return "pip install -r requirements.txt";
    case "cargo":
      return "cargo fetch";
    case "go":
      return "go mod download";
    default:
      return undefined;
  }
}

function scriptCommand(
  packageManager: PackageManager | undefined,
  scriptBody: string | undefined,
  scriptName: string,
): string | undefined {
  if (!scriptBody) {
    return undefined;
  }

  switch (packageManager) {
    case "pnpm":
      return `pnpm ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    case "bun":
      return `bun run ${scriptName}`;
    case "npm":
    default:
      return `npm run ${scriptName}`;
  }
}

function detectEcosystems(files: string[], packageJson: PackageJsonShape | undefined): string[] {
  const ecosystems = new Set<string>();

  if (packageJson || files.includes("package.json")) {
    ecosystems.add("node");
  }

  if (files.includes("pyproject.toml") || files.includes("requirements.txt")) {
    ecosystems.add("python");
  }

  if (files.includes("Cargo.toml")) {
    ecosystems.add("rust");
  }

  if (files.includes("go.mod")) {
    ecosystems.add("go");
  }

  if (files.some((file) => file.startsWith(".github/workflows/"))) {
    ecosystems.add("github-actions");
  }

  return Array.from(ecosystems);
}

function detectLanguages(files: string[]): string[] {
  const languages = new Set<string>();

  for (const file of files) {
    const base = path.basename(file);
    const extension = path.extname(file);

    if (base === "Dockerfile" || file.endsWith(".Dockerfile")) {
      languages.add("docker");
      continue;
    }

    switch (extension) {
      case ".ts":
      case ".tsx":
        languages.add("typescript");
        break;
      case ".js":
      case ".jsx":
      case ".mjs":
      case ".cjs":
        languages.add("javascript");
        break;
      case ".py":
        languages.add("python");
        break;
      case ".rs":
        languages.add("rust");
        break;
      case ".go":
        languages.add("go");
        break;
      case ".sol":
        languages.add("solidity");
        break;
      case ".md":
      case ".mdx":
        languages.add("markdown");
        break;
      default:
        break;
    }
  }

  return Array.from(languages);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function compactCommandHints(hints: {
  install?: string;
  build?: string;
  test?: string;
  lint?: string;
}): CommandHints {
  const result: CommandHints = {};

  if (hints.install) {
    result.install = hints.install;
  }

  if (hints.build) {
    result.build = hints.build;
  }

  if (hints.test) {
    result.test = hints.test;
  }

  if (hints.lint) {
    result.lint = hints.lint;
  }

  return result;
}
