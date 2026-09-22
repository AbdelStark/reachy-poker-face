import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TOKEN = "t".repeat(32);
const ORIGIN = "http://127.0.0.1:5173";

function fixtureWav(): Buffer {
  const bytes = Buffer.alloc(44 + 16_000);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}

async function mockRelay(page: Page, failFinal = false, failLiveAt = 0) {
  let liveCalls = 0;
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
        commit_style: { type: "choice", choice: "hedge", confidence: 0.8 },
        top_cue: { type: "choice", choice: "implausibility", confidence: 0.8 },
      } }) });
    }
    if (++liveCalls === failLiveAt) return route.fulfill({ status: 503, headers, body: JSON.stringify({ error: "judgment_unavailable" }) });
    const answers = Object.fromEntries(Object.keys(request.questions).map((key) => [key, { type: "noul", noul: key === "lie_now" ? 0.6 : 0.2 }]));
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ model: "fixture", answers }) });
  });
}

async function startRound(page: Page) {
  await page.locator("#start").click();
  await page.getByRole("button", { name: "Begin statement 1" }).click();
}

async function playThreeStatements(page: Page) {
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await startRound(page);
  for (const [index, statement] of [
    "I once climbed a mountain",
    "I once met a dragon",
    "I once grew a tomato",
  ].entries()) {
    await page.locator("#statement").fill(statement);
    await page.getByRole("button", { name: "Lock statement" }).click();
    await expect(page.locator("#statements li")).toHaveCount(index + 1);
    await expect(page.locator("#cue-rows li")).toHaveCount(4);
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

test("offline fixture completes a typed round without model calls, capture, ranking, or calibration export", async ({ page }) => {
  const modelRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/v1\/(systemone|asr|tts)$/.test(new URL(request.url()).pathname)) modelRequests.push(request.url());
  });
  await page.goto("/?preview=1&fixture=1");
  await page.evaluate(() => {
    (window as unknown as { fixtureSpeechCalls: number }).fixtureSpeechCalls = 0;
    window.speechSynthesis.speak = () => {
      (window as unknown as { fixtureSpeechCalls: number }).fixtureSpeechCalls++;
    };
  });
  await expect(page.locator(".fixture-banner")).toContainText("not Jev");
  await expect(page.locator("#relay-form")).toBeHidden();
  await expect(page.locator("#connection")).toContainText("Offline fixture");
  await expect(page.locator("#clip-consent")).toBeDisabled();
  await expect(page.locator("#nickname")).toBeDisabled();
  await expect(page.locator("#browser-mic-consent")).toBeDisabled();
  await page.locator("#start").click();
  await expect(page.locator("#intro-gate")).toContainText("No audio is played");
  await page.getByRole("button", { name: "Begin statement 1" }).click();
  for (const [index, statement] of [
    "I once climbed a mountain",
    "I once met a dragon",
    "I once grew a tomato",
  ].entries()) {
    await page.locator("#statement").fill(statement);
    await page.getByRole("button", { name: "Lock statement" }).click();
    await expect(page.locator("#statements li")).toHaveCount(index + 1);
    await expect(page.locator("#cue-note")).toContainText("fixed synthetic values");
  }
  await expect(page.locator("#reveal")).toBeVisible();
  await expect(page.locator("#verdict")).toContainText("Offline fixture pick");
  await expect(page.locator("#final-cue")).toBeHidden();
  await page.locator("#reveal button[data-lie='s2']").click();
  await expect(page.locator("#score")).toContainText("1 offline fixture round");
  await expect(page.locator("#trace-status")).toContainText("excluded from calibration");
  await expect(page.locator("#download-trace")).toBeDisabled();
  await expect(page.locator("#leaderboard-status")).toContainText("not ranked or saved");
  expect(await page.evaluate(() => localStorage.getItem("reachy-poker-face.leaderboard.v1"))).toBeNull();
  expect(await page.evaluate(() => (window as unknown as { fixtureSpeechCalls: number }).fixtureSpeechCalls)).toBe(0);
  expect(modelRequests).toEqual([]);
});

test("opening line blocks capture and clip recording until the operator begins statement one", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?preview=1");
  await attachSyntheticVideo(page);
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await page.locator("#clip-consent").check();
  await page.locator("#start").click();
  await expect(page.locator("#phase")).toContainText("Opening line");
  await expect(page.locator("#intro-gate")).toBeVisible();
  await expect(page.locator(".capture")).toBeHidden();
  await expect(page.locator("#clip-status")).toContainText("will start with statement 1");
  await expect(page.locator("#discard-clip")).toBeHidden();
  await expect(page.locator("#clip-consent")).toBeDisabled();
  await page.getByRole("button", { name: "New round" }).click();
  await expect(page.locator("#phase")).toHaveText("Ready when you are.");
  await expect(page.locator("#intro-gate")).toBeHidden();
  await expect(page.locator("#clip-status")).toContainText("No clip recording requested");
  await page.locator("#clip-consent").check();
  await startRound(page);
  await expect(page.locator(".capture")).toBeVisible();
  await expect(page.locator("#clip-status")).toContainText("Recording silent local clip");
});

