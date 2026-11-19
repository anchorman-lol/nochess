import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { fileStore } from "./node.ts";

test("a service's game keys outlive its process, and are dropped with their game", () => {
  const file = join(mkdtempSync(join(tmpdir(), "nochess-")), "bot-sessions.json");
  const before = fileStore(file);
  before.setItem("nochess:session:31640:host:a", "secret-a");
  before.setItem("nochess:session:31640:host:b", "secret-b");
  before.forget("31640:host:a");
  const after = fileStore(file);
  expect(after.getItem("nochess:session:31640:host:a")).toBeNull();
  expect(after.getItem("nochess:session:31640:host:b")).toBe("secret-b");
});
