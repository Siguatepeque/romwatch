import {
  WRIST,
  checkFraming,
  FRAME_ISSUE_MESSAGES,
  handSpan,
  squareAspect,
  pickPrimaryHand,
  normalizedThumbForearmReach,
  pinkyExtensionAngleDeg,
  isThumbRepPositive,
  isPinkyRepPositive,
  describeThumbReach,
  describePinkyAngle,
  thumbPoseIssue,
  pinkyPoseIssue,
  thumbTargetLine,
  sessionManeuverStatus,
  countPositiveSessions,
  recommendationTier,
} from "./geometry.js";
import { neutral } from "./poses.js";
import { drawSkeleton, drawCountdown, drawThresholdLine } from "./draw.js";
import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

// Both maneuvers use the same palm-to-camera pose as calibration, on purpose:
// one consistent setup for the whole session, no repositioning partway
// through. Both are real Beighton score items (the two upper-limb ones),
// not an invented substitute.
const MANEUVERS = [
  {
    key: "thumb",
    label: "Thumb-to-forearm",
    instructions:
      "Use your other hand to push your thumb down toward your wrist, as far as it comfortably goes. This test is meant to be done with help, the same way a clinician would push it for you.",
    referencePhoto: {
      src: "docs/reference-thumb-forearm.jpg",
      alt: "A real photo of someone bending their thumb down to touch the inside of their forearm, the Beighton thumb-to-forearm test",
      caption: "Target position, reached with the other hand pushing, which is how the test is administered. Your camera angle doesn't need to match the photo: what's measured is whether your thumb tip crosses the dashed line at your wrist. Only the hand being tested has to be fully in frame.",
    },
    measure: normalizedThumbForearmReach,
    isPositive: isThumbRepPositive,
    describe: describeThumbReach,
    poseIssue: thumbPoseIssue,
    targetLine: thumbTargetLine,
    combineExtreme: Math.min,
  },
  {
    key: "pinky",
    label: "Little finger extension",
    instructions:
      "Use your other hand to push your little finger back as far as it comfortably goes. This one is also meant to be done with help. Turn your hand so the camera sees the bend side-on if you can.",
    referencePhoto: {
      src: "docs/reference-pinky-extension.jpg",
      alt: "A real photo of someone's little finger bent back past the plane of their hand, the Beighton little finger hyperextension test",
      caption: "Target position, reached with the other hand pushing. It's fine if that hand covers part of the view, and it doesn't need to be fully in frame itself.",
    },
    measure: pinkyExtensionAngleDeg,
    isPositive: isPinkyRepPositive,
    describe: describePinkyAngle,
    poseIssue: pinkyPoseIssue,
    combineExtreme: Math.max,
  },
];

// One attempt per maneuver, a second only if the first wasn't a clean
// positive (negative or inconclusive). Stops the moment a positive shows up,
// since a single successful demonstration is enough to score one, and more
// than two tries per maneuver is a lot to ask of someone with a hypermobile
// joint condition, which is exactly who this app is for.
const MAX_REPS_PER_MANEUVER = 2;
const STABLE_FRAMES = 5;
const CALIBRATION_STABLE_FRAMES = 10;
const CAPTURE_MS = 2500;
const COUNTDOWN_MS = 3000;
const REP_RESULT_MS = 1200;
const MAX_RETRIES_PER_REP = 2;
// Both maneuvers are performed with the other hand pushing, and that hand
// spends much of the attempt on top of the joint being measured, so losing
// some of the frames is the normal case rather than a sign of a bad attempt.
// The gate is here to catch attempts where the hand was never really seen at
// all; it was set at 0.15 back when a second hand in frame wasn't expected.
const QUALITY_BAD_FRACTION_LIMIT = 0.35;
const HISTORY_KEY = "romwatch.history";

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const instructionLine = document.getElementById("instruction-line");
const referencePhoto = document.getElementById("reference-photo");
const referencePhotoImg = document.getElementById("reference-photo-img");
const referencePhotoCaption = document.getElementById("reference-photo-caption");
const statusText = document.getElementById("status-text");
const readout = document.getElementById("readout");
const readoutText = document.getElementById("readout-text");
const readoutDetail = document.getElementById("readout-detail");
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
  refSpanPx: 0,
  framingState: null,
  framingStreak: 0,
  phaseStartTime: 0,
  captureBadFrames: 0,
  captureTotalFrames: 0,
  captureExtreme: null,
  lastLandmarks: null,
  // The hand this session is measuring: MediaPipe's handedness label, locked
  // in at calibration, plus its last known wrist position. Both are how
  // pickPrimaryHand keeps the assisting hand from being measured by mistake.
  trackedHand: { label: null, wrist: null },
  lastHandLabel: null,
  otherHands: [],
  otherHandOnly: false,
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

function frameAspect() {
  return canvas.width / canvas.height;
}

