import {
  checkFraming,
  FRAMING_MESSAGES,
  handBoundingBoxWidth,
  normalizedThumbForearmDistance,
  wristExtensionAngleDeg,
  isThumbRepPositive,
  isWristRepPositive,
  movedEnoughForThumb,
  movedEnoughForWrist,
  sessionManeuverStatus,
  countPositiveSessions,
  recommendationTier,
  THUMB_TIP,
  MIDDLE_MCP,
} from "./geometry.js";
import { neutral, thumbToForearmTarget, wristExtendedTarget, interpolatePose } from "./poses.js";
import { drawSkeleton, drawTargetRing, drawTableEdgeLine, drawCountdown } from "./draw.js";
import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

const MANEUVERS = [
  {
    key: "thumb",
    label: "Thumb-to-forearm",
    instructions: "Bend your thumb down toward the inside of your forearm, like you're trying to touch it.",
    referencePhoto: {
      src: "docs/reference-thumb-forearm.jpg",
      alt: "A real photo of someone bending their thumb down to touch the inside of their forearm, the Beighton thumb-to-forearm test",
      caption: "Target: thumb touching the inner forearm. Photo via Wikimedia Commons, public domain.",
    },
    target: thumbToForearmTarget,
    trackedLandmark: THUMB_TIP,
    measure: normalizedThumbForearmDistance,
    isPositive: isThumbRepPositive,
    movedEnough: movedEnoughForThumb,
    combineExtreme: Math.min,
  },
  {
    key: "wrist",
    label: "Wrist extension",
    instructions: "Rest your forearm flat on a table, wrist at the edge, then bend your hand back as far as it goes.",
    target: wristExtendedTarget,
    trackedLandmark: MIDDLE_MCP,
    measure: wristExtensionAngleDeg,
    isPositive: isWristRepPositive,
    movedEnough: movedEnoughForWrist,
    combineExtreme: Math.max,
    showTableGuide: true,
  },
];

const REPS_PER_MANEUVER = 3;
const STABLE_FRAMES = 5;
const CALIBRATION_STABLE_FRAMES = 10;
const CAPTURE_MS = 2500;
const COUNTDOWN_MS = 3000;
const REP_RESULT_MS = 1200;
const MAX_RETRIES_PER_REP = 2;
const QUALITY_BAD_FRACTION_LIMIT = 0.15;
const HISTORY_KEY = "romwatch.history";

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const instructionLine = document.getElementById("instruction-line");
const referencePhoto = document.getElementById("reference-photo");
const referencePhotoImg = document.getElementById("reference-photo-img");
const referencePhotoCaption = document.getElementById("reference-photo-caption");
const statusText = document.getElementById("status-text");
const statusDot = document.getElementById("status-dot");
const cameraWrap = document.querySelector(".camera-wrap");
const stage = document.getElementById("stage");
const disclaimer = document.getElementById("disclaimer");
const results = document.getElementById("results");
const startBtn = document.getElementById("start-btn");

let handLandmarker = null;

const state = {
  phase: "intro", // intro -> loading -> calibrate -> frame -> countdown -> capture -> rep_result -> results
  maneuverIndex: 0,
  retryCount: 0,
  reps: [], // per maneuver, array of {status, value}
  sessionResults: {},
  refHandWidthPx: 0,
  framingState: null,
  framingStreak: 0,
  phaseStartTime: 0,
  captureBadFrames: 0,
  captureTotalFrames: 0,
  captureExtreme: null,
  captureStartValue: null,
  lastLandmarks: null,
  animT: 0,
  savedThisSession: false,
};

function setStatus(text, dotState = "neutral") {
  statusText.textContent = text;
  statusDot.className = `status-dot${dotState === "neutral" ? "" : ` status-dot--${dotState}`}`;
  cameraWrap?.classList.toggle("camera-wrap--good", dotState === "good");
}

// Separate from setStatus on purpose: this is "what to do," and it must stay
// on screen for the whole maneuver. setStatus is "what's happening right
// now" (framing feedback, hold/recorded messages) and changes constantly.
// Mixing the two meant the instructions got overwritten the moment a hand
// was detected, right when they were needed most.
function setInstruction(text) {
  instructionLine.textContent = text;
}

