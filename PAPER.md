# Methods, limitations, and conclusions

## Motivation

Generalized joint hypermobility is usually screened with the Beighton score, a nine-point
clinical exam a clinician performs by hand: five paired joint tests (each side scores a
point) plus one trunk flexion test. Two of those nine points come from the wrist and hand:
whether the little finger can be passively extended past 90 degrees, and whether the thumb
can be bent down to touch the flexor side of the forearm. A Beighton score at or above a
cutoff, combined with other criteria, is part of how hypermobile Ehlers-Danlos syndrome and
generalized hypermobility spectrum disorder get diagnosed (Malfait et al., 2017).

Most people never get screened for this at all. It is not a routine part of a checkup, and
the condition is often missed for years, particularly in people who read as merely
"flexible" rather than as having a joint pattern worth mentioning to a doctor. romwatch
tries to close a small piece of that gap: a webcam watching a hand can measure both of the
Beighton score's upper-limb items, the thumb-to-forearm test and the little-finger
hyperextension test, without needing to track a joint the camera can't see. It cannot
replace the other seven points of a real exam (elbow and knee hyperextension, trunk
flexion), and says so throughout.

## Clinical grounding

- Beighton, Solomon, and Soskolne, "Articular mobility in an African population," *Annals
  of the Rheumatic Diseases*, 1973. The paper that introduced the nine-point scoring
  system. romwatch's thumb-to-forearm maneuver is one of its two upper-limb items.
- Grahame, Bird, and Child, "The revised (Brighton 1998) criteria for the diagnosis of
  benign joint hypermobility syndrome," *Journal of Rheumatology*, 2000. Ties the Beighton
  score to a diagnostic framework rather than treating the number alone as meaningful.
- Malfait et al., "The 2017 International Classification of the Ehlers-Danlos Syndromes,"
  *American Journal of Medical Genetics Part C*, 2017. The current diagnostic framework for
  hEDS and generalized hypermobility spectrum disorder, which requires a Beighton score at
  or above an age-adjusted cutoff (5 of 9 for most adults) as one of several criteria, not
  as a diagnosis by itself.
- Malek, Reinhold, and Pearce, "The Beighton Score as a measure of generalised joint
  hypermobility," *Rheumatology International*, 2021. Argues the score is weighted toward
  upper-limb joints, ignores several major joints entirely, and should not be used alone to
  rule generalized hypermobility in or out. This is the paper the limitations section below
  leans on most.
- Juul-Kristensen, Rombaut, et al., "Measurement properties of clinical assessment methods
  for classifying generalized joint hypermobility: a systematic review," *American Journal
  of Medical Genetics Part C*, 2017. Reports that even clinician-administered Beighton
  scoring has only fair to poor reliability by current evidence standards, which matters
  for how much confidence a camera-based version can reasonably claim.

## Method

**Calibration.** Before any maneuver, the user holds a hand up naturally in front of the
camera. Once MediaPipe's Hand Landmarker detects a stable hand for about half a second, the
app records the hand's bounding-box width in pixels as a personal reference size, used to
normalize distance measurements and to judge camera distance for the rest of the session.

**Framing.** Camera position is checked continuously, but only to catch cases where a
measurement would be unreliable: no hand visible, the hand too small or too large relative
to the calibrated reference, or the wrist near the edge of the frame. The tolerance bands
are wide on purpose. There is no single correct distance or angle to sit at a webcam, so the
check only flags the extremes and confirms out loud ("Good, you're all set") once the
current position is workable, rather than asking for one exact setup.

**Guidance.** An earlier version overlaid an animated ghost skeleton on the live camera feed
as a moving target to match. In practice it did the opposite of its job: a second
hand-shaped outline superimposed on your own tracked hand read as a confusing second hand,
not a guide, and it drew attention away from the text instructions sitting right above it.
It was removed. In its place, a real reference photo of the completed maneuver (cropped
from a public-domain Wikimedia Commons image, see Credits) is shown next to the
instructions, which stay on screen for the whole maneuver instead of being overwritten by
live tracking feedback. The photo shows what the target position looks like; it plays no
role in scoring.

**Measurement.** For the thumb-to-forearm maneuver, the distance from the thumb-tip
landmark to an approximated forearm line is measured and normalized by hand size. There is
no elbow landmark available from a hand-only model, so the forearm direction is
approximated as the ray from the wrist pointing away from the hand. For the little-finger
maneuver, the angle between the wrist-to-pinky-knuckle vector and the pinky's proximal
phalanx is measured: how far the finger has folded back relative to the hand's own
orientation, rather than relative to the camera frame. That makes it work at any hand
rotation or camera angle, which the first version of this maneuver (an invented wrist-bend
test measured against a fixed horizontal line) did not.