// Measurements run on aspect-corrected landmarks; framing checks and drawing
// stay in raw normalized coordinates, which is the space they belong in.
function measureCurrent(maneuver, landmarks) {
  return maneuver.measure(squareAspect(landmarks, frameAspect()));
}

// The number the app is actually deciding on, in words, kept on screen the
// whole time it's measuring. This is the difference between "it said no" and
// "it said 38% while my thumb was flat against my wrist": the second is
// something you can report, argue with, or check against the dashed line on
// the overlay. Hidden only when there's nothing being measured.
function showReadout(reading, prefix = "") {
  readout.classList.remove("hidden");
  readout.classList.toggle("readout--met", reading.met);
  readoutText.textContent = prefix ? `${prefix} ${reading.text}` : reading.text;
  readoutDetail.textContent = reading.detail;
}

function showLiveReadout(maneuver, landmarks) {
  if (!landmarks) {
    readout.classList.remove("hidden");
    readout.classList.remove("readout--met");
    readoutText.textContent = "Not measuring: no hand tracked right now.";
    readoutDetail.textContent = "";
    return;
  }
  showReadout(maneuver.describe(measureCurrent(maneuver, landmarks)));
}

function hideReadout() {
  readout.classList.add("hidden");
}

// Skeleton, plus the maneuver's own pass/fail line where it has one. Drawn
// from the same geometry that scores the rep, so if the line looks wrong on
// screen, the scoring is wrong in the same way.
function drawTracking(maneuver, landmarks, style) {
  // Any hand that isn't the one being measured is drawn faintly and in a
  // different color. Two hands in frame is the expected state here, so the
  // useful thing to show is which of them the app decided to measure: a
  // session that goes wrong because it locked onto the assisting hand is
  // then visibly wrong instead of just wrong.
  for (const other of state.otherHands) {
    drawSkeleton(ctx, other, canvas.width, canvas.height, { color: "#f5f0e6", alpha: 0.25, lineWidth: 2, pointRadius: 2 });
  }
  if (!landmarks) return;
  if (maneuver?.targetLine) {
    drawThresholdLine(ctx, maneuver.targetLine(landmarks, frameAspect()), canvas.width, canvas.height);
  }
  drawSkeleton(ctx, landmarks, canvas.width, canvas.height, style);
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
    // Up to 2, not 1: most of these maneuvers need the other hand to push the
    // tracked joint into position, and with a single-hand limit that second
    // hand entering frame could steal tracking outright. pickPrimaryHand
    // below sorts out which of the up-to-two detected hands is the one
    // actually being measured.
    numHands: 2,
  });

  state.phase = "calibrate";
  setInstruction(
    "Hold up the hand you want to test, on its own for now: palm to the camera, fingers relaxed and spread."
  );
  setReferencePhoto(null);
  requestAnimationFrame(tick);
}

// checkFraming only ever sees the hand being measured, so it can't tell
// "nothing in view" from "your other hand is the only thing in view." That
// second case is worth naming: it's the one where someone is doing everything
// right and the app has simply lost the hand behind the one pushing it.
function framingNow() {
  const framing = checkFraming(state.lastLandmarks, canvas.width, state.refSpanPx);
  return framing === "not_detected" && state.otherHandOnly ? "other_hand_only" : framing;
}

// Everything that decides whether the current frame can be scored: is the
// hand there, is it framed, and is it in a pose this particular maneuver can
// read. Every phase that measures asks this one question, so the reason a
// frame was thrown away is the same string that gets shown to the person.
function frameIssue(maneuver) {
  const framing = framingNow();
  if (framing !== "ok" || !state.lastLandmarks) return framing;
  return maneuver?.poseIssue?.(squareAspect(state.lastLandmarks, frameAspect())) ?? "ok";
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
  goToPhase("capture");
}

function finishRep() {
  const maneuver = currentManeuver();
  const badFraction = state.captureTotalFrames > 0 ? state.captureBadFrames / state.captureTotalFrames : 1;
  const trackingOk = badFraction <= QUALITY_BAD_FRACTION_LIMIT && state.captureExtreme !== null;

  if (!trackingOk) {
    state.retryCount += 1;
    if (state.retryCount > MAX_RETRIES_PER_REP) {
      state.reps.push({ status: "inconclusive", value: null });
      state.retryCount = 0;
      setStatus("Couldn't get a clean reading for that one. Moving on.", "warn");
      state.retryRep = false;
    } else {
      setStatus("Lost tracking, let's redo that one.", "warn");
      state.retryRep = true;
    }
    goToPhase("rep_result");
    return;
  }

  const positive = maneuver.isPositive(state.captureExtreme);
  state.reps.push({ status: positive ? "positive" : "negative", value: state.captureExtreme });
  state.retryCount = 0;
  // The best frame of the attempt, not the last one, is what got scored, so
  // that's what gets shown back rather than whatever the live line happened
  // to read as the hand relaxed.
  showReadout(maneuver.describe(state.captureExtreme), "Recorded:");
  setStatus("Recorded.", "good");
  state.retryRep = false;
  goToPhase("rep_result");
}