// Shows a real photo of the target position where one exists (currently just
// the thumb-to-forearm test, sourced from a public-domain Wikimedia Commons
// photo). An actual photo of the maneuver is a much clearer "what am I aiming
// for" reference than an abstract skeleton, so it's shown alongside, not
// instead of, the live tracking overlay on the camera itself.
function setReferencePhoto(maneuver) {
  if (maneuver?.referencePhoto) {
    referencePhotoImg.src = maneuver.referencePhoto.src;
    referencePhotoImg.alt = maneuver.referencePhoto.alt;
    referencePhotoCaption.textContent = maneuver.referencePhoto.caption;
    referencePhoto.classList.remove("hidden");
  } else {
    referencePhoto.classList.add("hidden");
  }
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) ?? [];
  } catch {
    return [];
  }
}

function saveSession(sessionResults, values) {
  const history = loadHistory();
  history.push({ timestamp: Date.now(), results: sessionResults, values });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  return history;
}

async function start() {
  disclaimer.classList.add("hidden");
  stage.classList.remove("hidden");
  setStatus("Loading camera and model, this can take a few seconds the first time...");

  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
  video.srcObject = stream;
  await new Promise((resolve) => (video.onloadedmetadata = resolve));
  await video.play();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
  });

  state.phase = "calibrate";
  setInstruction("Hold your hand up naturally, palm to the camera, fingers relaxed and spread.");
  setReferencePhoto(null);
  requestAnimationFrame(tick);
}

function updateFramingStreak(current) {
  if (current === state.framingState) {
    state.framingStreak += 1;
  } else {
    state.framingState = current;
    state.framingStreak = 1;
  }
}

function currentManeuver() {
  return MANEUVERS[state.maneuverIndex];
}

function goToPhase(phase) {
  state.phase = phase;
  state.phaseStartTime = performance.now();
}

function beginFraming(instructions) {
  state.framingState = null;
  state.framingStreak = 0;
  setInstruction(instructions);
  setReferencePhoto(currentManeuver());
  goToPhase("frame");
}

function beginCapture() {
  state.captureBadFrames = 0;
  state.captureTotalFrames = 0;
  state.captureExtreme = null;
  state.captureStartValue = null;
  goToPhase("capture");
}

function finishRep() {
  const maneuver = currentManeuver();
  const badFraction = state.captureTotalFrames > 0 ? state.captureBadFrames / state.captureTotalFrames : 1;
  const trackingOk = badFraction <= QUALITY_BAD_FRACTION_LIMIT && state.captureExtreme !== null;
  // A rep is only evidence of something if the hand actually moved a real
  // amount during the window. Without this, holding still for the full
  // capture (or the hand just resting near its natural position) gets
  // measured and scored exactly like a genuine attempt.
  const attemptedIt =
    trackingOk &&
    state.captureStartValue !== null &&
    maneuver.movedEnough(state.captureStartValue, state.captureExtreme);

  if (!trackingOk || !attemptedIt) {
    state.retryCount += 1;
    const reason = !trackingOk
      ? "Lost tracking, let's redo that one."
      : "Didn't see much movement there. Make sure to actually do the motion, then hold it.";
    if (state.retryCount > MAX_RETRIES_PER_REP) {
      state.reps.push({ status: "inconclusive", value: null });
      state.retryCount = 0;
      setStatus("Couldn't get a clean reading for that one. Moving on.", "warn");
      state.retryRep = false;
    } else {
      setStatus(reason, "warn");
      state.retryRep = true;
    }
    goToPhase("rep_result");
    return;
  }

  const positive = maneuver.isPositive(state.captureExtreme);
  state.reps.push({ status: positive ? "positive" : "negative", value: state.captureExtreme });
  state.retryCount = 0;
  setStatus("Recorded.", "good");
  state.retryRep = false;
  goToPhase("rep_result");
}