test("new round cancels a pending judgment and ignores its late answer", async ({ page }) => {
  let firstStarted = false;
  let releaseFirst: (() => void) | undefined;
  const seen: string[] = [];
  await page.route("http://127.0.0.1:8047/v1/systemone", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": ORIGIN,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const request = route.request().postDataJSON();
    seen.push(request.state.statement.text);
    if (seen.length === 1) {
      firstStarted = true;
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
    }
    const answers = Object.fromEntries(Object.keys(request.questions).map((key) => [key, { type: "noul", noul: 0.2 }]));
    try { await route.fulfill({ status: 200, headers, body: JSON.stringify({ model: "fixture", answers }) }); }
    catch { /* Reset aborts the first browser request before its fixture reply. */ }
  });
  await page.goto("/?preview=1");
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await startRound(page);
  await page.locator("#statement").fill("First round pending statement");
  await page.getByRole("button", { name: "Lock statement" }).click();
  await expect.poll(() => firstStarted).toBe(true);
  await expect(page.getByRole("button", { name: "New round" })).toBeEnabled();
  await page.getByRole("button", { name: "New round" }).click();
  await startRound(page);
  await page.locator("#statement").fill("Second round accepted statement");
  await page.getByRole("button", { name: "Lock statement" }).click();
  await expect(page.locator("#statements li")).toHaveCount(1);
  await expect(page.locator("#statements li")).toContainText(["Second round accepted statement"]);
  releaseFirst?.();
  await page.waitForTimeout(150);
  expect(seen).toEqual(["First round pending statement", "Second round accepted statement"]);
  await expect(page.locator("#statements li")).toContainText(["Second round accepted statement"]);
  await expect(page.locator("#phase")).toHaveText("Statement 2 of 3");
});

test("new round ignores a late browser-recognition callback", async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = "";
      onresult: ((event: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() { (window as unknown as { fakeRecognition: FakeRecognition }).fakeRecognition = this; }
      stop() { this.onend?.(); }
    }
    (window as unknown as { SpeechRecognition: typeof FakeRecognition }).SpeechRecognition = FakeRecognition;
  });
  await mockRelay(page);
  await page.goto("/?preview=1");
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await startRound(page);
  await page.locator("#browser-mic-consent").check();
  await page.getByRole("button", { name: "Use browser microphone" }).click();
  const oldHandler = await page.evaluateHandle(() => (window as unknown as { fakeRecognition: { onresult: unknown } }).fakeRecognition.onresult);
  await page.getByRole("button", { name: "New round" }).click();
  await startRound(page);
  await page.evaluate((handler) => {
    (handler as (event: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void)({ results: [{ isFinal: true, 0: { transcript: "Old round should not return" } }] });
  }, oldHandler);
  await expect(page.locator("#statement")).toHaveValue("");
  await expect(page.locator("#statements li")).toHaveCount(0);
});

test("browser speech requires fresh round consent and revocation fences late results", async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = "";
      onresult: ((event: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() { (window as unknown as { fakeRecognition: FakeRecognition; starts: number }).fakeRecognition = this; (window as unknown as { starts: number }).starts++; }
      stop() { (window as unknown as { stops: number }).stops++; this.onend?.(); }
    }
    (window as unknown as { starts: number; stops: number }).starts = 0;
    (window as unknown as { starts: number; stops: number }).stops = 0;
    (window as unknown as { SpeechRecognition: typeof FakeRecognition }).SpeechRecognition = FakeRecognition;
  });
  await mockRelay(page);
  await page.goto("/?preview=1");
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await startRound(page);
  await expect(page.locator("#browser-mic-consent")).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Use browser microphone" })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { starts: number }).starts)).toBe(0);

  await page.locator("#browser-mic-consent").check();
  await page.getByRole("button", { name: "Use browser microphone" }).click();
  await expect(page.getByRole("button", { name: "Stop browser microphone" })).toBeEnabled();
  const oldHandler = await page.evaluateHandle(() => (window as unknown as { fakeRecognition: { onresult: unknown } }).fakeRecognition.onresult);
  await page.evaluate((handler) => {
    (handler as (event: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void)({ results: [{ isFinal: true, 0: { transcript: "Draft recognized words here" } }] });
  }, oldHandler);
  await expect(page.locator("#statement")).toHaveValue("Draft recognized words here");
  await page.locator("#browser-mic-consent").uncheck();
  expect(await page.evaluate(() => (window as unknown as { stops: number }).stops)).toBe(1);
  await expect(page.getByRole("button", { name: "Use browser microphone" })).toBeDisabled();
  await page.evaluate((handler) => {
    (handler as (event: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void)({ results: [{ isFinal: true, 0: { transcript: "Revoked speech must not return" } }] });
  }, oldHandler);
  await page.waitForTimeout(1600);
  await expect(page.locator("#statement")).toHaveValue("Draft recognized words here");
  await expect(page.locator("#statements li")).toHaveCount(0);

  await page.getByRole("button", { name: "New round" }).click();
  await startRound(page);
  await expect(page.locator("#browser-mic-consent")).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Use browser microphone" })).toBeDisabled();
});

