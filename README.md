# vivifier

`vivifier` turns an existing git repository into a Pinata template for a repo-maintainer agent.

The generated template is shaped for Pinata's hosted OpenClaw agents and includes:

- a `manifest.json` that Pinata can deploy
- the required `workspace/` bootstrap files
- a helper Node app that can listen on XMTP, post casts through Neynar, and operate on GitHub issues and pull requests
- deployment notes for pushing the generated template to GitHub and creating an agent from it on Pinata

## Why this shape

Pinata templates are git repositories with a `manifest.json`, a `README.md`, and a `workspace/` directory. `vivifier` uses that contract as the deployment target instead of trying to reverse-engineer internal Pinata APIs.

## Install

```bash
npm install
npm run build
```

## Usage

Inspect a source repository:

```bash
node dist/cli.js inspect /path/to/source-repo
```

Generate a Pinata-ready template repo:

```bash
node dist/cli.js generate /path/to/source-repo ./generated/my-repo-agent
```

Override the agent name:

```bash
node dist/cli.js generate /path/to/source-repo ./generated/my-repo-agent --agent-name "Repo Warden"
```

Or run the CLI directly from source:

```bash
npm run dev -- inspect /path/to/source-repo
```

## Generated output

The generated repo includes:

- `manifest.json`
- `README.md`
- `DEPLOY.md`
- `workspace/BOOTSTRAP.md`
- `workspace/SOUL.md`
- `workspace/AGENTS.md`
- `workspace/IDENTITY.md`
- `workspace/USER.md`
- `workspace/TOOLS.md`
- `workspace/HEARTBEAT.md`
- `workspace/projects/vivifier-agent/*`

The helper app is intentionally narrow for the first pass. It supports command-driven XMTP interactions such as:

- `status`
- `issues`
- `issue <number>`
- `pr <number>`
- `merge <number>`
- `cast <message>`

That keeps the generated agent operational before a heavier autonomous loop exists.

## Development

```bash
npm run check
```
