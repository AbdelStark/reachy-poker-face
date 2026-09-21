import { connectToHost } from "@pollen-robotics/reachy-mini-sdk/host/embed";
import { AntennaTap } from "./antenna.js";
import { askFinal, askLive, type FinalJudgment, type JevPort } from "./jev.js";
import { performCoinFlip, showSuspicion, toSdkTarget } from "./motion.js";
import { RelayPort } from "./relay.js";
import { Round, type StatementId } from "./round.js";
import { DEFAULT_SETTINGS, gameSettings, parseSettings, SETTINGS_KEY, type GameSettings } from "./settings.js";
import { LEADERBOARD_KEY, parseLeaderboard, recordRound, type LeaderboardEntry } from "./leaderboard.js";
import { ClipRecorder, type ClipFile } from "./clip.js";
import { SessionTrace, type LiveEvidence } from "./trace.js";
import type { CommitThresholds } from "./cues.js";
import { cueBreakdown, finalCueLabel } from "./cue_panel.js";
import { analyzeDelivery, type DeliveryAnalysis } from "./cues.js";
import { LocalAsrPort } from "./asr.js";
import { RobotStatementRecorder } from "./robot_audio.js";
import { LocalTtsPort, RobotSpeechOutput } from "./tts.js";
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

export function mountApp(robot?: Robot, media?: RobotMedia) {
  root!.innerHTML = `
    <main class="app">
      <header class="masthead"><div class="brand"><span class="brand-icon">🃏</span><div><p class="eyebrow">Reachy Mini game</p><h1>Poker Face</h1></div></div><div id="connection" class="connection"></div></header>
      <div class="layout">
        <section class="stage" aria-label="Game stage">
          <div class="video-wrap"><video id="robot-video" autoplay playsinline muted aria-label="Reachy Mini camera"></video><div class="video-fallback" id="video-fallback">${robot ? "Waiting for robot camera…" : "Preview mode · no robot connected"}</div><span class="live-badge">GAME CUE METER</span></div>
          <div class="meter-card"><div class="meter-top"><span>Invented-story cue composite</span><strong id="meter-value">—</strong></div><div class="meter-track" role="progressbar" aria-label="Composite game cue meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="meter"><div class="meter-fill" id="meter-fill"></div></div><p class="meter-note">A weighted game score from Jev's text judgments, not a calibrated probability or lie detector.</p><section class="cue-breakdown" aria-label="Model cue breakdown"><h3>What moved the meter</h3><p id="cue-note">Lock a statement to see the four model cues and their weights.</p><ol id="cue-rows"></ol></section></div>
          <div class="verdict" id="verdict" aria-live="polite">Three statements. Two truths. One very expressive robot.</div>
          <p id="final-cue" class="final-cue" hidden></p>
        </section>
        <section class="controls" aria-label="Game controls">
          <div class="card"><div class="section-heading"><span class="step">01</span><h2>Connect Jev</h2></div><p class="small">Use a trusted relay. Your TypeSafe API key stays on its server; the relay token remains in this tab only.</p><form id="relay-form"><label>Relay URL<input id="relay-url" type="url" value="http://127.0.0.1:8047" autocomplete="url" required /></label><label>Session token<input id="relay-token" type="password" autocomplete="off" minlength="32" required /></label><button type="submit" class="secondary">Connect relay</button></form><p id="relay-status" class="status" aria-live="polite">Not connected</p></div>
          <div class="card"><div class="section-heading"><span class="step">02</span><h2>Game settings</h2></div><p class="small">Weights and commit thresholds apply to the next judgment. They are saved on this device; no statement text or relay token is saved.</p><form id="settings-form" class="settings-grid"><label>Lie-now cue <output for="w-lie-now" id="o-lie-now">50%</output><input id="w-lie-now" type="range" min="0" max="100" step="1" /></label><label>Implausibility <output for="w-implausible" id="o-implausible">20%</output><input id="w-implausible" type="range" min="0" max="100" step="1" /></label><label>Hedging <output for="w-hedged" id="o-hedged">20%</output><input id="w-hedged" type="range" min="0" max="100" step="1" /></label><label>Over-detail <output for="w-too-specific" id="o-too-specific">10%</output><input id="w-too-specific" type="range" min="0" max="100" step="1" /></label><label>Hedge from <output for="t-hedge" id="o-hedge">40%</output><input id="t-hedge" type="range" min="0" max="100" step="1" /></label><label>Confident from <output for="t-confident" id="o-confident">70%</output><input id="t-confident" type="range" min="0" max="100" step="1" /></label></form><p id="settings-status" class="status" aria-live="polite"></p><p class="small">Poker Face reacts to language cues in a party game. It cannot determine whether anyone is telling the truth.</p></div>
          <div class="card"><div class="section-heading"><span class="step">03</span><h2>Play</h2></div><p id="phase" class="phase">Ready when you are.</p><div ${robot ? "" : "hidden"}><label class="clip-consent"><input id="motion-enable" type="checkbox" /><span>Enable Reachy's game motion for this session after checking the robot and nearby space.</span></label><p id="motion-status" class="small" aria-live="polite">Motion off. Playing by text remains available; antenna taps need motion enabled.</p></div><label class="clip-consent"><input id="clip-consent" type="checkbox" /><span>Everyone visible agrees to a silent, local video clip of this round.</span></label><p class="small">Clips require the robot camera, contain no audio or statement text, stop after 30 seconds, and stay in this tab until you download or discard them.</p><button id="start" class="primary" type="button">Start a round</button><div class="capture"><label for="statement">Statement <span id="statement-number">1</span> of 3</label><textarea id="statement" rows="3" maxlength="400" placeholder="Say or type one statement…"></textarea><div class="capture-actions"><button id="mic" class="secondary" type="button">Use browser microphone</button><button id="submit" class="primary" type="button">Lock statement</button></div><p class="small">Browser microphone mode may send audio to its vendor and has no word timing. Antenna tap needs motion enabled and neutral antennas.</p><div class="robot-asr" ${robot ? "" : "hidden"}><h3>Robot microphone · local ASR</h3><p class="small">Optional: a separate loopback companion turns one short robot-audio segment into word timings. No audio goes to Jev; only the resulting statement text and delivery buckets do.</p><form id="asr-form"><label>Local ASR URL<input id="asr-url" type="url" value="http://127.0.0.1:8049" required autocomplete="url" /></label><label>ASR token<input id="asr-token" type="password" required minlength="32" autocomplete="off" /></label><button type="submit" class="secondary">Configure local ASR</button></form><label class="clip-consent"><input id="asr-consent" type="checkbox" /><span>For this round, send up to 15 seconds of Reachy's microphone audio to my local ASR companion. Do not start until everyone audible agrees.</span></label><button id="robot-mic" type="button" class="secondary">Record robot microphone</button><p id="asr-status" class="status" aria-live="polite">Robot microphone off. No audio sent.</p></div></div><div class="robot-tts" ${robot ? "" : "hidden"}><h3>Robot speaker · local TTS</h3><p class="small">Optional: only fixed game lines go to an authenticated loopback voice companion, then through Reachy's audio-upload API. Your statements are never spoken by this path.</p><form id="tts-form"><label>Local TTS URL<input id="tts-url" type="url" value="http://127.0.0.1:8050" required autocomplete="url" /></label><label>TTS token<input id="tts-token" type="password" required minlength="32" autocomplete="off" /></label><button type="submit" class="secondary">Configure local TTS</button></form><label class="clip-consent"><input id="tts-robot" type="checkbox" disabled /><span>Use Reachy's speaker for game lines instead of this browser.</span></label><p id="tts-status" class="status" aria-live="polite">Browser speech selected. Robot speaker off.</p></div><ol id="statements" class="statement-list"></ol><div id="reveal" class="reveal"><p>Which statement was the lie?</p><div class="reveal-actions"><button data-lie="s1" type="button">1</button><button data-lie="s2" type="button">2</button><button data-lie="s3" type="button">3</button></div></div><button id="download-clip" class="secondary" type="button" hidden>Download local clip</button><p id="clip-status" class="status" aria-live="polite"></p><button id="reset" class="text-button" type="button">New round</button><p id="score" class="score">0 rounds played</p></div>
          <div class="card"><div class="section-heading"><span class="step">04</span><h2>Local leaderboard</h2></div><p class="small">Type a nickname before revealing the lie to save this round's score on this device. Leave it blank for a tab-only game. No statement text is saved.</p><label for="nickname">Player nickname<input id="nickname" type="text" maxlength="24" autocomplete="off" placeholder="Optional" /></label><ol id="leaderboard" class="leaderboard-list"></ol><button id="clear-leaderboard" class="text-button" type="button">Clear saved scores</button><p id="leaderboard-status" class="status" aria-live="polite"></p></div>
          <div class="card"><div class="section-heading"><span class="step">05</span><h2>Session trace</h2></div><p class="small">Completed rounds stay in this tab only. Export JSONL to inspect picks and calibration later. Statement text is excluded by default; neither nickname nor video is included.</p><label class="clip-consent"><input id="trace-text-consent" type="checkbox" /><span>Include the next round's statement text in the trace export. Ask the player first.</span></label><button id="download-trace" class="secondary" type="button" disabled>Download trace JSONL</button><button id="clear-trace" class="text-button" type="button" disabled>Discard session trace</button><p id="trace-status" class="status" aria-live="polite">No completed rounds in this session.</p></div>
          <p id="status" class="status" role="status" aria-live="polite"></p>
        </section>
      </div>
      <footer>Typed judgments choose; game code decides. Browser speech is the default; robot-speaker speech is opt-in and unverified on hardware.</footer>
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
  const clipStatus = q<HTMLElement>("#clip-status");
  const traceStatus = q<HTMLElement>("#trace-status");
  const cueRows = q<HTMLOListElement>("#cue-rows");
  const cueNote = q<HTMLElement>("#cue-note");
  const finalCue = q<HTMLElement>("#final-cue");
  const traceTextConsent = q<HTMLInputElement>("#trace-text-consent");
  const downloadTraceButton = q<HTMLButtonElement>("#download-trace");
  const clearTraceButton = q<HTMLButtonElement>("#clear-trace");
  const downloadClipButton = q<HTMLButtonElement>("#download-clip");
  const statement = q<HTMLTextAreaElement>("#statement");
  const asrForm = q<HTMLFormElement>("#asr-form");
  const asrToken = q<HTMLInputElement>("#asr-token");
  const asrConsent = q<HTMLInputElement>("#asr-consent");
  const asrStatus = q<HTMLElement>("#asr-status");
  const robotMicButton = q<HTMLButtonElement>("#robot-mic");
  const ttsForm = q<HTMLFormElement>("#tts-form");
  const ttsToken = q<HTMLInputElement>("#tts-token");
  const ttsRobot = q<HTMLInputElement>("#tts-robot");
  const ttsStatus = q<HTMLElement>("#tts-status");
  const motionToggle = q<HTMLInputElement>("#motion-enable");
  const motionStatus = q<HTMLElement>("#motion-status");
  const video = q<HTMLVideoElement>("#robot-video");
  let round = new Round();
  const sessionTrace = new SessionTrace();
  let liveEvidence: LiveEvidence[] = [];
  let finalEvidence: FinalJudgment | undefined;
  let finalThresholds: CommitThresholds | undefined;
  let traceTextForRound = false;
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
  let clipRecorder: ClipRecorder | undefined;
  let clipFile: ClipFile | undefined;
  let clipStopTimer: ReturnType<typeof setTimeout> | undefined;
  let recognition: Recognition | null = null;
  let micActive = false;
  let localAsr: LocalAsrPort | undefined;
  let robotSpeech: RobotSpeechOutput | undefined;
  let speechVersion = 0;
  let robotCapture: RobotStatementRecorder | undefined;
  let asrAbort: AbortController | undefined;
  let asrBusy = false;
  let pendingDelivery: DeliveryAnalysis | undefined;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let neutralReadyAt = 0;
  let motionEnabled = false;
  let motionEpoch = 0;
  const taps = new AntennaTap();
  const cleanupVideo = media?.attachVideo(video);
  if (robot) {
    q<HTMLElement>("#video-fallback").hidden = true;
    robot.subscribePose();
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
  function disarmMotion(message: string) {
    motionEpoch++;
    motionEnabled = false;
    motionToggle.checked = false;
    motionStatus.textContent = message;
  }
  function commandNeutral(duration = 0.6): boolean {
    if (!motionEnabled) return false;
    try {
      if (!robot || robot.state !== "streaming") throw new Error("robot unavailable");
      if (!robot.gotoTarget(toSdkTarget({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, zMm: 0, rightAntennaDeg: 0, leftAntennaDeg: 0 }, duration))) throw new Error("pose rejected");
      neutralReadyAt = performance.now() + duration * 1000 + 300;
      return true;
    } catch {
      disarmMotion("Motion request failed; no further game poses will be sent. Use the physical stop if needed.");
      return false;
    }
  }
  function showGameMotion(p: number) {
    if (!motionEnabled) return;
    try {
      if (!showSuspicion(robot, p)) throw new Error("pose rejected");
    } catch {
      disarmMotion("Motion request failed; the round can continue without movement. Use the physical stop if needed.");
    }
  }
  function cancelGameSpeech() {
    speechVersion++;
    speechSynthesis.cancel();
    robotSpeech?.cancel();
  }
  async function speakGame(text: string) {
    const version = ++speechVersion;
    if (!ttsRobot.checked) {
      robotSpeech?.cancel();
      speakLocal(text);
      return;
    }
    speechSynthesis.cancel();
    const output = robotSpeech;
    if (!output) {
      ttsStatus.textContent = "Robot speaker unavailable. Game line remains visible; no browser fallback.";
      return;
    }
    try {
      await output.speak(text);
      if (version === speechVersion) ttsStatus.textContent = "Robot playback started (completion not acknowledged).";
    } catch {
      if (version === speechVersion) ttsStatus.textContent = "Robot speech failed. Game line remains visible; no browser fallback.";
    }
  }
  async function finishClip() {
    clearTimeout(clipStopTimer);
    const recorder = clipRecorder;
    if (!recorder) return;
    const file = await recorder.finish();
    if (clipRecorder !== recorder) return;
    clipRecorder = undefined;
    if (file) {
      clipFile = file;
      downloadClipButton.hidden = round.snapshot.phase !== "score";
      clipStatus.textContent = downloadClipButton.hidden ? "Silent clip captured; download after the reveal." : `Silent ${file.extension.toUpperCase()} clip ready in this tab.`;
    } else clipStatus.textContent = "Clip could not be recorded; no file was saved.";
  }
  function discardClip() {
    clearTimeout(clipStopTimer);
    if (clipRecorder) void clipRecorder.discard();
    clipRecorder = undefined;
    clipFile = undefined;
    downloadClipButton.hidden = true;
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
  function renderTrace() {
    traceStatus.classList.remove("error");
    downloadTraceButton.disabled = sessionTrace.count === 0;
    clearTraceButton.disabled = sessionTrace.count === 0;
    traceStatus.textContent = sessionTrace.count
      ? `${sessionTrace.count} completed round${sessionTrace.count === 1 ? "" : "s"} in this tab. Download or discard before leaving.`
      : "No completed rounds in this session.";
  }
  function render() {
    const snapshot = round.snapshot;
    const capture = snapshot.phase === "capture";
    q<HTMLElement>("#phase").textContent = snapshot.phase === "idle" ? "Ready when you are." : snapshot.phase === "reveal" ? "The robot has chosen. Reveal the lie." : snapshot.phase === "score" ? "Round complete." : snapshot.phase === "think" ? "Thinking…" : `Statement ${snapshot.statementNumber} of 3`;
    q<HTMLElement>("#statement-number").textContent = String(snapshot.statementNumber);
    q<HTMLButtonElement>("#start").hidden = snapshot.phase !== "idle";
    q<HTMLElement>(".capture").hidden = !capture;
    q<HTMLElement>("#reveal").hidden = snapshot.phase !== "reveal";
    q<HTMLButtonElement>("#submit").disabled = !capture || busy || asrBusy || Boolean(robotCapture);
    q<HTMLButtonElement>("#reset").disabled = busy;
    traceTextConsent.disabled = snapshot.phase !== "idle";
    q<HTMLButtonElement>("#mic").disabled = !capture || busy || asrBusy || Boolean(robotCapture) || !createRecognition();
    q<HTMLButtonElement>("#mic").textContent = micActive ? "Stop browser microphone" : "Use browser microphone";
    robotMicButton.disabled = !robot || !capture || busy || asrBusy;
    robotMicButton.textContent = robotCapture ? "Stop & transcribe" : "Record robot microphone";
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
  function showCues(cues: Parameters<typeof cueBreakdown>[0], weights: Parameters<typeof cueBreakdown>[1], statementId: StatementId) {
    const rows = cueBreakdown(cues, weights);
    cueRows.replaceChildren(...rows.map((row) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${row.label} · ${Math.round(row.probability * 100)}% model score`;
      const weight = document.createElement("span");
      weight.textContent = `${Math.round(row.effectiveWeight * 100)}% weight · ${Math.round(row.contribution * 100)} meter points`;
      const bar = document.createElement("progress");
      bar.max = 100;
      bar.value = Math.round(row.probability * 100);
      bar.setAttribute("aria-label", `${row.label} model score`);
      item.append(label, weight, bar);
      return item;
    }));
    cueNote.textContent = `Statement ${statementId.slice(1)} · these are model judgments, not evidence of honesty.`;
  }
  function neutralAfterReaction() {
    if (!motionEnabled) return;
    const version = roundVersion;
    const epoch = motionEpoch;
    setTimeout(() => {
      if (version !== roundVersion || epoch !== motionEpoch || !motionEnabled || round.snapshot.phase !== "capture") return;
      commandNeutral(0.5);
    }, 650);
  }
  function isThinking(): boolean { return round.snapshot.phase === "think"; }
  function cancelRobotAudio() {
    asrAbort?.abort();
    asrAbort = undefined;
    asrBusy = false;
    if (robotCapture) void robotCapture.discard();
    robotCapture = undefined;
    pendingDelivery = undefined;
  }
  async function finishRobotCapture() {
    const capture = robotCapture;
    if (!capture || asrBusy) return;
    const version = roundVersion;
    robotCapture = undefined;
    asrBusy = true;
    asrStatus.textContent = "Transcribing locally; audio is not sent to Jev.";
    render();
    let pcm: Uint8Array | undefined;
    try {
      pcm = await capture.stop();
      if (version !== roundVersion || !localAsr) return;
      const abort = new AbortController();
      asrAbort = abort;
      const result = await localAsr.transcribe(pcm, abort.signal);
      if (version !== roundVersion || abort.signal.aborted || !asrConsent.checked || round.snapshot.phase !== "capture") return;
      statement.value = result.text;
      pendingDelivery = result.words.length ? analyzeDelivery(result.words) : undefined;
      asrStatus.textContent = result.text
        ? `Local ASR returned ${result.words.length} timed words; review the text, then lock the statement.`
        : "No speech was recognized. Try again or type the statement.";
    } catch {
      if (version === roundVersion) asrStatus.textContent = "Robot-audio capture or local ASR failed; no statement was submitted.";
    } finally {
      pcm?.fill(0);
      if (version === roundVersion) { asrAbort = undefined; asrBusy = false; render(); }
    }
  }
  async function toggleRobotCapture() {
    if (robotCapture) return finishRobotCapture();
    if (asrBusy || round.snapshot.phase !== "capture") return;
    if (!asrConsent.checked) return announce("Check robot-audio consent for this round first.", true);
    if (!localAsr) return announce("Configure the local ASR companion first.", true);
    const stream = media?.robotStream;
    if (!stream?.getAudioTracks().some((track: MediaStreamTrack) => track.readyState === "live")) return announce("Robot audio track is unavailable.", true);
    const version = roundVersion;
    cancelGameSpeech();
    recognition?.stop();
    clearTimeout(silenceTimer);
    statement.value = "";
    pendingDelivery = undefined;
    const capture = new RobotStatementRecorder(stream, () => { void finishRobotCapture(); });
    robotCapture = capture;
    asrBusy = true;
    asrStatus.textContent = "Starting robot microphone capture…";
    render();
    try {
      await capture.start();
      if (version !== roundVersion || robotCapture !== capture) { await capture.discard(); return; }
      asrStatus.textContent = "Recording Reachy's microphone locally. Stop within 15 seconds to transcribe.";
    } catch {
      if (version === roundVersion) {
        robotCapture = undefined;
        asrStatus.textContent = "Robot audio capture could not start; nothing was sent.";
      }
    } finally {
      if (version === roundVersion) { asrBusy = false; render(); }
    }
  }
  async function submitStatement() {
    if (busy || asrBusy || robotCapture || round.snapshot.phase !== "capture") return;
    if (!relay) return announce("Connect a Jev relay first.", true);
    const text = statement.value.trim();
    if (text.split(/\s+/).length < 4) return announce("Use at least four words for each statement.", true);
    busy = true;
    const version = roundVersion;
    const motionVersion = motionEpoch;
    const liveSettings = settings;
    const delivery = pendingDelivery;
    clearTimeout(silenceTimer);
    recognition?.stop();
    micActive = false;
    render();
    try {
      const id = `s${round.snapshot.statementNumber}` as StatementId;
      const earlier = round.snapshot.statements.map((s) => ({ id: s.id, text: s.text }));
      const cues = await askLive(relay, { id, text, ...(delivery ? { delivery } : {}) }, earlier);
      if (version !== roundVersion) return;
      const recorded = round.submit(text, delivery?.delivery ?? [], cues, liveSettings.weights);
      pendingDelivery = undefined;
      liveEvidence.push({ id, cues: { ...cues }, weights: { ...liveSettings.weights } });
      meter(recorded.pLie);
      showCues(cues, liveSettings.weights, id);
      if (motionVersion === motionEpoch) showGameMotion(recorded.pLie);
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
          finalEvidence = final;
          finalThresholds = { ...finalSettings.thresholds };
        } catch {
          if (version !== roundVersion) return;
          pick = round.commitUnavailable(randomPick());
          finalEvidence = undefined;
          finalThresholds = undefined;
        }
        if (motionVersion === motionEpoch && motionEnabled) {
          if (pick.style === "coin_flip") {
            try {
              const completed = await performCoinFlip(robot, undefined, () => version === roundVersion && motionEnabled && motionVersion === motionEpoch);
              if (!completed && version === roundVersion && motionEnabled && motionVersion === motionEpoch) disarmMotion("Motion request failed; the final pick remains visible without movement. Use the physical stop if needed.");
            }
            catch {
              if (version === roundVersion && motionEnabled && motionVersion === motionEpoch) disarmMotion("Motion request failed; the final pick remains visible without movement. Use the physical stop if needed.");
            }
          } else showGameMotion(pick.style === "confident" ? 0.85 : 0.5);
        }
        if (version !== roundVersion) return;
        const words = pick.source === "fallback" ? `Jev is unavailable. Random pick: number ${pick.choice.slice(1)}.` : pick.style === "confident" ? `Number ${pick.choice.slice(1)}. That's my pick.` : pick.style === "hedge" ? `I'd say number ${pick.choice.slice(1)}, but you're good.` : `Honestly? Coin flip. Number ${pick.choice.slice(1)}.`;
        q<HTMLElement>("#verdict").textContent = words;
        finalCue.hidden = pick.source !== "jev";
        finalCue.textContent = pick.source === "jev" && finalEvidence
          ? `Jev highlighted ${finalCueLabel(finalEvidence.topCue)} for its game pick. That cue is not evidence that anyone lied.`
          : "";
        void speakGame(words);
        round.commitDone();
      } else if (motionVersion === motionEpoch) neutralAfterReaction();
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
    liveEvidence = [];
    finalEvidence = undefined;
    finalThresholds = undefined;
    traceTextForRound = traceTextConsent.checked;
    traceTextConsent.checked = false;
    discardClip();
    const clipConsent = q<HTMLInputElement>("#clip-consent");
    const consentedForThisRound = clipConsent.checked;
    clipConsent.checked = false;
    if (consentedForThisRound) {
      try {
        clipRecorder = new ClipRecorder(video, () => ({
          statementNumber: round.snapshot.statementNumber,
          probability: round.snapshot.statements.at(-1)?.pLie ?? null,
          verdict: q<HTMLElement>("#verdict").textContent ?? "",
        }), true);
        clipStatus.textContent = "Recording silent local clip (30-second maximum).";
        clipStatus.classList.remove("error");
        clipStopTimer = setTimeout(() => void finishClip(), 30_100);
      } catch (error) {
        clipStatus.textContent = error instanceof Error ? error.message : "Local clip recording unavailable.";
        clipStatus.classList.add("error");
      }
    } else clipStatus.textContent = "No clip recording requested.";
    void speakGame(disclaimerSpoken ? "Three statements. Go." : "This is a game, not a lie detector. I judge language cues, not truth. Three statements. Go.");
    disclaimerSpoken = true;
    announce("Tell the first statement. Use the button, microphone, or a gentle antenna tap.");
    statement.focus();
    render();
  }
  function resetRound() {
    if (busy) return;
    roundVersion++;
    cancelRobotAudio();
    cancelGameSpeech();
    asrConsent.checked = false;
    asrStatus.textContent = "Robot microphone off. No audio sent.";
    liveEvidence = [];
    finalEvidence = undefined;
    finalThresholds = undefined;
    traceTextForRound = false;
    const hadClip = Boolean(clipRecorder || clipFile);
    discardClip();
    clipStatus.textContent = hadClip ? "Previous clip discarded." : "No clip recording requested.";
    clearTimeout(silenceTimer);
    recognition?.stop();
    round = new Round();
    statement.value = "";
    meter(0);
    q<HTMLElement>("#meter-value").textContent = "—";
    q<HTMLElement>("#verdict").textContent = "Three statements. Two truths. One very expressive robot.";
    cueRows.replaceChildren();
    cueNote.textContent = "Lock a statement to see the four model cues and their weights.";
    finalCue.textContent = "";
    finalCue.hidden = true;
    commandNeutral();
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
  motionToggle.addEventListener("change", () => {
    if (!motionToggle.checked) {
      disarmMotion("Motion off. No further game poses will be sent; use the physical stop for immediate halt.");
      return;
    }
    if (!robot || robot.state !== "streaming") {
      motionToggle.checked = false;
      motionStatus.textContent = "Motion unavailable: robot is not streaming.";
      return;
    }
    motionEpoch++;
    motionEnabled = true;
    if (commandNeutral()) motionStatus.textContent = "Motion enabled for this session. Keep the robot clear and a physical stop nearby.";
  });
  asrForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (robotCapture || asrBusy) return;
    try {
      localAsr = new LocalAsrPort(q<HTMLInputElement>("#asr-url").value, asrToken.value);
      asrToken.value = "";
      asrStatus.textContent = "Local ASR configured for this tab. No audio sent yet.";
    } catch (error) {
      asrStatus.textContent = error instanceof Error ? error.message : "Invalid local ASR settings.";
    }
  });
  ttsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!robot) return;
    try {
      const port = new LocalTtsPort(q<HTMLInputElement>("#tts-url").value, ttsToken.value);
      cancelGameSpeech();
      robotSpeech = new RobotSpeechOutput(robot, port);
      ttsToken.value = "";
      ttsRobot.checked = false;
      ttsRobot.disabled = false;
      ttsStatus.textContent = "Local TTS configured for this tab. Check the box to use Reachy's speaker.";
    } catch (error) {
      ttsStatus.textContent = error instanceof Error ? error.message : "Invalid local TTS settings.";
    }
  });
  ttsRobot.addEventListener("change", () => {
    cancelGameSpeech();
    ttsStatus.textContent = ttsRobot.checked
      ? "Robot speaker selected. Playback is unverified on hardware."
      : "Browser speech selected. Any active robot playback received a best-effort cancel request.";
  });
  asrConsent.addEventListener("change", () => {
    if (!asrConsent.checked) {
      cancelRobotAudio();
      asrStatus.textContent = "Robot-audio consent cleared; capture discarded or request aborted.";
      render();
    }
  });
  robotMicButton.addEventListener("click", () => { void toggleRobotCapture(); });
  statement.addEventListener("input", () => {
    if (pendingDelivery) {
      pendingDelivery = undefined;
      asrStatus.textContent = "Statement edited; word-timing delivery cues were cleared.";
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
  downloadClipButton.addEventListener("click", () => {
    if (!clipFile) return;
    const url = URL.createObjectURL(clipFile.blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
    anchor.href = url;
    anchor.download = `pokerface-${stamp}.${clipFile.extension}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  downloadTraceButton.addEventListener("click", () => {
    if (!sessionTrace.count) return;
    const url = URL.createObjectURL(new Blob([sessionTrace.toJSONL()], { type: "application/x-ndjson" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pokerface-trace-${new Date().toISOString().slice(0, 10)}.jsonl`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  clearTraceButton.addEventListener("click", () => {
    if (!window.confirm("Discard all completed round traces kept in this tab?")) return;
    sessionTrace.clear();
    renderTrace();
  });
  q<HTMLElement>("#reveal").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-lie]");
    if (!button || round.snapshot.phase !== "reveal") return;
    const source = round.snapshot.pick?.source;
    const correct = round.reveal(button.dataset.lie as StatementId);
    try {
      sessionTrace.add(round.snapshot, liveEvidence, finalEvidence, finalThresholds, traceTextForRound);
      renderTrace();
    } catch {
      traceStatus.textContent = "This round could not be added to the session trace.";
      traceStatus.classList.add("error");
    }
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
    void speakGame(words);
    announce(source === "fallback" ? "This was an unranked random pick, not a Jev judgment." : correct ? "Reachy picked the lie." : "You fooled Reachy.");
    if (clipFile) {
      downloadClipButton.hidden = false;
      clipStatus.textContent = `Silent ${clipFile.extension.toUpperCase()} clip ready in this tab.`;
    }
    if (clipRecorder) {
      clearTimeout(clipStopTimer);
      clipStopTimer = setTimeout(() => void finishClip(), 3000);
    }
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
      pendingDelivery = undefined;
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
    const enabled = motionEnabled && !busy && performance.now() >= neutralReadyAt && (phase === "idle" || phase === "capture");
    if (!taps.observe(antennas, performance.now(), enabled)) return;
    if (phase === "idle") startRound();
    else void submitStatement();
  };
  robot?.addEventListener("state", onState);
  renderLeaderboard();
  renderTrace();
  render();
  return () => {
    roundVersion++;
    motionEpoch++;
    if (motionEnabled) commandNeutral();
    motionEnabled = false;
    cancelRobotAudio();
    cancelGameSpeech();
    sessionTrace.clear();
    discardClip();
    clearTimeout(silenceTimer);
    recognition?.stop();
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
    });
  } catch (error) {
    root!.textContent = `Could not connect to Reachy Mini: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}
void boot();