test("connected game keeps motion and antenna-tap start off until session arm", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?preview=1");
  await page.evaluate(async () => {
    const commands: unknown[] = [];
    const robot = Object.assign(new EventTarget(), {
      state: "streaming",
      subscribePose() {},
      unsubscribePose() {},
      gotoTarget(target: unknown) { commands.push(target); return true; },
    });
    const { mountApp } = await import("/src/embed.ts");
    const cleanup = mountApp(robot as never, { attachVideo: () => () => {} } as never);
    (window as unknown as { fakeMotion: { commands: unknown[]; robot: EventTarget; cleanup: () => void } }).fakeMotion = { commands, robot, cleanup };
  });
  const commands = () => page.evaluate(() => (window as unknown as { fakeMotion: { commands: unknown[] } }).fakeMotion.commands.length);
  expect(await commands()).toBe(0);
  await page.evaluate(() => {
    const robot = (window as unknown as { fakeMotion: { robot: EventTarget } }).fakeMotion.robot;
    robot.dispatchEvent(new CustomEvent("state", { detail: { antennas: [0.4, 0] } }));
    robot.dispatchEvent(new CustomEvent("state", { detail: { antennas: [0.4, 0] } }));
  });
  await expect(page.locator("#phase")).toHaveText("Ready when you are.");
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await startRound(page);
  await page.locator("#statement").fill("I once climbed a mountain");
  await page.getByRole("button", { name: "Lock statement" }).click();
  await expect(page.locator("#statements li")).toHaveCount(1);
  await page.waitForTimeout(750);
  expect(await commands()).toBe(0);
  await page.locator("#motion-enable").check();
  expect(await commands()).toBe(1); // Neutral pose is first requested after the explicit arm.
  await page.locator("#motion-enable").uncheck();
  await page.locator("#statement").fill("I once met a dragon");
  await page.getByRole("button", { name: "Lock statement" }).click();
  await expect(page.locator("#statements li")).toHaveCount(2);
  await page.waitForTimeout(750);
  expect(await commands()).toBe(1);
  await page.locator("#motion-enable").check();
  expect(await commands()).toBe(2);
  await page.locator("#statement").fill("I once grew a tomato");
  await page.getByRole("button", { name: "Lock statement" }).click();
  await expect(page.locator("#reveal")).toBeVisible();
  expect(await commands()).toBeGreaterThan(2);
  await page.locator("#motion-enable").uncheck();
  const countBeforeLeave = await commands();
  await page.evaluate(() => (window as unknown as { fakeMotion: { cleanup: () => void } }).fakeMotion.cleanup());
  expect(await commands()).toBe(countBeforeLeave);
});

test("a failed live cue keeps the statement open and requests neutral motion", async ({ page }) => {
  await mockRelay(page, false, 2);
  await page.goto("/?preview=1");
  await page.evaluate(async () => {
    const commands: Array<{ antennas?: number[] }> = [];
    const robot = {
      state: "streaming",
      subscribePose() {}, unsubscribePose() {}, addEventListener() {}, removeEventListener() {},
      gotoTarget(target: { antennas?: number[] }) { commands.push(target); return true; },
    };
    const { mountApp } = await import("/src/embed.ts");
    mountApp(robot as never, { attachVideo: () => () => {} } as never);
    (window as unknown as { failedLiveCommands: typeof commands }).failedLiveCommands = commands;
  });
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await page.locator("#motion-enable").check();
  await startRound(page);
  await page.locator("#statement").fill("I once climbed a mountain");
  await page.getByRole("button", { name: "Lock statement" }).click();
  await expect(page.locator("#statements li")).toHaveCount(1);
  await page.waitForTimeout(750); // Let the successful reaction's own neutral timer finish.
  const meterBeforeFailure = await page.locator("#meter-value").textContent();
  const beforeFailure = await page.evaluate(() => (window as unknown as { failedLiveCommands: unknown[] }).failedLiveCommands.length);
  await page.locator("#statement").fill("I once met a dragon");
  await page.getByRole("button", { name: "Lock statement" }).click();
  await expect(page.locator("#phase")).toHaveText("Statement 2 of 3");
  await expect(page.locator("#statements li")).toHaveCount(1);
  await expect(page.locator("#meter-value")).toHaveText(meterBeforeFailure ?? "");
  await expect(page.locator("#status")).toContainText("statement was not locked");
  const commands = await page.evaluate(() => (window as unknown as { failedLiveCommands: Array<{ antennas?: number[] }> }).failedLiveCommands);
  expect(commands).toHaveLength(beforeFailure + 1);
  expect(commands.at(-1)?.antennas).toEqual([0, 0]);
});

test("a relay limit explains why a live statement remains unlocked", async ({ page }) => {
  let posts = 0;
  await page.route("http://127.0.0.1:8047/v1/systemone", async (route) => {
    const headers = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    posts++;
    return route.fulfill({ status: 429, headers, body: JSON.stringify({ error: "upstream_attempt_limit" }) });
  });
  await page.goto("/?preview=1");
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await startRound(page);
  await page.locator("#statement").fill("I once climbed a mountain");
  await page.getByRole("button", { name: "Lock statement" }).click();
  await expect(page.locator("#status")).toContainText("Jev relay limit reached; statement not locked");
  await expect(page.locator("#statements li")).toHaveCount(0);
  expect(posts).toBe(1);
});

test("a rejected live request leaves the statement unlocked with an actionable status", async ({ page }) => {
  let posts = 0;
  await page.route("http://127.0.0.1:8047/v1/systemone", async (route) => {
    const headers = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    posts++;
    return route.fulfill({ status: 401, headers, body: JSON.stringify({ error: "unauthorized", private_detail: "not for UI" }) });
  });
  await page.goto("/?preview=1");
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await startRound(page);
  await page.locator("#statement").fill("I once climbed a mountain");
  await page.getByRole("button", { name: "Lock statement" }).click();
  await expect(page.locator("#status")).toContainText("Jev relay rejected the request; statement not locked");
  await expect(page.locator("#status")).not.toContainText("private_detail");
  await expect(page.locator("#statements li")).toHaveCount(0);
  expect(posts).toBe(1);
});

