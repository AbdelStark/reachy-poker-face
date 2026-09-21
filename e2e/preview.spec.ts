import { test, expect, type Page } from "@playwright/test";

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
