import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRelayServer } from "../server/relay.mjs";

const TOKEN = "f".repeat(40);
const ORIGIN = "http://127.0.0.1:5173";

test("a synthetic full round retries one failed final relay call and exports a consistent trace", async ({ page }) => {
  const requests: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = [];
  let finalAttempts = 0;
  const server = createRelayServer({
    token: TOKEN,
    allowedOrigin: ORIGIN,
    ask: async (state: Record<string, unknown>, questions: Record<string, unknown>) => {
      requests.push({ state, questions });
      if ("the_lie" in questions) {
        if (++finalAttempts === 1) throw new Error("synthetic transient final failure");
        return { model: "synthetic-relay", answers: {
          contradiction: { type: "noul", noul: 0.1 },
          the_lie: { type: "choice", choice: "s2", confidence: 0.81 },
          commit_style: { type: "choice", choice: "hedge", confidence: 0.75 },
          top_cue: { type: "choice", choice: "implausibility", confidence: 0.8 },
        } };
      }
      return { model: "synthetic-relay", answers: Object.fromEntries(
        Object.keys(questions).map((key) => [key, { type: "noul", noul: key === "lie_now" ? 0.6 : 0.2 }]),
      ) };
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture relay did not bind to loopback");
  try {
    await page.goto("/?preview=1");
    await page.locator("#relay-url").fill(`http://127.0.0.1:${address.port}`);
    await page.locator("#relay-token").fill(TOKEN);
    await page.getByRole("button", { name: "Connect relay" }).click();
    await page.locator("#start").click();
    await page.getByRole("button", { name: "Begin statement 1" }).click();
    for (const [index, text] of [
      "I once climbed a mountain",
      "I once met a dragon",
      "I once grew a tomato",
    ].entries()) {
      await page.locator("#statement").fill(text);
      await page.getByRole("button", { name: "Lock statement" }).click();
      await expect(page.locator("#statements li")).toHaveCount(index + 1);
    }
    await expect(page.locator("#reveal")).toBeVisible();
    await expect(page.locator("#status")).toContainText("received on retry");
    await expect(page.locator("#verdict")).toContainText("Number 2");
    await expect(page.locator("#verdict")).toContainText("game guess, not proof");
    await expect(page.locator("#final-cue")).toContainText("implausibility");
    expect(requests).toHaveLength(5);
    expect(finalAttempts).toBe(2);
    expect(requests.map(({ state }) => state.bank)).toEqual([
      "pokerface.live@0.1.0", "pokerface.live@0.1.0", "pokerface.live@0.1.0",
      "pokerface.final@0.1.0", "pokerface.final@0.1.0",
    ]);
    expect(requests.slice(0, 3).map(({ questions }) => Object.keys(questions).length)).toEqual([5, 5, 5]);
    expect(requests.slice(3).map(({ questions }) => Object.keys(questions).length)).toEqual([4, 4]);
    expect(JSON.stringify(requests)).not.toContain(TOKEN);

    await page.locator("#reveal button[data-lie='s2']").click();
    await expect(page.locator("#trace-status")).toContainText("1 completed round");
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#download-trace").click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("fixture trace download has no local path");
    const trace = JSON.parse((await readFile(path, "utf8")).trim());
    expect(trace.pick).toMatchObject({ choice: "s2", source: "jev" });
    expect(trace.pick).toMatchObject({ model: "synthetic-relay", style: "confident", modelCommitStyle: "hedge", styleDisagrees: true });
    expect(trace).not.toHaveProperty("nickname");
    expect(JSON.stringify(trace)).not.toContain("dragon");
  } finally {
    await page.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