test("a rejected game pose disarms motion without losing the text round", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?preview=1");
  await page.evaluate(async () => {
    let commands = 0;
    const robot = {
      state: "streaming",
      subscribePose() {}, unsubscribePose() {}, addEventListener() {}, removeEventListener() {},
      gotoTarget() { if (++commands > 1) throw new Error("synthetic SDK pose failure"); return true; },
    };
    const { mountApp } = await import("/src/embed.ts");
    (window as unknown as { failedMotionCleanup: () => void }).failedMotionCleanup = mountApp(robot as never, { attachVideo: () => () => {} } as never);
  });
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await page.locator("#motion-enable").check();
  await startRound(page);
  for (const [index, statement] of ["I once climbed a mountain", "I once met a dragon", "I once grew a tomato"].entries()) {
    await page.locator("#statement").fill(statement);
    await page.getByRole("button", { name: "Lock statement" }).click();
    await expect(page.locator("#statements li")).toHaveCount(index + 1);
  }
  await expect(page.locator("#motion-enable")).not.toBeChecked();
  await expect(page.locator("#motion-status")).toContainText("Motion request failed");
  await expect(page.locator("#reveal")).toBeVisible();
  await page.evaluate(() => (window as unknown as { failedMotionCleanup: () => void }).failedMotionCleanup());
});

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

test("explicit robot-speaker mode cancels the opening line before capture", async ({ page }) => {
  const wav = fixtureWav();
  let requests = 0;
  await page.route("http://127.0.0.1:8050/v1/tts", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": ORIGIN,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "audio/wav",
      "Content-Length": String(wav.length),
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    requests++;
    expect(route.request().postDataJSON()).toEqual({ text: requests === 1
      ? "This is a game, not a lie detector. I judge language cues, not truth. Three statements. Go."
      : "Three statements. Go." });
    if (requests === 2) return route.fulfill({ status: 503, headers, body: "" });
    return route.fulfill({ status: 200, headers, body: wav });
  });
  await page.goto("/?preview=1");
  await page.evaluate(async () => {
    const events: string[] = [];
    (window as unknown as { robotEvents: string[] }).robotEvents = events;
    Object.defineProperty(window.speechSynthesis, "speak", { value: () => events.push("browser-speak"), configurable: true });
    const robot = {
      subscribePose() {}, unsubscribePose() {}, gotoTarget() {},
      addEventListener() {}, removeEventListener() {},
      uploadAudio: async (blob: Blob) => { events.push(`upload:${blob.type}:${blob.size}`); return "fixture-upload"; },
      playUploadedAudio: async (id: string) => { events.push(`play:${id}`); return { started: true as const }; },
      cancelAudio: (id: string) => { events.push(`cancel:${id}`); return true; },
    };
    const media = { attachVideo: () => () => {} };
    const { mountApp } = await import("/src/embed.ts");
    mountApp(robot as never, media as never);
  });
  await page.locator("#tts-token").fill(TOKEN);
  await page.getByRole("button", { name: "Configure local TTS" }).click();
  await page.locator("#tts-robot").check();
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await page.locator("#start").click();
  await expect(page.locator("#tts-status")).toContainText("playback started");
  const events = await page.evaluate(() => (window as unknown as { robotEvents: string[] }).robotEvents);
  expect(events).toEqual([`upload:audio/wav:${wav.length}`, "play:fixture-upload"]);
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Begin statement 1" }).click();
  await expect(page.locator("#tts-status")).toContainText("cancellation requested before capture");
  await expect.poll(() => page.evaluate(() => (window as unknown as { robotEvents: string[] }).robotEvents.at(-1))).toBe("cancel:fixture-upload");
  await page.getByRole("button", { name: "New round" }).click();
  await page.locator("#start").click();
  await expect(page.locator("#tts-status")).toContainText("no browser fallback");
  await page.getByRole("button", { name: "Begin statement 1" }).click();
  expect(await page.evaluate(() => (window as unknown as { robotEvents: string[] }).robotEvents)).not.toContain("browser-speak");
  expect(requests).toBe(2);
});

test("robot-speaker pick uses the fixed final cue line, never player statements", async ({ page }) => {
  await mockRelay(page);
  const spoken: string[] = [];
  const wav = fixtureWav();
  await page.route("http://127.0.0.1:8050/v1/tts", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": ORIGIN,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "audio/wav",
      "Content-Length": String(wav.length),
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    spoken.push(route.request().postDataJSON().text);
    return route.fulfill({ status: 200, headers, body: wav });
  });
  await page.goto("/?preview=1");
  await page.evaluate(async () => {
    const robot = {
      subscribePose() {}, unsubscribePose() {}, gotoTarget() { return true; },
      addEventListener() {}, removeEventListener() {},
      uploadAudio: async () => "fixture-upload",
      playUploadedAudio: async () => ({ started: true }),
      cancelAudio: () => true,
    };
    const { mountApp } = await import("/src/embed.ts");
    mountApp(robot as never, { attachVideo: () => () => {} } as never);
  });
  await page.locator("#tts-token").fill(TOKEN);
  await page.getByRole("button", { name: "Configure local TTS" }).click();
  await page.locator("#tts-robot").check();
  await playThreeStatements(page);
  await expect(page.locator("#verdict")).toContainText("Jev found the story a stretch");
  await expect.poll(() => spoken.length).toBe(2);
  expect(spoken[1]).toContain("Jev found the story a stretch");
  expect(spoken[1]).toContain("game guess, not proof");
  expect(spoken.join(" ")).not.toContain("climbed a mountain");
  expect(spoken.join(" ")).not.toContain("met a dragon");
  expect(spoken.join(" ")).not.toContain("grew a tomato");
});