function advanceRepOrManeuver() {
  const lastRep = state.reps[state.reps.length - 1];
  const doAnotherRep = lastRep.status !== "positive" && state.reps.length < MAX_REPS_PER_MANEUVER;
  if (doAnotherRep) {
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
  hideReadout();
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

    const value = flatValues[m.key];
    const measured = value === null ? null : m.describe(value);

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
      <p class="measured">${
        measured ? `Measured: ${measured.detail}.` : "No usable reading this session."
      }</p>
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
    const hands = detection.landmarks.map((landmarks, i) => ({
      landmarks,
      label: detection.handedness?.[i]?.[0]?.categoryName ?? null,
    }));
    const picked = pickPrimaryHand(hands, state.trackedHand);
    state.lastLandmarks = picked ? picked.landmarks : null;
    state.otherHands = hands.filter((hand) => hand !== picked).map((hand) => hand.landmarks);
    state.otherHandOnly = !picked && hands.length > 0;
    if (picked) {
      state.trackedHand.wrist = picked.landmarks[WRIST];
      state.lastHandLabel = picked.label;
    }
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  // Deliberately not mirrored: landmarks come straight off this same raw video
  // frame, so drawing it unmirrored keeps the skeleton overlay aligned with
  // the real hand without needing a second coordinate flip for every draw call.
  runPhase(now);
}

function runPhase(now) {
  const landmarks = state.lastLandmarks;

  if (state.phase === "calibrate") {
    hideReadout();
    drawSkeleton(ctx, neutral, canvas.width, canvas.height, { color: "#f5c26b", alpha: 0.3 });
    // Calibration is where the session decides which hand it's measuring, and
    // with two hands up there's nothing to decide it by: the model's ordering
    // is arbitrary, so it could lock onto the assisting hand and spend the
    // whole session measuring the wrong one without anything looking wrong.
    const current = !landmarks
      ? "not_detected"
      : state.otherHands.length > 0
        ? "two_hands"
        : checkFraming(landmarks, canvas.width, handSpan(landmarks) * canvas.width);
    updateFramingStreak(current);
    if (current === "ok" && state.framingStreak >= CALIBRATION_STABLE_FRAMES) {
      state.refSpanPx = handSpan(landmarks) * canvas.width;
      // From here on, this is the hand being measured. Whatever else comes
      // into frame is the hand doing the pushing.
      state.trackedHand.label = state.lastHandLabel;
      beginFraming(currentManeuver().instructions);
      return;
    }
    setStatus(
      current === "ok" ? "Holding, capturing your reference..." : FRAME_ISSUE_MESSAGES[current] ?? "Getting ready...",
      current === "ok" ? "good" : "warn"
    );
    if (landmarks) drawSkeleton(ctx, landmarks, canvas.width, canvas.height);
    return;
  }

  if (state.phase === "frame") {
    drawTracking(currentManeuver(), landmarks);
    showLiveReadout(currentManeuver(), landmarks);

    const current = frameIssue(currentManeuver());
    updateFramingStreak(current);
    // Feedback is immediate; only starting the countdown waits for the state
    // to hold. An assisting hand moving in and out flips this state
    // constantly, and gating the message on the streak too meant the app
    // could sit there saying nothing at all while someone waited.
    setStatus(current === "ok" ? "Get ready..." : FRAME_ISSUE_MESSAGES[current], current === "ok" ? "good" : "warn");
    if (current === "ok" && state.framingStreak >= STABLE_FRAMES) goToPhase("countdown");
    return;
  }

  if (state.phase === "countdown") {
    drawTracking(currentManeuver(), landmarks);
    showLiveReadout(currentManeuver(), landmarks);
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
    drawTracking(maneuver, landmarks, { color: "#4ade80" });
    showLiveReadout(maneuver, landmarks);

    const issue = frameIssue(maneuver);
    state.captureTotalFrames += 1;
    if (issue !== "ok") state.captureBadFrames += 1;
    // Only frames with nothing wrong with them feed the score. A clipped
    // hand, a hand pointing at the camera, a curled finger: each can produce
    // a wildly good-looking reading, and since the rep keeps the most extreme
    // frame it sees, one such frame would otherwise be exactly the one kept.
    if (landmarks && issue === "ok") {
      const value = measureCurrent(maneuver, landmarks);
      state.captureExtreme =
        state.captureExtreme === null ? value : maneuver.combineExtreme(state.captureExtreme, value);
    }
    setStatus(
      issue === "ok" ? "Hold that position..." : `Not counting these frames: ${FRAME_ISSUE_MESSAGES[issue]}`,
      issue === "ok" ? "good" : "warn"
    );

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
