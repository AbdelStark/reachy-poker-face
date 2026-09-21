import { connectToHost } from "@pollen-robotics/reachy-mini-sdk/host/embed";
import { AntennaTap } from "./antenna.js";
import { askFinal, askLive, type JevPort } from "./jev.js";
import { performCoinFlip, showSuspicion, toSdkTarget } from "./motion.js";
import { RelayPort } from "./relay.js";
import { Round, type StatementId } from "./round.js";
import { DEFAULT_SETTINGS, gameSettings, parseSettings, SETTINGS_KEY, type GameSettings } from "./settings.js";
import { LEADERBOARD_KEY, parseLeaderboard, recordRound, type LeaderboardEntry } from "./leaderboard.js";
import "./style.css";

type Robot = Awaited<ReturnType<typeof connectToHost>>["reachy"];
type RobotMedia = Awaited<ReturnType<typeof connectToHost>>["media"];
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { results: ArrayLike<SpeechResult> };
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("root element missing");

function randomPick(): StatementId {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return (["s1", "s2", "s3"] as const)[value[0]! % 3]!;
}
function speakLocal(text: string): void {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.96;
  speechSynthesis.speak(utterance);
}
function createRecognition(): Recognition | null {
  const browser = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function mountApp(robot?: Robot, media?: RobotMedia) {
  root!.innerHTML = `
    <main class="app">
      <header class="masthead"><div class="brand"><span class="brand-icon">🃏</span><div><p class="eyebrow">Reachy Mini game</p><h1>Poker Face</h1></div></div><div id="connection" class="connection"></div></header>
      <div class="layout">
        <section class="stage" aria-label="Game stage">
          <div class="video-wrap"><video id="robot-video" autoplay playsinline muted aria-label="Reachy Mini camera"></video><div class="video-fallback" id="video-fallback">${robot ? "Waiting for robot camera…" : "Preview mode · no robot connected"}</div><span class="live-badge">LIVE PROBABILITY</span></div>
          <div class="meter-card"><div class="meter-top"><span>How suspicious did that sound?</span><strong id="meter-value">—</strong></div><div class="meter-track" role="progressbar" aria-label="Suspicion probability" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="meter"><div class="meter-fill" id="meter-fill"></div></div><p class="meter-note">Jev judges linguistic cues for a party game. This is not a lie detector.</p></div>
          <div class="verdict" id="verdict" aria-live="polite">Three statements. Two truths. One very expressive robot.</div>
        </section>
        <section class="controls" aria-label="Game controls">
          <div class="card"><div class="section-heading"><span class="step">01</span><h2>Connect Jev</h2></div><p class="small">Use a trusted relay. Your TypeSafe API key stays on its server; the relay token remains in this tab only.</p><form id="relay-form"><label>Relay URL<input id="relay-url" type="url" value="http://127.0.0.1:8047" autocomplete="url" required /></label><label>Session token<input id="relay-token" type="password" autocomplete="off" minlength="32" required /></label><button type="submit" class="secondary">Connect relay</button></form><p id="relay-status" class="status" aria-live="polite">Not connected</p></div>
          <div class="card"><div class="section-heading"><span class="step">02</span><h2>Game settings</h2></div><p class="small">Weights and commit thresholds apply to the next judgment. They are saved on this device; no statement text or relay token is saved.</p><form id="settings-form" class="settings-grid"><label>Lie-now cue <output for="w-lie-now" id="o-lie-now">50%</output><input id="w-lie-now" type="range" min="0" max="100" step="1" /></label><label>Implausibility <output for="w-implausible" id="o-implausible">20%</output><input id="w-implausible" type="range" min="0" max="100" step="1" /></label><label>Hedging <output for="w-hedged" id="o-hedged">20%</output><input id="w-hedged" type="range" min="0" max="100" step="1" /></label><label>Over-detail <output for="w-too-specific" id="o-too-specific">10%</output><input id="w-too-specific" type="range" min="0" max="100" step="1" /></label><label>Hedge from <output for="t-hedge" id="o-hedge">40%</output><input id="t-hedge" type="range" min="0" max="100" step="1" /></label><label>Confident from <output for="t-confident" id="o-confident">70%</output><input id="t-confident" type="range" min="0" max="100" step="1" /></label></form><p id="settings-status" class="status" aria-live="polite"></p><p class="small">Poker Face reacts to language cues in a party game. It cannot determine whether anyone is telling the truth.</p></div>
          <div class="card"><div class="section-heading"><span class="step">03</span><h2>Play</h2></div><p id="phase" class="phase">Ready when you are.</p><button id="start" class="primary" type="button">Start a round</button><div class="capture"><label for="statement">Statement <span id="statement-number">1</span> of 3</label><textarea id="statement" rows="3" maxlength="400" placeholder="Say or type one statement…"></textarea><div class="capture-actions"><button id="mic" class="secondary" type="button">Use microphone</button><button id="submit" class="primary" type="button">Lock statement</button></div><p class="small">Microphone mode uses your browser's speech service, which may process audio off-device. No audio is recorded by this app. Antenna tap works only while the antennas are neutral.</p></div><ol id="statements" class="statement-list"></ol><div id="reveal" class="reveal"><p>Which statement was the lie?</p><div class="reveal-actions"><button data-lie="s1" type="button">1</button><button data-lie="s2" type="button">2</button><button data-lie="s3" type="button">3</button></div></div><button id="reset" class="text-button" type="button">New round</button><p id="score" class="score">0 rounds played</p></div>
          <div class="card"><div class="section-heading"><span class="step">04</span><h2>Local leaderboard</h2></div><p class="small">Type a nickname before revealing the lie to save this round's score on this device. Leave it blank for a tab-only game. No statement text is saved.</p><label for="nickname">Player nickname<input id="nickname" type="text" maxlength="24" autocomplete="off" placeholder="Optional" /></label><ol id="leaderboard" class="leaderboard-list"></ol><button id="clear-leaderboard" class="text-button" type="button">Clear saved scores</button><p id="leaderboard-status" class="status" aria-live="polite"></p></div>
          <p id="status" class="status" role="status" aria-live="polite"></p>
        </section>
      </div>
      <footer>Typed judgments choose; game code decides. Speech cues play on this browser, not the robot speaker.</footer>
    </main>`;

  const q = <T extends HTMLElement>(selector: string) => {
    const element = root!.querySelector<T>(selector);
    if (!element) throw new Error(`missing UI element: ${selector}`);
    return element;
  };
  const relayForm = q<HTMLFormElement>("#relay-form");
  const tokenInput = q<HTMLInputElement>("#relay-token");
  const urlInput = q<HTMLInputElement>("#relay-url");
  const relayStatus = q<HTMLElement>("#relay-status");
  const settingsForm = q<HTMLFormElement>("#settings-form");
  const settingsStatus = q<HTMLElement>("#settings-status");
  const status = q<HTMLElement>("#status");
  const nickname = q<HTMLInputElement>("#nickname");
  const leaderboardStatus = q<HTMLElement>("#leaderboard-status");
  const statement = q<HTMLTextAreaElement>("#statement");
  const video = q<HTMLVideoElement>("#robot-video");
  let round = new Round();
  let roundVersion = 0;
  let settings: GameSettings;
  try { settings = parseSettings(localStorage.getItem(SETTINGS_KEY)); }
  catch { settings = gameSettings(DEFAULT_SETTINGS); }
  let leaderboard: LeaderboardEntry[];
  try { leaderboard = parseLeaderboard(localStorage.getItem(LEADERBOARD_KEY)); }
  catch { leaderboard = []; }
  let disclaimerSpoken = false;
  let relay: JevPort | undefined;
  let busy = false;
  let rounds = 0;
  let wins = 0;
  let fallbackRounds = 0;
  let recognition: Recognition | null = null;
  let micActive = false;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let neutralReadyAt = 0;
  const taps = new AntennaTap();
  const cleanupVideo = media?.attachVideo(video);
  if (robot) {
    q<HTMLElement>("#video-fallback").hidden = true;
    robot.subscribePose();
    robot.gotoTarget(toSdkTarget({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, zMm: 0, rightAntennaDeg: 0, leftAntennaDeg: 0 }, 0.6));
    neutralReadyAt = performance.now() + 900;
  }
  q<HTMLElement>("#connection").textContent = robot ? "Robot connected" : "UI preview";

  const sliderIds = ["w-lie-now", "w-implausible", "w-hedged", "w-too-specific", "t-hedge", "t-confident"] as const;
  const outputIds = ["o-lie-now", "o-implausible", "o-hedged", "o-too-specific", "o-hedge", "o-confident"] as const;
  const initialValues = [settings.weights.lie_now, settings.weights.implausible, settings.weights.hedged, settings.weights.too_specific, settings.thresholds.hedge, settings.thresholds.confident];
  sliderIds.forEach((id, index) => { q<HTMLInputElement>(`#${id}`).value = String(Math.round(initialValues[index]! * 100)); });
  function updateSettingOutputs() {
    sliderIds.forEach((id, index) => { q<HTMLOutputElement>(`#${outputIds[index]}`).value = `${q<HTMLInputElement>(`#${id}`).value}%`; });
  }
  updateSettingOutputs();
  settingsStatus.textContent = "Current settings loaded.";

  function announce(message: string, isError = false) {
    status.textContent = message;
    status.classList.toggle("error", isError);
  }
  function renderLeaderboard() {
    const list = q<HTMLOListElement>("#leaderboard");
    list.replaceChildren(...leaderboard.map((entry) => {
      const item = document.createElement("li");
      item.textContent = `${entry.name} · fooled Reachy ${entry.fooled}/${entry.rounds} rounds`;
      return item;
    }));
    q<HTMLButtonElement>("#clear-leaderboard").disabled = leaderboard.length === 0;
    if (!leaderboard.length) list.textContent = "No saved scores yet.";
  }
  function render() {
    const snapshot = round.snapshot;
    const capture = snapshot.phase === "capture";
    q<HTMLElement>("#phase").textContent = snapshot.phase === "idle" ? "Ready when you are." : snapshot.phase === "reveal" ? "The robot has chosen. Reveal the lie." : snapshot.phase === "score" ? "Round complete." : snapshot.phase === "think" ? "Thinking…" : `Statement ${snapshot.statementNumber} of 3`;
    q<HTMLElement>("#statement-number").textContent = String(snapshot.statementNumber);
    q<HTMLButtonElement>("#start").hidden = snapshot.phase !== "idle";
    q<HTMLElement>(".capture").hidden = !capture;
    q<HTMLElement>("#reveal").hidden = snapshot.phase !== "reveal";
    q<HTMLButtonElement>("#submit").disabled = !capture || busy;
    q<HTMLButtonElement>("#reset").disabled = busy;
    q<HTMLButtonElement>("#mic").disabled = !capture || busy || !createRecognition();
    q<HTMLButtonElement>("#mic").textContent = micActive ? "Stop microphone" : "Use microphone";
    const list = q<HTMLOListElement>("#statements");
    list.replaceChildren(...snapshot.statements.map((entry) => {
      const item = document.createElement("li");
      item.textContent = `${entry.id.toUpperCase()} · ${entry.text}`;
      return item;
    }));
    q<HTMLElement>("#score").textContent = `${rounds} Jev round${rounds === 1 ? "" : "s"} · ${wins} correct pick${wins === 1 ? "" : "s"} · ${fallbackRounds} fallback round${fallbackRounds === 1 ? "" : "s"}`;
  }
  function meter(p: number) {
    q<HTMLElement>("#meter-value").textContent = `${Math.round(p * 100)}%`;
    q<HTMLElement>("#meter-fill").style.width = `${Math.round(p * 100)}%`;
    q<HTMLElement>("#meter").setAttribute("aria-valuenow", String(Math.round(p * 100)));
  }
  function neutralAfterReaction() {
    if (!robot) return;
    setTimeout(() => {
      if (round.snapshot.phase !== "capture") return;
      robot.gotoTarget(toSdkTarget({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, zMm: 0, rightAntennaDeg: 0, leftAntennaDeg: 0 }, 0.5));
      neutralReadyAt = performance.now() + 800;
    }, 650);
  }
  function isThinking(): boolean { return round.snapshot.phase === "think"; }
  async function submitStatement() {
    if (busy || round.snapshot.phase !== "capture") return;
    if (!relay) return announce("Connect a Jev relay first.", true);
    const text = statement.value.trim();
    if (text.split(/\s+/).length < 4) return announce("Use at least four words for each statement.", true);
    busy = true;
    const version = roundVersion;
    const liveSettings = settings;
    clearTimeout(silenceTimer);
    recognition?.stop();
    micActive = false;
    render();
    try {
      const id = `s${round.snapshot.statementNumber}` as StatementId;
      const earlier = round.snapshot.statements.map((s) => ({ id: s.id, text: s.text }));
      const cues = await askLive(relay, { id, text }, earlier);
      if (version !== roundVersion) return;
      const recorded = round.submit(text, [], cues, liveSettings.weights);
      meter(recorded.pLie);
      showSuspicion(robot, recorded.pLie);
      q<HTMLElement>("#verdict").textContent = recorded.pLie >= 0.7 ? "Those antennas are not buying it." : recorded.pLie >= 0.4 ? "Reachy has questions." : "Reachy seems relaxed. For now.";
      statement.value = "";
      round.reactionDone();
      announce(`Statement ${id.slice(1)} locked. Jev's cue estimate is ${Math.round(recorded.pLie * 100)}%.`);
      if (isThinking()) {
        render();
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (version !== roundVersion) return;
        let pick;
        try {
          const finalSettings = settings;
          const final = await askFinal(relay, round.snapshot.statements);
          if (version !== roundVersion) return;
          pick = round.commit(final.choice, final.confidence, finalSettings.thresholds);
        } catch {
          if (version !== roundVersion) return;
          pick = round.commitUnavailable(randomPick());
        }
        if (pick.style === "coin_flip") await performCoinFlip(robot, undefined, () => version === roundVersion);
        else showSuspicion(robot, pick.style === "confident" ? 0.85 : 0.5);
        if (version !== roundVersion) return;
        const words = pick.source === "fallback" ? `Jev is unavailable. Random pick: number ${pick.choice.slice(1)}.` : pick.style === "confident" ? `Number ${pick.choice.slice(1)}. That's my pick.` : pick.style === "hedge" ? `I'd say number ${pick.choice.slice(1)}, but you're good.` : `Honestly? Coin flip. Number ${pick.choice.slice(1)}.`;
        q<HTMLElement>("#verdict").textContent = words;
        speakLocal(words);
        round.commitDone();
      } else neutralAfterReaction();
    } catch {
      announce("Jev did not return a usable cue answer. The statement was not locked; try again.", true);
    } finally {
      busy = false;
      render();
    }
  }
  function startRound() {
    if (!relay) return announce("Connect a Jev relay first.", true);
    if (round.snapshot.phase !== "idle") return;
    round.start();
    round.introDone();
    speakLocal(disclaimerSpoken ? "Three statements. Go." : "This is a game, not a lie detector. I judge language cues, not truth. Three statements. Go.");
    disclaimerSpoken = true;
    announce("Tell the first statement. Use the button, microphone, or a gentle antenna tap.");
    statement.focus();
    render();
  }
  function resetRound() {
    if (busy) return;
    roundVersion++;
    clearTimeout(silenceTimer);
    recognition?.stop();
    round = new Round();
    statement.value = "";
    meter(0);
    q<HTMLElement>("#meter-value").textContent = "—";
    q<HTMLElement>("#verdict").textContent = "Three statements. Two truths. One very expressive robot.";
    robot?.gotoTarget(toSdkTarget({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, zMm: 0, rightAntennaDeg: 0, leftAntennaDeg: 0 }, 0.6));
    neutralReadyAt = performance.now() + 900;
    announce("New round ready.");
    render();
  }
  relayForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      relay = new RelayPort(urlInput.value, tokenInput.value);
      tokenInput.value = "";
      relayStatus.textContent = "Relay configured for this tab";
      announce("Relay configured. Start a round.");
    } catch (error) {
      relayStatus.textContent = error instanceof Error ? error.message : "Invalid relay settings";
    }
  });
  settingsForm.addEventListener("input", () => {
    updateSettingOutputs();
    const values = sliderIds.map((id) => Number(q<HTMLInputElement>(`#${id}`).value) / 100);
    try {
      settings = gameSettings({
        weights: { lie_now: values[0], implausible: values[1], hedged: values[2], too_specific: values[3] },
        thresholds: { hedge: values[4], confident: values[5] },
      });
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); settingsStatus.textContent = "Settings saved. Next judgment uses these values."; }
      catch { settingsStatus.textContent = "Settings active for this tab; browser storage is unavailable."; }
      settingsStatus.classList.remove("error");
    } catch (error) {
      settingsStatus.textContent = error instanceof Error ? error.message : "Invalid settings";
      settingsStatus.classList.add("error");
    }
  });
  settingsForm.addEventListener("submit", (event) => event.preventDefault());
  q<HTMLButtonElement>("#start").addEventListener("click", startRound);
  q<HTMLButtonElement>("#submit").addEventListener("click", () => void submitStatement());
  q<HTMLButtonElement>("#reset").addEventListener("click", resetRound);
  q<HTMLElement>("#reveal").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-lie]");
    if (!button || round.snapshot.phase !== "reveal") return;
    const source = round.snapshot.pick?.source;
    const correct = round.reveal(button.dataset.lie as StatementId);
    if (source === "jev") {
      rounds++;
      if (correct) wins++;
    } else fallbackRounds++;
    if (nickname.value.trim() && source === "jev") {
      try {
        leaderboard = recordRound(leaderboard, nickname.value, !correct);
        try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboard)); leaderboardStatus.textContent = "Score saved on this device."; }
        catch { leaderboardStatus.textContent = "Score kept in this tab; browser storage is unavailable."; }
        leaderboardStatus.classList.remove("error");
        renderLeaderboard();
      } catch (error) {
        leaderboardStatus.textContent = error instanceof Error ? error.message : "Invalid nickname";
        leaderboardStatus.classList.add("error");
      }
    } else if (source === "fallback") {
      leaderboardStatus.textContent = "Random fallback round was not ranked.";
      leaderboardStatus.classList.remove("error");
    }
    const words = source === "fallback" ? (correct ? "Lucky guess." : "That was random; you got me.") : correct ? "Told you." : "Well played.";
    q<HTMLElement>("#verdict").textContent = words;
    speakLocal(words);
    announce(source === "fallback" ? "This was an unranked random pick, not a Jev judgment." : correct ? "Reachy picked the lie." : "You fooled Reachy.");
    render();
  });
  q<HTMLButtonElement>("#clear-leaderboard").addEventListener("click", () => {
    if (!window.confirm("Delete all locally saved Poker Face nicknames and scores?")) return;
    leaderboard = [];
    try { localStorage.removeItem(LEADERBOARD_KEY); leaderboardStatus.textContent = "Saved scores deleted."; }
    catch { leaderboardStatus.textContent = "Scores cleared for this tab; browser storage could not be changed."; }
    leaderboardStatus.classList.remove("error");
    renderLeaderboard();
  });
  q<HTMLButtonElement>("#mic").addEventListener("click", () => {
    if (micActive) { recognition?.stop(); return; }
    recognition = createRecognition();
    if (!recognition) return announce("This browser has no SpeechRecognition. Type the statement instead.", true);
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const parts = Array.from(event.results);
      statement.value = parts.map((part) => part[0].transcript).join(" ").slice(0, 400);
      clearTimeout(silenceTimer);
      if (parts.at(-1)?.isFinal && statement.value.trim().split(/\s+/).length >= 4) {
        silenceTimer = setTimeout(() => void submitStatement(), 1500);
      }
    };
    recognition.onerror = () => announce("Microphone transcription failed. Type the statement instead.", true);
    recognition.onend = () => { micActive = false; render(); };
    try { recognition.start(); micActive = true; render(); }
    catch { announce("Microphone permission was denied or is unavailable.", true); }
  });
  const onState = (event: Event) => {
    const antennas = (event as CustomEvent<{ antennas?: number[] }>).detail?.antennas;
    const phase = round.snapshot.phase;
    const enabled = !busy && performance.now() >= neutralReadyAt && (phase === "idle" || phase === "capture");
    if (!taps.observe(antennas, performance.now(), enabled)) return;
    if (phase === "idle") startRound();
    else void submitStatement();
  };
  robot?.addEventListener("state", onState);
  renderLeaderboard();
  render();
  return () => {
    roundVersion++;
    clearTimeout(silenceTimer);
    recognition?.stop();
    speechSynthesis.cancel();
    robot?.removeEventListener("state", onState);
    robot?.unsubscribePose();
    cleanupVideo?.();
    round.reset();
    relay = undefined;
  };
}

async function boot() {
  const preview = new URLSearchParams(location.search).get("preview") === "1";
  if (preview) { mountApp(); return; }
  try {
    const handle = await connectToHost();
    const cleanup = mountApp(handle.reachy, handle.media);
    handle.onLeave(async () => {
      cleanup();
      if (handle.reachy.state === "streaming") {
        handle.reachy.gotoTarget(toSdkTarget({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, zMm: 0, rightAntennaDeg: 0, leftAntennaDeg: 0 }, 0.6));
      }
    });
  } catch (error) {
    root!.textContent = `Could not connect to Reachy Mini: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}
void boot();