test("preview fits a narrow phone viewport without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockRelay(page);
  await page.goto("/?preview=1");
  await expect(page.locator("#connection")).toBeVisible();
  await playThreeStatements(page);
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

test("clip consent can be withdrawn mid-round without ending the game", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?preview=1");
  await attachSyntheticVideo(page);
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await page.locator("#clip-consent").check();
  await startRound(page);
  await expect(page.locator("#clip-status")).toContainText("Recording silent local clip");
  await expect(page.locator("#discard-clip")).toBeVisible();
  await page.getByRole("button", { name: "Stop and discard clip" }).click();
  await expect(page.locator("#discard-clip")).toBeHidden();
  await expect(page.locator("#download-clip")).toBeHidden();
  await expect(page.locator("#clip-status")).toContainText("clip discarded");
  await expect(page.locator("#phase")).toContainText("Statement 1 of 3");
  for (const [index, statement] of ["I climbed a mountain", "I met a dragon", "I grew a tomato"].entries()) {
    await page.locator("#statement").fill(statement);
    await page.getByRole("button", { name: "Lock statement" }).click();
    await expect(page.locator("#statements li")).toHaveCount(index + 1);
  }
  await expect(page.locator("#reveal")).toBeVisible();
  await page.locator("#reveal button[data-lie=s2]").click();
  await expect(page.locator("#phase")).toHaveText("Round complete.");
  await expect(page.locator("#download-clip")).toBeHidden();
  await expect(page.locator("#discard-clip")).toBeHidden();

  await page.getByRole("button", { name: "New round" }).click();
  await page.locator("#clip-consent").check();
  await startRound(page);
  for (const [index, statement] of ["I swam a lake", "I flew to Mars", "I planted a tree"].entries()) {
    await page.locator("#statement").fill(statement);
    await page.getByRole("button", { name: "Lock statement" }).click();
    await expect(page.locator("#statements li")).toHaveCount(index + 1);
  }
  await expect(page.locator("#reveal")).toBeVisible();
  await page.locator("#reveal button[data-lie=s2]").click();
  await expect(page.locator("#download-clip")).toBeVisible({ timeout: 7_000 });
  await page.getByRole("button", { name: "Discard local clip" }).click();
  await expect(page.locator("#download-clip")).toBeHidden();
  await expect(page.locator("#discard-clip")).toBeHidden();
  await expect(page.locator("#clip-status")).toContainText("clip discarded");
  const exportAttempted = await page.evaluate(() => {
    const original = URL.createObjectURL;
    let called = false;
    URL.createObjectURL = () => { called = true; return "blob:fixture"; };
    try { document.querySelector<HTMLButtonElement>("#download-clip")!.click(); }
    finally { URL.createObjectURL = original; }
    return called;
  });
  expect(exportAttempted).toBe(false);
});

test("clip capture falls back to WebM when advertised MP4 construction fails", async ({ page }) => {
  await page.goto("/?preview=1");
  const result = await page.evaluate(async () => {
    const { ClipRecorder } = await import("/src/clip.ts");
    const NativeRecorder = MediaRecorder;
    class RejectMp4 extends NativeRecorder {
      static isTypeSupported(mimeType: string) {
        return mimeType.startsWith("video/mp4") || NativeRecorder.isTypeSupported(mimeType);
      }
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        if (options?.mimeType?.startsWith("video/mp4")) throw new DOMException("MP4 encoder unavailable", "NotSupportedError");
        super(stream, options);
      }
    }
    Object.defineProperty(window, "MediaRecorder", { value: RejectMp4, configurable: true });
    const source = document.createElement("canvas");
    source.width = 640;
    source.height = 360;
    source.getContext("2d")!.fillRect(0, 0, 640, 360);
    const stream = source.captureStream(30);
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    try {
      await video.play();
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await new Promise<void>((resolve) => video.addEventListener("loadeddata", () => resolve(), { once: true }));
      }
      const recorder = new ClipRecorder(video, () => ({ statementNumber: 1, probability: 0.5, verdict: "Test" }), true);
      await new Promise((resolve) => setTimeout(resolve, 600));
      const file = await recorder.finish();
      return { advertisedMp4: RejectMp4.isTypeSupported("video/mp4;codecs=avc1.42E01E"), extension: file?.extension, type: file?.blob.type, size: file?.blob.size ?? 0 };
    } finally {
      stream.getTracks().forEach((track) => track.stop());
      Object.defineProperty(window, "MediaRecorder", { value: NativeRecorder, configurable: true });
    }
  });
  expect(result.advertisedMp4).toBe(true);
  expect(result.extension).toBe("webm");
  expect(result.type).toContain("video/webm");
  expect(result.size).toBeGreaterThan(0);
});

