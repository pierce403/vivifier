import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { analyzeRepository } from "./repository.js";
import type {
  GenerateTemplateOptions,
  GeneratedTemplate,
  RepositoryAnalysis
} from "./types.js";

const GENERATED_AGENT_SDK_VERSION = "^2.3.0";
const GENERATED_TYPESCRIPT_VERSION = "^6.0.2";
const GENERATED_TSX_VERSION = "^4.21.0";
const GENERATED_DOTENV_VERSION = "^17.4.2";

export async function generatePinataTemplate(
  options: GenerateTemplateOptions,
): Promise<GeneratedTemplate> {
  const analysis = await analyzeRepository(options.sourceRepoPath);
  const outDir = path.resolve(options.outDir);
  await ensureDirectoryDoesNotExist(outDir);

  const files = buildTemplateFiles(analysis, options);

  for (const [relativePath, content] of files) {
    const destination = path.join(outDir, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }

  return {
    analysis,
    outDir,
    writtenFiles: Array.from(files.keys()).sort()
  };
}

async function ensureDirectoryDoesNotExist(targetPath: string): Promise<void> {
  try {
    const existing = await stat(targetPath);

    if (existing.isDirectory() || existing.isFile()) {
      throw new Error(`Output path already exists: ${targetPath}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return;
    }

    throw error;
  }
}

function buildTemplateFiles(
  analysis: RepositoryAnalysis,
  options: GenerateTemplateOptions,
): Map<string, string> {
  const agentName = options.agentName?.trim() || buildDefaultAgentName(analysis);
  const templateSlug = `${analysis.slug}-maintainer`;
  const sourceRepoUrl = analysis.remoteUrl ?? `file://${analysis.rootPath}`;
  const githubOwner = analysis.github?.owner ?? "CHANGE_ME";
  const githubRepo = analysis.github?.repo ?? analysis.repoName;
  const defaultBranch = analysis.github?.defaultBranch ?? "main";
  const repoDescriptor = analysis.github
    ? `${analysis.github.owner}/${analysis.github.repo}`
    : analysis.repoName;
  const vibe =
    options.vibe?.trim() ||
    `A repo maintainer that lives close to ${repoDescriptor}, communicates clearly, and only merges safe changes.`;
  const repoProfile = JSON.stringify(
    {
      source: {
        rootPath: analysis.rootPath,
        remoteUrl: analysis.remoteUrl ?? null
      },
      github: analysis.github ?? null,
      repoName: analysis.repoName,
      slug: analysis.slug,
      description: analysis.description ?? null,
      readmeExcerpt: analysis.readmeExcerpt ?? null,
      ecosystems: analysis.ecosystems,
      languages: analysis.languages,
      commandHints: analysis.commandHints
    },
    null,
    2,
  );

  const files = new Map<string, string>();

  files.set("manifest.json", `${JSON.stringify(buildManifest(agentName, templateSlug, vibe), null, 2)}\n`);
  files.set("README.md", renderTemplateReadme(agentName, repoDescriptor, sourceRepoUrl));
  files.set("DEPLOY.md", renderDeployGuide(sourceRepoUrl));
  files.set(
    "workspace/BOOTSTRAP.md",
    renderBootstrap(agentName, repoDescriptor, defaultBranch, analysis.commandHints.install),
  );
  files.set("workspace/SOUL.md", renderSoul(agentName, repoDescriptor));
  files.set("workspace/AGENTS.md", renderAgentsGuide(repoDescriptor));
  files.set("workspace/IDENTITY.md", renderIdentity(agentName, vibe));
  files.set("workspace/USER.md", "# User Notes\n\nUse this file to accumulate stable maintainer preferences over time.\n");
  files.set("workspace/TOOLS.md", renderToolsGuide(repoDescriptor));
  files.set("workspace/HEARTBEAT.md", renderHeartbeat(repoDescriptor));
  files.set(
    "workspace/projects/vivifier-agent/.env.example",
    renderEnvExample(githubOwner, githubRepo, defaultBranch),
  );
  files.set(
    "workspace/projects/vivifier-agent/package.json",
    renderAgentPackageJson(agentName),
  );
  files.set("workspace/projects/vivifier-agent/tsconfig.json", renderAgentTsconfig());
  files.set("workspace/projects/vivifier-agent/repo-profile.json", `${repoProfile}\n`);
  files.set("workspace/projects/vivifier-agent/src/types.ts", renderAgentTypes());
  files.set("workspace/projects/vivifier-agent/src/config.ts", renderAgentConfig());
  files.set("workspace/projects/vivifier-agent/src/github.ts", renderAgentGitHub());
  files.set("workspace/projects/vivifier-agent/src/farcaster.ts", renderAgentFarcaster());
  files.set("workspace/projects/vivifier-agent/src/xmtp.ts", renderAgentXmtp());
  files.set("workspace/projects/vivifier-agent/src/main.ts", renderAgentMain(agentName));

  return files;
}

function buildDefaultAgentName(analysis: RepositoryAnalysis): string {
  return `${analysis.repoName} Maintainer`;
}

function buildManifest(agentName: string, templateSlug: string, vibe: string) {
  return {
    version: 1,
    agent: {
      name: agentName,
      description:
        "Repo-maintainer agent generated by vivifier. It watches issues, reviews pull requests, posts status updates, and responds over XMTP.",
      emoji: "",
      vibe
    },
    template: {
      slug: templateSlug,
      category: "developer-tools",
      partnerName: "Vivifier",
      tags: ["github", "xmtp", "farcaster", "pinata", "repo-maintainer"]
    },
    secrets: [
      {
        name: "GITHUB_TOKEN",
        description: "GitHub token with repo, issues, and pull request permissions",
        required: true
      },
      {
        name: "NEYNAR_API_KEY",
        description: "Neynar API key for publishing casts",
        required: false
      },
      {
        name: "FARCASTER_SIGNER_UUID",
        description: "Farcaster signer UUID used to publish casts",
        required: false
      },
      {
        name: "XMTP_ENV",
        description: "XMTP network: local, dev, or production",
        required: false
      },
      {
        name: "XMTP_WALLET_KEY",
        description: "EOA private key for the XMTP agent wallet",
        required: false
      },
      {
        name: "XMTP_DB_ENCRYPTION_KEY",
        description: "32-byte hex key for the XMTP local database",
        required: false
      }
    ],
    scripts: {
      build: "cd workspace/projects/vivifier-agent && npm install --include=dev",
      start: "cd workspace/projects/vivifier-agent && npm run start"
    },
    tasks: [
      {
        name: "maintainer-heartbeat",
        schedule: {
          kind: "cron",
          expr: "0 */6 * * *"
        },
        payload: {
          kind: "agentTurn",
          text:
            "Review the repository state, check open issues and pull requests, update workspace memory files, and decide whether an external status update is warranted."
        }
      }
    ]
  };
}

function renderTemplateReadme(agentName: string, repoDescriptor: string, sourceRepoUrl: string): string {
  return `# ${agentName}

This Pinata template was generated by \`vivifier\` for \`${repoDescriptor}\`.

It creates a repo-maintainer agent with three operational surfaces:

- XMTP command handling for maintainer workflows
- Farcaster status casting through Neynar
- GitHub issue and pull request operations through the GitHub REST API

## Source Repository

\`${sourceRepoUrl}\`

## Included Workspace

- \`BOOTSTRAP.md\` to onboard the agent against the target repository
- \`SOUL.md\` and \`AGENTS.md\` to define maintainer behavior
- \`projects/vivifier-agent\` which runs the helper worker for XMTP, Farcaster, and GitHub

## Secrets

Add these secrets when deploying:

- \`GITHUB_TOKEN\`
- \`XMTP_ENV\`, \`XMTP_WALLET_KEY\`, \`XMTP_DB_ENCRYPTION_KEY\` if XMTP should be enabled
- \`NEYNAR_API_KEY\`, \`FARCASTER_SIGNER_UUID\` if Farcaster should be enabled

Deployment steps are in [DEPLOY.md](./DEPLOY.md).
`;
}

function renderDeployGuide(sourceRepoUrl: string): string {
  return `# Deploying This Template

## 1. Publish the generated template repo

Push this generated directory to a public GitHub or GitLab repository.

## 2. Validate the template

\`\`\`bash
pinata agents templates validate <public-template-repo-url>
\`\`\`

## 3. Create an agent from the template

\`\`\`bash
pinata agents create --template <public-template-repo-url>
\`\`\`

You can also paste the repository URL into the Pinata UI when creating an agent.

## 4. Add required secrets

At minimum:

- \`GITHUB_TOKEN\`

Optional integrations:

- \`XMTP_ENV\`
- \`XMTP_WALLET_KEY\`
- \`XMTP_DB_ENCRYPTION_KEY\`
- \`NEYNAR_API_KEY\`
- \`FARCASTER_SIGNER_UUID\`

## 5. Point the agent at the source repo

The generated workspace assumes the source repository is:

\`${sourceRepoUrl}\`

If you fork or rename the source repository, update:

- \`workspace/projects/vivifier-agent/.env.example\`
- \`workspace/projects/vivifier-agent/repo-profile.json\`
- \`workspace/BOOTSTRAP.md\`
`;
}

function renderBootstrap(
  agentName: string,
  repoDescriptor: string,
  defaultBranch: string,
  installCommand: string | undefined,
): string {
  const installLine = installCommand
    ? `4. Run \`${installCommand}\` inside the cloned repo if dependencies are needed.\n`
    : "";

  return `# Bootstrap

You are ${agentName}. Your job is to maintain \`${repoDescriptor}\` safely.

## First Run

1. Clone the target repository into \`workspace/repos/source\`.
2. Read the target repository's README, contribution docs, and CI configuration.
3. Confirm the default branch is \`${defaultBranch}\`.
${installLine}5. Review open issues and pull requests before taking any action.
6. Never merge a pull request unless checks are green and the change is understood.
7. Delete this file after bootstrap is complete so it does not keep re-triggering.
`;
}

function renderSoul(agentName: string, repoDescriptor: string): string {
  return `# Soul

${agentName} is the living maintainer surface for \`${repoDescriptor}\`.

Principles:

- Prefer clarity over volume.
- Only merge pull requests that are low-risk and explainable.
- Use Farcaster for concise public status updates, not long reports.
- Treat XMTP as an operator console with fast command responses.
- Record durable knowledge in workspace files instead of relying on short-term context.
`;
}

function renderAgentsGuide(repoDescriptor: string): string {
  return `# Workspace Rules

- The primary repository under management is \`${repoDescriptor}\`.
- Keep notes about stable maintainer preferences in \`USER.md\`.
- Use the helper app in \`workspace/projects/vivifier-agent\` for GitHub, Farcaster, and XMTP operations.
- Do not merge pull requests when checks are failing, the PR is draft, or the change intent is unclear.
- When posting public updates, prefer measurable state: issue counts, merged PRs, release readiness, blocked work.
`;
}

function renderIdentity(agentName: string, vibe: string): string {
  return `# Identity

Name: ${agentName}
Emoji:
Vibe: ${vibe}
`;
}

function renderToolsGuide(repoDescriptor: string): string {
  return `# Tools

The helper app lives at \`workspace/projects/vivifier-agent\`.

Useful commands:

- \`npm run start\` to start the XMTP listener
- \`npm run issue -- 123\` to summarize issue 123
- \`npm run pr -- 42\` to inspect pull request 42
- \`npm run merge -- 42\` to merge a safe pull request
- \`npm run cast -- "text"\` to publish a Farcaster update
- \`npm run status\` to summarize repository state

The app is configured for \`${repoDescriptor}\`.
`;
}

function renderHeartbeat(repoDescriptor: string): string {
  return `# Heartbeat

On a heartbeat, inspect \`${repoDescriptor}\` and answer:

1. Which open issues need maintainer attention?
2. Which pull requests are mergeable right now?
3. Is there anything worth posting publicly on Farcaster?
4. What should be recorded in USER.md or another workspace note?
`;
}

function renderEnvExample(
  githubOwner: string,
  githubRepo: string,
  defaultBranch: string,
): string {
  return `GITHUB_TOKEN=
GITHUB_OWNER=${githubOwner}
GITHUB_REPO=${githubRepo}
GITHUB_DEFAULT_BRANCH=${defaultBranch}
NEYNAR_API_KEY=
FARCASTER_SIGNER_UUID=
XMTP_ENV=dev
XMTP_WALLET_KEY=
XMTP_DB_ENCRYPTION_KEY=
`;
}

function renderAgentPackageJson(agentName: string): string {
  return `${JSON.stringify(
    {
      name: `${agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-worker`,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        start: "node --import tsx src/main.ts",
        status: "node --import tsx src/main.ts status",
        issues: "node --import tsx src/main.ts issues",
        issue: "node --import tsx src/main.ts issue",
        pr: "node --import tsx src/main.ts pr",
        merge: "node --import tsx src/main.ts merge",
        cast: "node --import tsx src/main.ts cast"
      },
      dependencies: {
        "@xmtp/agent-sdk": GENERATED_AGENT_SDK_VERSION,
        dotenv: GENERATED_DOTENV_VERSION
      },
      devDependencies: {
        "@types/node": "^25.6.0",
        tsx: GENERATED_TSX_VERSION,
        typescript: GENERATED_TYPESCRIPT_VERSION
      }
    },
    null,
    2,
  )}\n`;
}

function renderAgentTsconfig(): string {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
`;
}

function renderAgentTypes(): string {
  return `export interface RepoProfile {
  source: {
    rootPath: string;
    remoteUrl: string | null;
  };
  github: {
    owner: string;
    repo: string;
    defaultBranch?: string;
  } | null;
  repoName: string;
  slug: string;
  description: string | null;
  readmeExcerpt: string | null;
  ecosystems: string[];
  languages: string[];
  commandHints: {
    install?: string;
    build?: string;
    test?: string;
    lint?: string;
  };
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  labels: Array<{ name?: string }>;
  pull_request?: unknown;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  draft: boolean;
  mergeable: boolean | null;
  mergeable_state?: string;
  head: {
    sha: string;
    ref: string;
  };
  base: {
    ref: string;
  };
}

export interface CombinedStatus {
  state: "failure" | "pending" | "success";
}
`;
}

function renderAgentConfig(): string {
  return `import { config as loadDotenv } from "dotenv";
import { readFileSync } from "node:fs";

import type { RepoProfile } from "./types.js";

loadDotenv();

export interface AppConfig {
  repo: RepoProfile;
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
  githubDefaultBranch: string;
  neynarApiKey?: string;
  farcasterSignerUuid?: string;
  xmtpEnabled: boolean;
}

export function loadConfig(): AppConfig {
  const repo = JSON.parse(
    readFileSync(new URL("../repo-profile.json", import.meta.url), "utf8"),
  ) as RepoProfile;

  const githubOwner = process.env.GITHUB_OWNER || repo.github?.owner || "";
  const githubRepo = process.env.GITHUB_REPO || repo.github?.repo || repo.repoName;
  const githubDefaultBranch =
    process.env.GITHUB_DEFAULT_BRANCH || repo.github?.defaultBranch || "main";

  return {
    repo,
    githubToken: required("GITHUB_TOKEN"),
    githubOwner,
    githubRepo,
    githubDefaultBranch,
    neynarApiKey: process.env.NEYNAR_API_KEY || undefined,
    farcasterSignerUuid: process.env.FARCASTER_SIGNER_UUID || undefined,
    xmtpEnabled: Boolean(
      process.env.XMTP_WALLET_KEY &&
        process.env.XMTP_DB_ENCRYPTION_KEY &&
        process.env.XMTP_ENV,
    )
  };
}

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(\`Missing required environment variable: \${name}\`);
  }

  return value;
}
`;
}

function renderAgentGitHub(): string {
  return `import type { CombinedStatus, GitHubIssue, GitHubPullRequest } from "./types.js";

export class GitHubRepoClient {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: string,
  ) {}

  async listOpenIssues(limit = 10): Promise<GitHubIssue[]> {
    const issues = await this.request<GitHubIssue[]>(
      \`/issues?state=open&per_page=\${limit}\`,
    );

    return issues.filter((issue) => !issue.pull_request);
  }

  async listOpenPullRequests(limit = 10): Promise<GitHubPullRequest[]> {
    return this.request<GitHubPullRequest[]>(
      \`/pulls?state=open&per_page=\${limit}\`,
    );
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(\`/issues/\${issueNumber}\`);
  }

  async getPullRequest(prNumber: number): Promise<GitHubPullRequest> {
    return this.request<GitHubPullRequest>(\`/pulls/\${prNumber}\`);
  }

  async getCombinedStatus(ref: string): Promise<CombinedStatus> {
    return this.request<CombinedStatus>(\`/commits/\${ref}/status\`);
  }

  async mergePullRequest(prNumber: number): Promise<{ merged: boolean; message: string }> {
    const response = await this.request<{ merged: boolean; message: string }>(
      \`/pulls/\${prNumber}/merge\`,
      {
        method: "PUT",
        body: JSON.stringify({ merge_method: "squash" })
      },
    );

    return response;
  }

  async summarizeIssue(issueNumber: number): Promise<string> {
    const issue = await this.getIssue(issueNumber);
    const labels = issue.labels.map((label) => label.name).filter(Boolean).join(", ") || "none";
    const excerpt = truncate(issue.body);

    return [
      \`Issue #\${issue.number}: \${issue.title}\`,
      \`State: \${issue.state}\`,
      \`Labels: \${labels}\`,
      \`URL: \${issue.html_url}\`,
      \`Body: \${excerpt}\`
    ].join("\\n");
  }

  async summarizePullRequest(prNumber: number): Promise<string> {
    const pullRequest = await this.getPullRequest(prNumber);
    const status = await this.getCombinedStatus(pullRequest.head.sha);
    const excerpt = truncate(pullRequest.body);

    return [
      \`PR #\${pullRequest.number}: \${pullRequest.title}\`,
      \`State: \${pullRequest.state}\`,
      \`Draft: \${pullRequest.draft ? "yes" : "no"}\`,
      \`Mergeable: \${String(pullRequest.mergeable)}\`,
      \`Mergeable state: \${pullRequest.mergeable_state || "unknown"}\`,
      \`Checks: \${status.state}\`,
      \`Head: \${pullRequest.head.ref}\`,
      \`Base: \${pullRequest.base.ref}\`,
      \`URL: \${pullRequest.html_url}\`,
      \`Body: \${excerpt}\`
    ].join("\\n");
  }

  async getStatusSummary(): Promise<string> {
    const [issues, pullRequests] = await Promise.all([
      this.listOpenIssues(5),
      this.listOpenPullRequests(5)
    ]);

    const issueLine =
      issues.length === 0
        ? "No open issues."
        : \`Open issues: \${issues.map((issue) => \`#\${issue.number}\`).join(", ")}\`;
    const prLine =
      pullRequests.length === 0
        ? "No open pull requests."
        : \`Open pull requests: \${pullRequests
            .map((pullRequest) => \`#\${pullRequest.number}\`)
            .join(", ")}\`;

    return [issueLine, prLine].join("\\n");
  }

  async attemptMerge(prNumber: number): Promise<string> {
    const pullRequest = await this.getPullRequest(prNumber);
    const status = await this.getCombinedStatus(pullRequest.head.sha);

    if (pullRequest.draft) {
      return \`Refusing to merge PR #\${prNumber}: it is still marked as draft.\`;
    }

    if (status.state !== "success") {
      return \`Refusing to merge PR #\${prNumber}: commit status is \${status.state}.\`;
    }

    if (pullRequest.mergeable === false) {
      return \`Refusing to merge PR #\${prNumber}: GitHub reports the PR is not mergeable.\`;
    }

    const result = await this.mergePullRequest(prNumber);
    return result.merged
      ? \`Merged PR #\${prNumber} successfully.\`
      : \`GitHub declined to merge PR #\${prNumber}: \${result.message}\`;
  }

  private async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(
      \`https://api.github.com/repos/\${this.owner}/\${this.repo}\${pathname}\`,
      {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: \`Bearer \${this.token}\`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.headers ?? {})
        }
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(\`GitHub request failed: \${response.status} \${text}\`);
    }

    return (await response.json()) as T;
  }
}

function truncate(input: string | null | undefined): string {
  const normalized = (input || "").replace(/\\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 400) : "No body provided.";
}
`;
}

function renderAgentFarcaster(): string {
  return `export class FarcasterClient {
  constructor(
    private readonly apiKey: string,
    private readonly signerUuid: string,
  ) {}

  async publishCast(text: string): Promise<string> {
    const response = await fetch("https://api.neynar.com/v2/farcaster/cast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey
      },
      body: JSON.stringify({
        signer_uuid: this.signerUuid,
        text
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(\`Failed to publish cast: \${response.status} \${errorText}\`);
    }

    return text;
  }
}
`;
}

function renderAgentXmtp(): string {
  return `import { Agent } from "@xmtp/agent-sdk";

export async function startXmtpCommandLoop(
  onTextMessage: (message: string) => Promise<string>,
): Promise<void> {
  const agent = await Agent.createFromEnv();

  agent.on("start", () => {
    console.log("XMTP listener ready");
    console.log(\`Address: \${agent.address}\`);
  });

  agent.on("text", async (context) => {
    const inbound = context.message.content.trim();
    const outbound = await onTextMessage(inbound);
    await context.conversation.sendText(outbound);
  });

  await agent.start();
}
`;
}

function renderAgentMain(agentName: string): string {
  return `import { FarcasterClient } from "./farcaster.js";
import { GitHubRepoClient } from "./github.js";
import { loadConfig } from "./config.js";
import { startXmtpCommandLoop } from "./xmtp.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const github = new GitHubRepoClient(
    config.githubOwner,
    config.githubRepo,
    config.githubToken,
  );
  const farcaster =
    config.neynarApiKey && config.farcasterSignerUuid
      ? new FarcasterClient(config.neynarApiKey, config.farcasterSignerUuid)
      : undefined;
  const [command, maybeArg, ...rest] = process.argv.slice(2);

  if (!command) {
    console.log(
      \`${agentName} worker starting for \${config.githubOwner}/\${config.githubRepo}\`,
    );

    if (!config.xmtpEnabled) {
      console.log("XMTP secrets are not configured; exiting after startup summary.");
      console.log(await github.getStatusSummary());
      return;
    }

    await startXmtpCommandLoop((message) =>
      handleCommand(message, github, farcaster),
    );
    return;
  }

  const output = await handleProcessArgs(command, maybeArg, rest, github, farcaster);
  console.log(output);
}

async function handleProcessArgs(
  command: string,
  maybeArg: string | undefined,
  rest: string[],
  github: GitHubRepoClient,
  farcaster: FarcasterClient | undefined,
): Promise<string> {
  switch (command) {
    case "status":
      return github.getStatusSummary();
    case "issues":
      return formatIssueList(await github.listOpenIssues(10));
    case "issue":
      return github.summarizeIssue(parseRequiredNumber(maybeArg, "issue number"));
    case "pr":
      return github.summarizePullRequest(parseRequiredNumber(maybeArg, "pull request number"));
    case "merge":
      return github.attemptMerge(parseRequiredNumber(maybeArg, "pull request number"));
    case "cast":
      return publishCast(farcaster, [maybeArg, ...rest].filter(Boolean).join(" "));
    default:
      return \`Unknown command: \${command}\\n\${helpText()}\`;
  }
}

async function handleCommand(
  rawMessage: string,
  github: GitHubRepoClient,
  farcaster: FarcasterClient | undefined,
): Promise<string> {
  const trimmed = rawMessage.trim();

  if (!trimmed) {
    return helpText();
  }

  const [command, maybeArg, ...rest] = trimmed.split(/\\s+/);

  switch (command.toLowerCase()) {
    case "help":
      return helpText();
    case "status":
      return github.getStatusSummary();
    case "issues":
      return formatIssueList(await github.listOpenIssues(10));
    case "issue":
      return github.summarizeIssue(parseRequiredNumber(maybeArg, "issue number"));
    case "pr":
      return github.summarizePullRequest(parseRequiredNumber(maybeArg, "pull request number"));
    case "merge":
      return github.attemptMerge(parseRequiredNumber(maybeArg, "pull request number"));
    case "cast":
      return publishCast(farcaster, rest.length > 0 ? rest.join(" ") : maybeArg || "");
    default:
      return \`Unknown XMTP command: \${command}\\n\${helpText()}\`;
  }
}

async function publishCast(
  farcaster: FarcasterClient | undefined,
  text: string,
): Promise<string> {
  if (!farcaster) {
    return "Farcaster is not configured. Set NEYNAR_API_KEY and FARCASTER_SIGNER_UUID.";
  }

  const normalized = text.trim();

  if (!normalized) {
    return "Usage: cast <message>";
  }

  await farcaster.publishCast(normalized);
  return \`Published cast: \${normalized}\`;
}

function parseRequiredNumber(raw: string | undefined, label: string): number {
  const parsed = Number(raw);

  if (!raw || Number.isNaN(parsed)) {
    throw new Error(\`Expected a valid \${label}.\`);
  }

  return parsed;
}

function formatIssueList(
  issues: Array<{ number: number; title: string }>,
): string {
  if (issues.length === 0) {
    return "No open issues.";
  }

  return issues.map((issue) => \`#\${issue.number} \${issue.title}\`).join("\\n");
}

function helpText(): string {
  return [
    "Commands:",
    "status",
    "issues",
    "issue <number>",
    "pr <number>",
    "merge <number>",
    "cast <message>"
  ].join("\\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
`;
}
