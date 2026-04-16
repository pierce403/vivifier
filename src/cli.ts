#!/usr/bin/env node

import path from "node:path";

import { Command } from "commander";

import { generatePinataTemplate } from "./lib/generator.js";
import { analyzeRepository } from "./lib/repository.js";

const program = new Command();

program
  .name("vivifier")
  .description(
    "Generate a Pinata-deployable repo-maintainer agent from an existing git repository.",
  )
  .showHelpAfterError();

program
  .command("inspect")
  .argument("<source-repo>", "Path to the git repository to inspect")
  .description("Analyze a repository and print the inferred maintainer profile as JSON.")
  .action(async (sourceRepo: string) => {
    const analysis = await analyzeRepository(sourceRepo);
    process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
  });

program
  .command("generate")
  .argument("<source-repo>", "Path to the git repository to transform")
  .argument("[out-dir]", "Directory where the Pinata template repo should be written")
  .option("--agent-name <name>", "Override the generated agent name")
  .option("--vibe <text>", "Override the agent vibe text")
  .description("Generate a Pinata-compatible template repo for a repo-maintainer agent.")
  .action(
    async (
      sourceRepo: string,
      outDir: string | undefined,
      cliOptions: { agentName?: string; vibe?: string },
    ) => {
      const options = {
        sourceRepoPath: sourceRepo,
        outDir: outDir ?? path.join("./generated", `${path.basename(sourceRepo)}-maintainer`)
      } as {
        sourceRepoPath: string;
        outDir: string;
        agentName?: string;
        vibe?: string;
      };

      if (cliOptions.agentName) {
        options.agentName = cliOptions.agentName;
      }

      if (cliOptions.vibe) {
        options.vibe = cliOptions.vibe;
      }

      const generated = await generatePinataTemplate(options);

      process.stdout.write(
        [
          `Generated Pinata template at ${generated.outDir}`,
          `Source repo: ${generated.analysis.rootPath}`,
          `Files written: ${generated.writtenFiles.length}`
        ].join("\n") + "\n",
      );
    },
  );

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