test("an oversized recorder chunk fails closed and releases its local video track", async ({ page }) => {
  await page.goto("/?preview=1");
  const result = await page.evaluate(async () => {
    const { ClipRecorder } = await import("/src/clip.ts");
    const NativeRecorder = MediaRecorder;
    class OversizeRecorder {
      static isTypeSupported(mimeType: string) { return mimeType.startsWith("video/webm"); }
      mimeType = "video/webm";
      state: RecordingState = "inactive";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        this.state = "recording";
        queueMicrotask(() => this.ondataavailable?.({ data: new Blob([new Uint8Array(16_000_001)]) } as BlobEvent));
      }
      stop() { this.state = "inactive"; this.onstop?.(); }
    }
    Object.defineProperty(window, "MediaRecorder", { value: OversizeRecorder, configurable: true });
    const source = document.createElement("canvas");
    source.width = 640;
    source.height = 360;
    source.getContext("2d")!.fillRect(0, 0, 640, 360);
    const stream = source.captureStream(30);
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    try {
      await video.play();
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await new Promise<void>((resolve) => video.addEventListener("loadeddata", () => resolve(), { once: true }));
      }
      const recorder = new ClipRecorder(video, () => ({ statementNumber: 1, probability: null, verdict: "Test" }), true);
      await Promise.resolve(); // Deliver the synthetic oversized chunk before asking for completion.
      const file = await recorder.finish();
      const ownStream = (recorder as unknown as { stream: MediaStream }).stream;
      return { file, released: ownStream.getTracks().every((track) => track.readyState === "ended") };
    } finally {
      stream.getTracks().forEach((track) => track.stop());
      Object.defineProperty(window, "MediaRecorder", { value: NativeRecorder, configurable: true });
    }
  });
  expect(result).toEqual({ file: null, released: true });
});

test("a Jev-backed round updates the local leaderboard without saving statements", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?preview=1");
  await playThreeStatements(page);
  await expect(page.locator("#cue-note")).toContainText("model judgments, not evidence");
  await expect(page.locator("#cue-rows li").first()).toContainText("50% weight");
  await expect(page.locator("#final-cue")).toContainText("Jev highlighted implausibility");
  await expect(page.locator("#final-cue")).toContainText("not evidence");
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

test("a new round does not inherit the previous player's leaderboard nickname", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?preview=1");
  await playThreeStatements(page);
  await page.locator("#nickname").fill("Ada");
  await page.locator('button[data-lie="s1"]').click();
  await expect(page.locator("#leaderboard li")).toContainText("Ada · fooled Reachy 1/1 rounds");

  await page.getByRole("button", { name: "New round" }).click();
  await expect(page.locator("#nickname")).toBeEmpty();
  await expect(page.locator("#leaderboard-status")).toBeEmpty();
  await startRound(page);
  for (const [index, statement] of ["I once climbed a mountain", "I once met a dragon", "I once grew a tomato"].entries()) {
    await page.locator("#statement").fill(statement);
    await page.getByRole("button", { name: "Lock statement" }).click();
    await expect(page.locator("#statements li")).toHaveCount(index + 1);
  }
  await expect(page.locator("#reveal")).toBeVisible();
  await page.locator('button[data-lie="s1"]').click();
  await expect(page.locator("#leaderboard li")).toHaveCount(1);
  await expect(page.locator("#leaderboard li")).toContainText("Ada · fooled Reachy 1/1 rounds");
});

test("an explicitly consented round offers a silent local clip download", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?preview=1");
  const mp4Ready = await page.evaluate(() => {
    const mimeType = "video/mp4;codecs=avc1.42E01E";
    if (!MediaRecorder.isTypeSupported(mimeType)) return false;
    const stream = document.createElement("canvas").captureStream(1);
    try { new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 }); return true; }
    catch { return false; }
    finally { stream.getTracks().forEach((track) => track.stop()); }
  });
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
  const extension = download.suggestedFilename().split(".").at(-1);
  if (mp4Ready) expect(extension).toBe("mp4");
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_type,width,height:format=format_name,duration",
    "-of", "json", await download.path(),
  ]);
  const probe = JSON.parse(stdout) as {
    streams: Array<{ codec_type: string; width?: number; height?: number }>;
    format: { format_name: string; duration?: string };
  };
  expect(probe.streams).toEqual([{ codec_type: "video", width: 1280, height: 720 }]);
  expect(Number(probe.format.duration)).toBeGreaterThan(0);
  expect(Number(probe.format.duration)).toBeLessThanOrEqual(31);
  if (extension === "mp4") expect(probe.format.format_name).toContain("mp4");
  else expect(probe.format.format_name).toContain("webm");
});

