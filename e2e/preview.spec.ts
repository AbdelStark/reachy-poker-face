import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const TOKEN = "t".repeat(32);
const ORIGIN = "http://127.0.0.1:5173";

async function mockRelay(page: Page, failFinal = false) {
  await page.route("http://127.0.0.1:8047/v1/systemone", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": ORIGIN,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const request = route.request().postDataJSON();
    if ("the_lie" in request.questions) {
      if (failFinal) return route.fulfill({ status: 503, headers, body: JSON.stringify({ error: "judgment_unavailable" }) });
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ model: "fixture", answers: {
        contradiction: { type: "noul", noul: 0.1 },
        the_lie: { type: "choice", choice: "s2", confidence: 0.8 },
        top_cue: { type: "choice", choice: "implausibility", confidence: 0.8 },
      } }) });
    }
    const answers = Object.fromEntries(Object.keys(request.questions).map((key) => [key, { type: "noul", noul: key === "lie_now" ? 0.6 : 0.2 }]));
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ model: "fixture", answers }) });
  });
}

async function playThreeStatements(page: Page) {
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await page.getByRole("button", { name: "Start a round" }).click();
  for (const [index, statement] of [
    "I once climbed a mountain",
    "I once met a dragon",
    "I once grew a tomato",
  ].entries()) {
    await page.locator("#statement").fill(statement);
    await page.getByRole("button", { name: "Lock statement" }).click();
    await expect(page.locator("#statements li")).toHaveCount(index + 1);
  }
  await expect(page.locator("#reveal")).toBeVisible();
}

async function attachSyntheticVideo(page: Page) {
  await expect(page.locator("#robot-video")).toBeAttached();
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    canvas.getContext("2d")!.fillRect(0, 0, 640, 360);
    const video = document.querySelector<HTMLVideoElement>("#robot-video")!;
    video.srcObject = canvas.captureStream(30);
    await video.play();
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => video.addEventListener("loadeddata", () => resolve(), { once: true }));
    }
  });
}

test("preview renders and saves validated game settings", async ({ page }) => {
  await page.goto("/?preview=1");
  await expect(page.getByRole("heading", { name: "Poker Face" })).toBeVisible();
  await expect(page.locator("#connection")).toHaveText("UI preview");
  await page.locator("#w-lie-now").evaluate((input: HTMLInputElement) => {
    input.value = "80";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#o-lie-now")).toHaveText("80%");
  await expect(page.locator("#settings-status")).toContainText("saved");
  await page.reload();
  await expect(page.locator("#w-lie-now")).toHaveValue("80");
  await page.locator("#t-hedge").evaluate((input: HTMLInputElement) => {
    input.value = "90";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#settings-status")).toContainText("hedge must be below confident");
});

test("preview fits a narrow phone viewport without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=1");
  await expect(page.locator("#connection")).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
});

test("silent clip recorder requires consent and produces a local video blob", async ({ page }) => {
  await page.goto("/?preview=1");
  const result = await page.evaluate(async () => {
    const { ClipRecorder } = await import("/src/clip.ts");
    const source = document.createElement("canvas");
    source.width = 640;
    source.height = 360;
    source.getContext("2d")!.fillRect(0, 0, 640, 360);
    const stream = source.captureStream(30);
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => video.addEventListener("loadeddata", () => resolve(), { once: true }));
    }
    let denied = false;
    try { new ClipRecorder(video, () => ({ statementNumber: 1, probability: 0.5, verdict: "Test" }), false); }
    catch { denied = true; }
    const recorder = new ClipRecorder(video, () => ({ statementNumber: 1, probability: 0.5, verdict: "Test" }), true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const file = await recorder.finish();
    const discardedRecorder = new ClipRecorder(video, () => ({ statementNumber: 1, probability: 0.5, verdict: "Test" }), true);
    const discarded = await discardedRecorder.discard();
    stream.getTracks().forEach((track) => track.stop());
    return { denied, size: file?.blob.size ?? 0, type: file?.blob.type ?? "", extension: file?.extension ?? "", discarded };
  });
  expect(result.denied).toBe(true);
  expect(result.size).toBeGreaterThan(0);
  expect(result.type).toMatch(/^video\//);
  expect(["webm", "mp4"]).toContain(result.extension);
  expect(result.discarded).toBeNull();
});

test("a Jev-backed round updates the local leaderboard without saving statements", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?preview=1");
  await playThreeStatements(page);
  await page.locator("#nickname").fill("Ada");
  await page.locator('button[data-lie="s1"]').click();
  await expect(page.locator("#score")).toContainText("1 Jev round");
  await expect(page.locator("#leaderboard li")).toContainText("Ada · fooled Reachy 1/1 rounds");
  const saved = await page.evaluate(() => localStorage.getItem("reachy-poker-face.leaderboard.v1"));
  expect(saved).not.toContain("mountain");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear saved scores" }).click();
  await expect(page.locator("#leaderboard li")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("reachy-poker-face.leaderboard.v1"))).toBeNull();
});

