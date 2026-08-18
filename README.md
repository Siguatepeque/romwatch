# romwatch

A camera-based wrist and thumb hypermobility screener that runs entirely in the browser.

romwatch watches your hand through your webcam and guides you through two short
movements: bending your thumb toward your forearm, and bending your wrist back. The first
is a real clinical test, the thumb-to-forearm apposition item from the Beighton score, the
standard nine-point exam clinicians use to screen for generalized joint hypermobility. The
second is a supplementary wrist range-of-motion check that is not part of the formal score
but uses the same hand-tracking data.

Every measurement runs on-device with [MediaPipe's Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker).
Nothing is uploaded. Session history lives in your browser's local storage, nowhere else.

**This is a screening aid, not a diagnosis.** It is not a medical device and does not
replace a clinician. If it flags something, the right next step is a conversation with a
doctor, not a conclusion drawn from a webcam. See [PAPER.md](PAPER.md) for the full
methodology, the clinical sources it draws from, and an honest account of what it can and
cannot measure.

## Why the thumb-to-forearm test

Most hypermobility screening happens in a doctor's office, if it happens at all. The
condition is frequently missed for years, especially in people whose joints just read as
"flexible" rather than as a pattern worth mentioning at a checkup. The thumb-to-forearm
maneuver is one of the few Beighton items a single camera watching a hand can actually
measure well, since it does not require tracking a joint the camera cannot see. That is why
it is the anchor of this project rather than an invented substitute.

## How it works

1. **Calibrate.** Hold your hand up naturally so the app can learn your hand's size at a
   comfortable distance. This becomes the reference for the framing checks that follow.
2. **Get framed.** Before each movement, the app checks that your hand is visible, not too
   close, not too far, and not clipped at the edge of the frame. The tolerance is wide on
   purpose. There is no single correct way to sit at a webcam, so it only flags the cases
   where a measurement would actually be unreliable, and says "Good, you're all set" the
   moment your current position works.
3. **Follow the ghost.** A faint animated hand outline shows the target position for the
   current movement. Match your real hand to it.
4. **Hold.** Each movement runs for three short repetitions. A repetition with poor
   tracking is discarded and retried rather than scored, since a bad reading is worse than
   no reading.
5. **Read the result.** Each maneuver needs at least two of three good repetitions past a
   threshold to count as positive for that session. The recommendation only escalates to
   "worth mentioning to a doctor" once a maneuver has come back positive across three or
   more separate sessions, not from a single reading.

## Running it locally

Camera access requires a secure or local context, so opening `index.html` directly as a
file will not work. Serve the folder instead:

```
node serve.js
```

Then open `http://localhost:4173`.

## Tests

```
node geometry.test.js   # pure geometry and scoring logic, no browser needed
npx playwright test     # structural end-to-end check with a fake camera device
```

The Playwright test drives a real Chromium instance with Chromium's fake camera device,
which has no hand in its synthetic feed. It confirms the app loads, the camera and
MediaPipe model initialize without errors, and the "no hand detected" framing state
displays correctly. It cannot validate real gesture recognition accuracy, since there is no
hand in the test feed to recognize. That part was tested by hand, against an actual camera.

## Stack

Plain HTML, CSS, and JavaScript with no build step and no framework. Hand tracking comes
from MediaPipe Tasks Vision, loaded from a CDN as an ES module. The only development
dependency is Playwright, used for the end-to-end test above.

## Scope

This is a v1 focused on the wrist and thumb, per its own premise, not a reimplementation of
the full Beighton exam. It does not attempt the other seven points of the score (elbow and
knee hyperextension, trunk flexion, the little-finger test), which need different joints and
in some cases a full-body pose model to reach. It tracks one hand per session. There is no
account system or cross-device sync; history lives in that browser's local storage only.
See [PAPER.md](PAPER.md) for the complete list of limitations and the reasoning behind each
design decision.