test("file-capable browsers offer an explicit share sheet and retain the clip after cancellation", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { shareCalls: Array<{ name: string; type: string; size: number }>; cancelShare: boolean; failShareSynchronously: boolean };
    state.shareCalls = [];
    state.cancelShare = true;
    state.failShareSynchronously = false;
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data: ShareData) => data.files?.length === 1 && data.files[0]!.type.startsWith("video/"),
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: (data: ShareData) => {
        const file = data.files![0]!;
        state.shareCalls.push({ name: file.name, type: file.type, size: file.size });
        if (state.failShareSynchronously) throw new DOMException("Share unavailable", "InvalidStateError");
        return state.cancelShare ? Promise.reject(new DOMException("User cancelled", "AbortError")) : Promise.resolve();
      },
    });
  });
  await mockRelay(page);
  await page.goto("/?preview=1");
  await attachSyntheticVideo(page);
  await page.locator("#clip-consent").check();
  await playThreeStatements(page);
  await expect(page.locator("#share-clip")).toBeHidden();
  await page.locator('button[data-lie="s2"]').click();
  await expect(page.locator("#share-clip")).toBeVisible({ timeout: 7_000 });
  await page.locator("#share-clip").click();
  await expect(page.locator("#clip-status")).toContainText("Share cancelled");
  await expect(page.locator("#download-clip")).toBeVisible();
  await page.evaluate(() => {
    const OriginalDate = Date;
    Object.assign(window, { Date: class extends OriginalDate {
      constructor() { super(OriginalDate.now() + 120_000); }
    } });
  });
  await page.evaluate(() => { (window as unknown as { cancelShare: boolean }).cancelShare = false; });
  await page.locator("#share-clip").click();
  await expect(page.locator("#clip-status")).toContainText("Share sheet returned");
  const calls = await page.evaluate(() => (window as unknown as { shareCalls: Array<{ name: string; type: string; size: number }> }).shareCalls);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[0]!.name).toMatch(/^pokerface-.*\.(mp4|webm)$/);
  expect(calls[0]!.type).toMatch(/^video\/(mp4|webm)$/);
  expect(calls[0]!.size).toBeGreaterThan(0);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-clip").click();
  expect((await downloadPromise).suggestedFilename()).toBe(calls[0]!.name);
  await page.evaluate(() => { (window as unknown as { failShareSynchronously: boolean }).failShareSynchronously = true; });
  await page.locator("#share-clip").click();
  await expect(page.locator("#clip-status")).toContainText("Sharing failed");
  await expect(page.locator("#share-clip")).toBeEnabled();
  await expect(page.locator("#download-clip")).toBeVisible();
  await page.getByRole("button", { name: "Discard local clip" }).click();
  await expect(page.locator("#share-clip")).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { shareCalls: unknown[] }).shareCalls.length)).toBe(3);
});

test("browsers without file sharing keep the clip download-only", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
    Object.defineProperty(navigator, "share", { configurable: true, value: () => { throw new Error("must not share"); } });
  });
  await mockRelay(page);
  await page.goto("/?preview=1");
  await attachSyntheticVideo(page);
  await page.locator("#clip-consent").check();
  await playThreeStatements(page);
  await page.locator('button[data-lie="s2"]').click();
  await expect(page.locator("#download-clip")).toBeVisible({ timeout: 7_000 });
  await expect(page.locator("#share-clip")).toBeHidden();
});

test("reset discards a consented recording before export", async ({ page }) => {
  await page.goto("/?preview=1");
  await attachSyntheticVideo(page);
  await page.locator("#clip-consent").check();
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await startRound(page);
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
  await expect(page.locator("#final-cue")).toBeHidden();
  await page.locator("#nickname").fill("Ada");
  await page.locator('button[data-lie="s1"]').click();
  await expect(page.locator("#score")).toContainText("1 fallback round");
  await expect(page.locator("#score")).toContainText("0 Jev rounds");
  await expect(page.locator("#leaderboard-status")).toContainText("not ranked");
  await expect(page.locator("#leaderboard li")).toHaveCount(0);
});

test("a final relay limit makes one request and an explicit unranked fallback", async ({ page }) => {
  await mockRelay(page);
  let finalPosts = 0;
  await page.route("http://127.0.0.1:8047/v1/systemone", async (route) => {
    if (route.request().method() !== "POST" || !("the_lie" in route.request().postDataJSON().questions)) return route.fallback();
    finalPosts++;
    return route.fulfill({ status: 429, headers: { "Access-Control-Allow-Origin": ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ error: "upstream_attempt_limit" }) });
  });
  await page.goto("/?preview=1");
  await playThreeStatements(page);
  await expect(page.locator("#status")).toContainText("Jev relay limit reached; no retry sent");
  expect(finalPosts).toBe(1);
  await page.locator('button[data-lie="s2"]').click();
  await expect(page.locator("#score")).toContainText("1 fallback round");
});