test("an explicitly consented round offers a silent local clip download", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?preview=1");
  await attachSyntheticVideo(page);
  await page.locator("#clip-consent").check();
  await playThreeStatements(page);
  await expect(page.locator("#clip-consent")).not.toBeChecked();
  await page.locator('button[data-lie="s2"]').click();
  await expect(page.getByRole("button", { name: "Download local clip" })).toBeVisible({ timeout: 6000 });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download local clip" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^pokerface-.*\.(webm|mp4)$/);
});

test("reset discards a consented recording before export", async ({ page }) => {
  await page.goto("/?preview=1");
  await attachSyntheticVideo(page);
  await page.locator("#clip-consent").check();
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await page.getByRole("button", { name: "Start a round" }).click();
  await expect(page.locator("#clip-status")).toContainText("Recording silent");
  await page.getByRole("button", { name: "New round" }).click();
  await expect(page.locator("#clip-status")).toContainText("discarded");
  await expect(page.locator("#download-clip")).toBeHidden();
  await expect(page.locator("#clip-consent")).not.toBeChecked();
});

test("an unavailable final judgment is explicit and unranked", async ({ page }) => {
  await mockRelay(page, true);
  await page.goto("/?preview=1");
  await playThreeStatements(page);
  await page.locator("#nickname").fill("Ada");
  await page.locator('button[data-lie="s1"]').click();
  await expect(page.locator("#score")).toContainText("1 fallback round");
  await expect(page.locator("#score")).toContainText("0 Jev rounds");
  await expect(page.locator("#leaderboard-status")).toContainText("not ranked");
  await expect(page.locator("#leaderboard li")).toHaveCount(0);
});

test("default session trace download is text-free and keeps final provenance", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?preview=1");
  await playThreeStatements(page);
  await page.locator('button[data-lie="s2"]').click();
  await expect(page.locator("#trace-status")).toContainText("1 completed round");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download trace JSONL" }).click();
  const download = await downloadPromise;
  const jsonl = await readFile(await download.path(), "utf8");
  const record = JSON.parse(jsonl.trim());
  expect(record.schema).toBe("pokerface.round@1");
  expect(record.pick).toMatchObject({ source: "jev", choice: "s2", model: "fixture" });
  expect(record.correct).toBe(true);
  expect(jsonl).not.toContain("mountain");
  expect(jsonl).not.toContain("dragon");
  expect(jsonl).not.toContain("tomato");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Discard session trace" }).click();
  await expect(page.getByRole("button", { name: "Download trace JSONL" })).toBeDisabled();
});

test("statement text enters a trace only with per-round consent", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?preview=1");
  await page.locator("#trace-text-consent").check();
  await playThreeStatements(page);
  await expect(page.locator("#trace-text-consent")).not.toBeChecked();
  await expect(page.locator("#trace-text-consent")).toBeDisabled();
  await page.locator('button[data-lie="s1"]').click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download trace JSONL" }).click();
  const jsonl = await readFile(await (await downloadPromise).path(), "utf8");
  expect(jsonl).toContain("I once climbed a mountain");
  expect(jsonl).not.toContain("nickname");
});
