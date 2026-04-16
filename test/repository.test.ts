import assert from "node:assert/strict";
import test from "node:test";

import { parseGitHubRemote } from "../src/lib/repository.js";

test("parseGitHubRemote handles https remotes", () => {
  assert.deepEqual(parseGitHubRemote("https://github.com/openai/openai.git"), {
    owner: "openai",
    repo: "openai"
  });
});

test("parseGitHubRemote handles ssh remotes", () => {
  assert.deepEqual(parseGitHubRemote("git@github.com:acme/tools.git"), {
    owner: "acme",
    repo: "tools"
  });
});

test("parseGitHubRemote ignores non-GitHub remotes", () => {
  assert.equal(parseGitHubRemote("https://gitlab.com/acme/tools.git"), undefined);
});