test("a rejected final request skips retry and keeps the fallback unranked", async ({ page }) => {
  await mockRelay(page);
  let finalPosts = 0;
  await page.route("http://127.0.0.1:8047/v1/systemone", async (route) => {
    if (route.request().method() !== "POST" || !("the_lie" in route.request().postDataJSON().questions)) return route.fallback();
    finalPosts++;
    return route.fulfill({ status: 401, headers: { "Access-Control-Allow-Origin": ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ error: "unauthorized", private_detail: "not for UI" }) });
  });
  await page.goto("/?preview=1");
  await playThreeStatements(page);
  await expect(page.locator("#status")).toContainText("Jev relay rejected the final request; no retry sent");
  await expect(page.locator("#status")).not.toContainText("private_detail");
  expect(finalPosts).toBe(1);
  await page.locator('button[data-lie="s2"]').click();
  await expect(page.locator("#score")).toContainText("1 fallback round");
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
  expect(record.pick).toMatchObject({
    source: "jev", choice: "s2", model: "fixture",
    style: "confident", modelCommitStyle: "hedge", styleDisagrees: true,
  });
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

test("synthetic robot stream yields bounded PCM and word-timed delivery without audio output", async ({ page }) => {
  await page.goto("/?preview=1");
  const result = await page.evaluate(async () => {
    const { RobotStatementRecorder } = await import("/src/robot_audio.ts");
    const { LocalAsrPort } = await import("/src/asr.ts");
    const { analyzeDelivery } = await import("/src/cues.ts");
    const source = new AudioContext();
    const oscillator = source.createOscillator();
    const destination = source.createMediaStreamDestination();
    oscillator.connect(destination); // No browser speaker connection.
    oscillator.start();
    await source.resume();
    const recorder = new RobotStatementRecorder(destination.stream, () => {});
    try {
      await recorder.start();
      for (let i = 0; i < 60 && (recorder as unknown as { sampleCount: number }).sampleCount < source.sampleRate * 0.3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const pcm = await recorder.stop();
      const view = new DataView(pcm.buffer);
      let peak = 0;
      for (let i = 0; i < Math.min(pcm.length / 4, 1000); i++) peak = Math.max(peak, Math.abs(view.getFloat32(i * 4, true)));
      let requestBytes = 0;
      const fetcher = async (_url: URL, init: RequestInit) => {
        requestBytes = (init.body as ArrayBuffer).byteLength;
        return { ok: true, json: async () => ({ text: "I paused here today", words: [
          { word: "I", startMs: 0, endMs: 30 },
          { word: "paused", startMs: 40, endMs: 100 },
          { word: "here", startMs: 110, endMs: 160 },
          { word: "today", startMs: 170, endMs: 220 },
        ] }) } as Response;
      };
      const asr = new LocalAsrPort("http://127.0.0.1:8049", "t".repeat(32), fetcher as typeof fetch);
      const transcript = await asr.transcribe(pcm);
      pcm.fill(0);
      return { requestBytes, peak, text: transcript.text, delivery: analyzeDelivery(transcript.words).delivery };
    } finally {
      await recorder.discard();
      oscillator.stop();
      await source.close();
    }
  });
  expect(result.requestBytes).toBeGreaterThan(16_000);
  expect(result.requestBytes).toBeLessThanOrEqual(16_000 * 15 * 4);
  expect(result.peak).toBeGreaterThan(0.001);
  expect(result.text).toBe("I paused here today");
  expect(result.delivery.length).toBeGreaterThan(0);
});

test("robot-audio consent and timed ASR feed the statement Jev state", async ({ page }) => {
  const states: Record<string, unknown>[] = [];
  await mockRelay(page);
  page.on("request", (request) => {
    if (request.url() === "http://127.0.0.1:8047/v1/systemone" && request.method() === "POST") {
      states.push(request.postDataJSON().state as Record<string, unknown>);
    }
  });
  let asrCalls = 0;
  await page.route("http://127.0.0.1:8049/v1/asr", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": ORIGIN,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    asrCalls++;
    expect(route.request().postDataBuffer()!.length).toBeGreaterThan(16_000);
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ text: "I once paused here", words: [
      { word: "I", startMs: 0, endMs: 100 },
      { word: "once", startMs: 140, endMs: 250 },
      { word: "paused", startMs: 800, endMs: 1000 },
      { word: "here", startMs: 1080, endMs: 1200 },
    ] }) });
  });
  await page.goto("/?preview=1");
  await page.evaluate(async () => {
    const source = new AudioContext();
    const oscillator = source.createOscillator();
    const destination = source.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    await source.resume();
    const { mountApp } = await import("/src/embed.ts");
    const robot = {
      state: "streaming", subscribePose() {}, unsubscribePose() {}, gotoTarget() { return true; },
      addEventListener() {}, removeEventListener() {},
    };
    const media = { robotStream: destination.stream, attachVideo() { return () => {}; } };
    const cleanup = mountApp(robot as never, media as never);
    (window as unknown as { fakeRobotCleanup: () => Promise<void> }).fakeRobotCleanup = async () => {
      cleanup(); oscillator.stop(); await source.close();
    };
  });
  await page.locator("#relay-token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect relay" }).click();
  await startRound(page);
  await page.locator("#asr-token").fill(TOKEN);
  await page.getByRole("button", { name: "Configure local ASR" }).click();
  await page.getByRole("button", { name: "Record robot microphone" }).click();
  await expect(page.locator("#status")).toContainText("consent");
  expect(asrCalls).toBe(0);
  await page.locator("#asr-consent").check();
  await page.getByRole("button", { name: "Record robot microphone" }).click();
  await expect(page.locator("#asr-status")).toContainText("Recording Reachy's microphone");
  await page.locator("#asr-consent").uncheck();
  await expect(page.locator("#asr-status")).toContainText("consent cleared");
  expect(asrCalls).toBe(0);
  await page.locator("#asr-consent").check();
  await page.getByRole("button", { name: "Record robot microphone" }).click();
  await expect(page.locator("#asr-status")).toContainText("Recording Reachy's microphone");
  await page.waitForTimeout(1400);
  await page.getByRole("button", { name: "Stop & transcribe" }).click();
  await expect(page.locator("#statement")).toHaveValue("I once paused here");
  await expect(page.locator("#asr-status")).toContainText("4 timed words");
  expect(asrCalls).toBe(1);
  await page.getByRole("button", { name: "Lock statement" }).click();
  await expect(page.locator("#statements li")).toHaveCount(1);
  const live = states.find((state) => state.bank === "pokerface.live@0.1.0");
  expect((live?.statement as { delivery?: string[] }).delivery).toContain("hesitant");
  expect(Object.keys(live?.statement as Record<string, unknown>).sort()).toEqual(["delivery", "id", "length", "text"]);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.evaluate(() => (window as unknown as { fakeRobotCleanup: () => Promise<void> }).fakeRobotCleanup());
});
