<div align="center">

# romwatch

**A camera-based hypermobility screener for two real Beighton score tests, running entirely
in your browser.**

[![License: MIT](https://img.shields.io/badge/license-MIT-2f6f66)](LICENSE)
![No frontend dependencies](https://img.shields.io/badge/frontend-zero%20dependencies-2f6f66)
![Tests](https://img.shields.io/badge/tests-node%20%2B%20playwright-2f6f66)

[Why this exists](#why-these-tests) •
[How it works](#how-it-works) •
[Quick start](#quick-start) •
[Testing](#testing) •
[Limitations](#scope-and-limitations)

</div>

romwatch watches your hand through your webcam and guides you through two short movements:
bending your thumb toward your forearm, and bending your little finger back. Both are real
clinical tests, the two upper-limb items of the **Beighton score**, the standard nine-point
exam clinicians use to screen for generalized joint hypermobility.

Every measurement runs on-device with [MediaPipe's Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker).
Nothing is uploaded. Session history lives in your browser's local storage, nowhere else.

> [!IMPORTANT]
> **This is a screening aid, not a diagnosis.** It is not a medical device and does not
> replace a clinician. If it flags something, the right next step is a conversation with a
> doctor, not a conclusion drawn from a webcam. See [PAPER.md](PAPER.md) for the full
> methodology, the clinical sources it draws from, and an honest account of what it can and
> cannot measure.

## Screenshots

<table>
<tr>
<td width="50%">

**Disclaimer and start screen**

<img src="docs/disclaimer.png" alt="romwatch's disclaimer screen, explaining what it checks and that it is a screening aid, not a diagnosis" width="100%" />

</td>
<td width="50%">

**Results screen** *(sample data, for illustration)*

<img src="docs/results.png" alt="romwatch's results screen, showing one maneuver within the typical range and one flagged across multiple sessions" width="100%" />

</td>
</tr>
</table>

The live camera screen isn't pictured here since a static screenshot of your own hand mid-movement
doesn't demo well out of context. Run it yourself, see [Quick start](#quick-start).

## Why these tests

Most hypermobility screening happens in a doctor's office, if it happens at all. The
condition is frequently missed for years, especially in people whose joints just read as
"flexible" rather than as a pattern worth mentioning at a checkup. The thumb-to-forearm and
little-finger maneuvers are the two Beighton items a single camera watching a hand can
actually measure well, since neither requires tracking a joint the camera can't see (unlike
the elbow, knee, or trunk items). That's why they're the anchor of this project rather than
an invented substitute test.

## How it works

1. **Calibrate.** Hold your hand up naturally so the app can learn your hand's size at a
   comfortable distance. This becomes the reference for the framing checks that follow.
2. **Get framed.** Before each movement, the app checks that your hand is visible, not too
   close, not too far, and not clipped at the edge of the frame. The tolerance is wide on
   purpose: there's no single correct way to sit at a webcam, so it only flags the cases
   where a measurement would actually be unreliable, and says "Good, you're all set" the
   moment your current position works.
3. **See what you're aiming for.** A real reference photo of the completed maneuver is
   shown next to the instructions, which stay on screen for the whole movement rather than
   being overwritten by live tracking feedback. An earlier version overlaid an animated
   ghost hand on the camera feed as a moving target; in practice a second hand-shaped
   outline on top of your own tracked hand read as confusing, not helpful, so it was
   removed in favor of the photo and the plain live skeleton.
4. **Hold.** Each movement runs for three short repetitions. A repetition with poor
   tracking is discarded and retried rather than scored, since a bad reading is worse than
   no reading.
5. **Read the result.** Each maneuver needs at least two of three good repetitions past a
   threshold to count as positive for that session. The recommendation only escalates to
   "worth mentioning to a doctor" once a maneuver has come back positive across three or
   more separate sessions, not from a single reading.

## Quick start

Camera access requires a secure or local context, so opening `index.html` directly as a
file won't work. Serve the folder instead:

```bash
git clone https://github.com/Siguatepeque/romwatch.git
cd romwatch
node serve.js
```

Then open **http://localhost:4173** in a browser with a webcam.

## Testing

```bash
node geometry.test.js   # pure geometry and scoring logic, no browser needed
npx playwright test     # structural end-to-end check with a fake camera device
```

The Playwright test drives a real Chromium instance with Chromium's fake camera device,
which has no hand in its synthetic feed. It confirms the app loads, the camera and
MediaPipe model initialize without errors, and the "no hand detected" framing state
displays correctly. It can't validate real gesture recognition accuracy, since there's no
hand in the test feed to recognize. That part was tested by hand, against an actual camera.

## Tech stack

- **No framework, no bundler.** Plain HTML, CSS, and JavaScript (ES modules) throughout.
- **[MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)** for on-device hand landmark detection, loaded from a CDN.
- **`localStorage`** for session history. No backend, no database, no accounts.
- **[Playwright](https://playwright.dev/)** as the only development dependency, used for the end-to-end test above.

```
index.html    geometry.js   draw.js         tests/e2e.spec.js
style.css     poses.js      app.js          geometry.test.js
```

## Scope and limitations

This is a v1 focused on the two hand-only Beighton items, not a reimplementation of the
full nine-point exam. It doesn't attempt the other seven points of the score (elbow and
knee hyperextension, trunk flexion), which need different joints and in some cases a
full-body pose model to reach. It tracks one hand per session. There's no account system
or cross-device sync; history lives in that browser's local storage only.

See [PAPER.md](PAPER.md) for the complete methodology, the clinical literature it's grounded
in, the full list of limitations, and how each was addressed in the design where it could be.

## Credits

Both reference photos are cropped from [Hypermobility Beighton Score.png](https://commons.wikimedia.org/wiki/File:Hypermobility_Beighton_Score.png)
by Rollcloud on Wikimedia Commons, dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
No attribution was required, it's credited here anyway.

## License

[MIT](LICENSE)