function advanceRepOrManeuver() {
  if (state.reps.length < REPS_PER_MANEUVER) {
    beginFraming(currentManeuver().instructions);
    return;
  }
  const maneuver = currentManeuver();
  const statuses = state.reps.map((r) => r.status);
  const values = state.reps.map((r) => r.value).filter((v) => v !== null);
  state.sessionResults[maneuver.key] = {
    status: sessionManeuverStatus(statuses),
    value: values.length ? values[values.length - 1] : null,
  };
  state.reps = [];
  state.maneuverIndex += 1;
  if (state.maneuverIndex < MANEUVERS.length) {
    beginFraming(currentManeuver().instructions);
  } else {
    showResults();
  }
}

function showResults() {
  goToPhase("results");
  stage.classList.add("hidden");
  results.classList.remove("hidden");

  const flatResults = {};
  const flatValues = {};
  for (const m of MANEUVERS) {
    flatResults[m.key] = state.sessionResults[m.key].status;
    flatValues[m.key] = state.sessionResults[m.key].value;
  }
  const history = state.savedThisSession ? loadHistory() : saveSession(flatResults, flatValues);
  state.savedThisSession = true;

  results.innerHTML = "<h2>Results</h2>";
  for (const m of MANEUVERS) {
    const positiveSessions = countPositiveSessions(history, m.key);
    const tier = recommendationTier(positiveSessions);
    const thisResult = flatResults[m.key];

    const card = document.createElement("div");
    card.className = "result-card";
    const tierText = {
      neutral: "Within the typical range so far.",
      note: "Past the reference line this time. Worth keeping an eye on across future sessions.",
      checked: "Past the reference line across multiple separate sessions. Worth mentioning to a doctor.",
    }[tier];
    const badge = {
      positive: { label: "Past the line", className: "badge badge-positive" },
      negative: { label: "Within range", className: "badge badge-negative" },
      inconclusive: { label: "Inconclusive", className: "badge" },
    }[thisResult];

    card.innerHTML = `
      <div class="result-card__head">
        <h3>${m.label}</h3>
        <span class="${badge.className}">${badge.label}</span>
      </div>
      <p class="tier tier-${tier}">${tierText}</p>
      <canvas class="sparkline" width="280" height="60"></canvas>
    `;
    results.appendChild(card);
    drawSparkline(card.querySelector(".sparkline"), history, m);
  }

  const disclaimerNote = document.createElement("p");
  disclaimerNote.className = "footnote";
  disclaimerNote.textContent =
    "This is a screening aid, not a diagnosis. All processing happened locally in your browser.";
  results.appendChild(disclaimerNote);

  const again = document.createElement("button");
  again.id = "again-btn";
  again.textContent = "Do another session";
  again.addEventListener("click", resetForNewSession);
  results.appendChild(again);
}

function drawSparkline(sparklineCanvas, history, maneuver) {
  const sctx = sparklineCanvas.getContext("2d");
  const w = sparklineCanvas.width;
  const h = sparklineCanvas.height;
  sctx.clearRect(0, 0, w, h);

  const points = history
    .map((session) => session.values?.[maneuver.key])
    .filter((v) => v !== null && v !== undefined);
  if (points.length < 2) return;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const toXY = (v, i) => [
    (i / (points.length - 1)) * (w - 8) + 4,
    h - 4 - ((v - min) / range) * (h - 8),
  ];

  sctx.strokeStyle = "#2f6f66";
  sctx.lineWidth = 2;
  sctx.beginPath();
  points.forEach((v, i) => {
    const [x, y] = toXY(v, i);
    if (i === 0) sctx.moveTo(x, y);
    else sctx.lineTo(x, y);
  });
  sctx.stroke();
}

function resetForNewSession() {
  state.maneuverIndex = 0;
  state.retryCount = 0;
  state.reps = [];
  state.sessionResults = {};
  state.savedThisSession = false;
  results.classList.add("hidden");
  stage.classList.remove("hidden");
  beginFraming(currentManeuver().instructions);
}

