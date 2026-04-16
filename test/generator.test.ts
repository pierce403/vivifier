import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { generatePinataTemplate } from "../src/lib/generator.js";

const execFileAsync = promisify(execFile);

test("generatePinataTemplate writes Pinata-required files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vivifier-test-"));
  const sourceRepo = path.join(tempRoot, "source");
  const outputRepo = path.join(tempRoot, "output");

  await execFileAsync("mkdir", ["-p", sourceRepo]);
  await execFileAsync("git", ["-C", sourceRepo, "init", "-b", "main"], { encoding: "utf8" });
  await writeFile(
    path.join(sourceRepo, "package.json"),
    JSON.stringify(
      {
        name: "@acme/nebula",
        description: "A generated test package",
        scripts: {
          build: "tsc -p tsconfig.json",
          test: "node --test"
        }
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(sourceRepo, "README.md"), "# Nebula\n\nA repo worth keeping alive.\n");
  await execFileAsync("git", ["-C", sourceRepo, "add", "."], { encoding: "utf8" });
  await execFileAsync("git", ["-C", sourceRepo, "config", "user.email", "test@example.com"], {
    encoding: "utf8"
  });
  await execFileAsync("git", ["-C", sourceRepo, "config", "user.name", "Test User"], {
    encoding: "utf8"
  });
  await execFileAsync("git", ["-C", sourceRepo, "commit", "-m", "init"], { encoding: "utf8" });
  await execFileAsync(
    "git",
    ["-C", sourceRepo, "remote", "add", "origin", "https://github.com/acme/nebula.git"],
    { encoding: "utf8" },
  );

  const generated = await generatePinataTemplate({
    sourceRepoPath: sourceRepo,
    outDir: outputRepo
  });

  assert.equal(generated.analysis.repoName, "nebula");
  assert.ok(generated.writtenFiles.includes("manifest.json"));
  assert.ok(generated.writtenFiles.includes("workspace/BOOTSTRAP.md"));
  assert.ok(
    generated.writtenFiles.includes("workspace/projects/vivifier-agent/src/main.ts"),
  );
});