**Scoring.** Each maneuver runs for three repetitions. A repetition is discarded and retried
(up to twice) if tracking quality drops during capture, rather than being scored as a miss.
A repetition counts as positive if its extreme value clears a threshold; a session counts a
maneuver as positive only if at least two of three valid repetitions were positive. Session
results are stored in the browser's local storage, and the on-screen recommendation
escalates only once a maneuver has come back positive across three or more separate
sessions, not on a single reading.

## Related work

Camera-based hand range-of-motion measurement is an active research area, and romwatch is
not the first attempt at it. Several recent studies validate MediaPipe Hands specifically
against manual goniometry for hand and thumb range of motion, including a 2025 study in
*Sensors* that extracted clinical thumb ROM parameters (IP, MP, and CMC joint angles) from a
single camera, and a 2023 study in *PLOS ONE* using a webcam-based machine learning approach
for three-dimensional ROM evaluation. A 2023 paper describes automatic hand ROM measurement
from smartphone images for telemedicine use. One of these studies explicitly reports depth
ambiguity during finger flexion as a known accuracy limitation of MediaPipe-based
measurement, the same limitation noted below.

None of the papers found target the Beighton thumb-to-forearm or little-finger maneuvers
specifically, and none build a repeated-session consistency layer on top of a single
reading. That combination is what romwatch adds, and it is a modest difference worth
stating plainly rather than overselling.

## Limitations

- **Two of nine.** romwatch measures two of the nine Beighton items (both upper-limb ones)
  and cannot produce a full Beighton score. It says so, rather than implying the two it
  covers stand in for the whole exam.
- **No depth sensor.** A single 2D camera cannot recover true 3D joint angles as precisely
  as a goniometer or a depth camera. Landmark depth estimates from a monocular model are
  the least reliable dimension, consistent with what the related-work studies above report.
- **No forearm tracking.** The hand-only model has no elbow landmark, so the "forearm line"
  used in the thumb-to-forearm measurement is a geometric approximation from the wrist and
  hand direction, not a tracked limb.
- **The little-finger angle is a proxy, not the clinical reference frame.** The real test
  measures dorsiflexion relative to the dorsum of the hand, usually with a second person
  passively pushing the finger back. romwatch measures the angle at the joint relative to
  the hand's own metacarpal direction instead, self-administered. The two move together
  (more backward bend reads as a larger angle either way), but the numbers aren't
  interchangeable, and the threshold is tuned against romwatch's own metric, not the
  clinical 90-degree figure directly.
- **Not validated against a clinician cohort.** The measurement thresholds are reasoned from
  the clinical literature above, not fitted to a study population scored by both romwatch
  and a clinician performing the real exam side by side.
- **Even the clinical exam has modest reliability.** Juul-Kristensen et al. report only fair
  to poor reliability for clinician-administered Beighton scoring. A camera-based
  approximation of these items should be read with at least that much caution, likely more.
- **Lighting and skin tone.** Hand landmark models can lose accuracy in poor lighting or
  across skin tones underrepresented in training data. romwatch does not attempt exposure
  correction beyond flagging when no hand is detected at all.
- **One hand, one sitting.** The current version tracks a single hand per session and makes
  no attempt to identify which hand, or to prompt for both sides as the real exam would.

## How these were addressed in the design, where they could be

- The quality gate and retry logic exist specifically because a bad reading is worse than no
  reading, so tracking failures are discarded rather than silently scored as negative.
- An earlier version also tried to verify that the person had actually moved during the
  capture window, by comparing the value at the start of the window to the extreme reached.
  It was removed: people naturally get into position before the countdown finishes rather
  than waiting for the capture window to begin, which the check had no way to tell apart
  from someone who never moved at all, and it was rejecting genuine attempts on that basis
  far more than it was catching real non-attempts. Whether a rep reflects genuine effort is
  currently left to the person doing the test, the same trust boundary the thumb test
  already assumes.
- The two-of-three-repetitions rule filters single noisy frames from being read as a joint
  finding.
- The multi-session escalation rule (three or more separate positive sessions before the
  recommendation changes) exists because a single Beighton-style test, camera-based or not,
  is not something that should change anyone's behavior on the strength of one reading.
- The framing tolerance is deliberately wide, on the reasoning that a measurement that only
  works from one exact camera position is not a measurement that will get used consistently.
- What this design cannot fix: the fundamental gap between a single 2D camera and a
  clinician's hands-on exam. No amount of retry logic recovers a dimension the camera never
  captured.

## Conclusion

As a portfolio project, romwatch demonstrates a full pipeline: real-time hand tracking in
the browser, geometry derived from real clinical tests rather than an invented metric, a
capture and quality-gating state machine, and a consistency layer across sessions, all
running client-side with no backend. As a clinical tool, it is exactly what its own
disclaimer says: a screening aid inspired by two items of a real clinical score, not a
diagnostic device. Turning it into something closer to clinically useful would mean, at minimum,
validating its thresholds against a clinician-scored cohort and extending it toward the
other seven Beighton items that a single hand-tracking camera cannot reach on its own.