function tick(now) {
  requestAnimationFrame(tick);
  if (state.phase === "results" || state.phase === "intro" || state.phase === "loading") return;

  if (video.readyState >= 2) {
    const detection = handLandmarker.detectForVideo(video, now);
    state.lastLandmarks = detection.landmarks?.[0] ?? null;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  // Deliberately not mirrored: landmarks come straight off this same raw video
  // frame, so drawing it unmirrored keeps the skeleton overlay aligned with
  // the real hand without needing a second coordinate flip for every draw call.
  runPhase(now);
}

// Draws the current maneuver's target as a single ring around the specific
// landmark being measured, animating between the neutral and target pose.
// Called from every phase where the user is meant to be working toward it
// (frame, countdown, capture), not just the first one, so the guide never
// disappears right when it matters most.
function drawManeuverTarget(maneuver, now) {
  state.animT = (Math.sin(now / 900) + 1) / 2;
  const ghost = interpolatePose(neutral, maneuver.target, state.animT);
  drawTargetRing(ctx, ghost[maneuver.trackedLandmark], canvas.width, canvas.height);
}

function runPhase(now) {
  const landmarks = state.lastLandmarks;

  if (state.phase === "calibrate") {
    drawSkeleton(ctx, neutral, canvas.width, canvas.height, { color: "#f5c26b", alpha: 0.3 });
    const current = landmarks
      ? checkFraming(landmarks, canvas.width, handBoundingBoxWidth(landmarks) * canvas.width)
      : "not_detected";
    updateFramingStreak(current);
    if (current === "ok" && state.framingStreak >= CALIBRATION_STABLE_FRAMES) {
      state.refHandWidthPx = handBoundingBoxWidth(landmarks) * canvas.width;
      beginFraming(currentManeuver().instructions);
      return;
    }
    setStatus(
      current === "ok" ? "Holding, capturing your reference..." : FRAMING_MESSAGES[current] ?? "Getting ready...",
      current === "ok" ? "good" : "warn"
    );
    if (landmarks) drawSkeleton(ctx, landmarks, canvas.width, canvas.height);
    return;
  }

  if (state.phase === "frame") {
    const maneuver = currentManeuver();
    if (maneuver.showTableGuide) drawTableEdgeLine(ctx, canvas.width, canvas.height);
    drawManeuverTarget(maneuver, now);
    if (landmarks) drawSkeleton(ctx, landmarks, canvas.width, canvas.height);

    const current = checkFraming(landmarks, canvas.width, state.refHandWidthPx);
    updateFramingStreak(current);
    if (state.framingStreak >= STABLE_FRAMES) {
      setStatus(current === "ok" ? "Get ready..." : FRAMING_MESSAGES[current], current === "ok" ? "good" : "warn");
      if (current === "ok") goToPhase("countdown");
    }
    return;
  }

  if (state.phase === "countdown") {
    const maneuver = currentManeuver();
    if (maneuver.showTableGuide) drawTableEdgeLine(ctx, canvas.width, canvas.height);
    drawManeuverTarget(maneuver, now);
    if (landmarks) drawSkeleton(ctx, landmarks, canvas.width, canvas.height);
    const elapsed = now - state.phaseStartTime;
    const secondsLeft = 3 - Math.floor(elapsed / 1000);
    if (secondsLeft <= 0) {
      beginCapture();
      return;
    }
    drawCountdown(ctx, canvas.width, canvas.height, secondsLeft);
    return;
  }

  if (state.phase === "capture") {
    const maneuver = currentManeuver();
    if (maneuver.showTableGuide) drawTableEdgeLine(ctx, canvas.width, canvas.height);
    drawManeuverTarget(maneuver, now);
    if (landmarks) drawSkeleton(ctx, landmarks, canvas.width, canvas.height, { color: "#4ade80" });

    const framing = checkFraming(landmarks, canvas.width, state.refHandWidthPx);
    state.captureTotalFrames += 1;
    if (framing !== "ok") state.captureBadFrames += 1;
    if (landmarks) {
      const value = maneuver.measure(landmarks);
      if (state.captureStartValue === null) state.captureStartValue = value;
      state.captureExtreme =
        state.captureExtreme === null ? value : maneuver.combineExtreme(state.captureExtreme, value);
    }
    setStatus("Hold that position...", "good");

    if (now - state.phaseStartTime >= CAPTURE_MS) {
      finishRep();
    }
    return;
  }

  if (state.phase === "rep_result") {
    if (now - state.phaseStartTime >= REP_RESULT_MS) {
      if (state.retryRep) {
        beginFraming(currentManeuver().instructions);
      } else {
        advanceRepOrManeuver();
      }
    }
    return;
  }
}

startBtn.addEventListener("click", start);
