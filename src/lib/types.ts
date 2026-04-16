export type PackageManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "uv"
  | "pip"
  | "cargo"
  | "go";

export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
  defaultBranch?: string;
}

export interface CommandHints {
  install?: string;
  build?: string;
  test?: string;
  lint?: string;
}

export interface RepositoryAnalysis {
  rootPath: string;
  repoName: string;
  slug: string;
  remoteUrl?: string;
  github?: GitHubRepositoryRef;
  description?: string;
  readmeExcerpt?: string;
  packageManager?: PackageManager;
  ecosystems: string[];
  languages: string[];
  commandHints: CommandHints;
  files: string[];
}

export interface GenerateTemplateOptions {
  sourceRepoPath: string;
  outDir: string;
  agentName?: string;
  vibe?: string;
}

export interface GeneratedTemplate {
  analysis: RepositoryAnalysis;
  outDir: string;
  writtenFiles: string[];
}
