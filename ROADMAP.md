# AEGIS: roadmap

Assumes one person plus coding agents. Hours are offsets from the start of each block.

**Current state (2026-11-14):** the 30-hour MVP and Block R (real NASA data) are built and approved, and the demo is frozen at tag `demo-ready` (D-3). See `implementationsandgoals.txt`.
**Current priority: Block P, phases and gravity (§0).** Block R made Mars transit and Mars surface real. Block P does the same for the other mission phases (LEO, lunar surface, back on Earth), makes crew physiology respond to each phase's gravity, adds the Inspiration4 reference panel (formerly stretch item S-4), and then extends and re-freezes the demo.

---

## 0. Block P: phases and gravity (PRIORITY 1)

### 0.1 Goals and sources

Order set by the user (2026-11-14): **radiation first, then gravity, then the Inspiration4 panel, then the extended demo.**

| Goal | Phase / view | Source | Provenance |
|---|---|---|---|
| LEO radiation | `LEO` | NASA OSDR **RadLab**: ISS-RAD (or REM/TEPC) dose-rate time series, curated from SRAG data; web UI + API | `NASA_MEASURED` (area), `NASA_DERIVED` (personal, neutron split) |
| Lunar-surface radiation | `LUNAR_SURFACE` | LRO **CRaTER** hourly dose rate, corrected to the lunar surface (PDS `LRO-L-CRAT-3-CDR-CALIBRATED-V1.0` / `LRO-L-CRAT-3-4-DDR`, ISWA hourly product). Reference check only: Chang'e-4 LND surface measurement, 1,369 µSv/day (Zhang et al. 2020, *Science Advances*) | `NASA_DERIVED` (surface correction is a transform) |
| Earth radiation after landing | `POST_LANDING` | US EPA **RadNet**: one station's gamma exposure-rate CSV window (mR/h → µSv/h) | `MEASURED_OTHER` (new label, badge "Measured · EPA RadNet") |
| Gravity-dependent physiology | all phases | To be decided after research (P-4). NASA has **no measured** bone or muscle loss rates for 0.16 g or 0.38 g. | `SYNTHETIC_CALIBRATED` where cited, else `SYNTHETIC` |
| Inspiration4 reference panel (was S-4) | CrewDetail | NASA **OSDR** Inspiration4 blood studies (OSD-569/570/571/575): **aggregate** pre/post-flight CBC/CMP ranges only | `NASA_MEASURED` (aggregate reference) |

### 0.2 Rules for Block P

All Block R rules still apply (fetch once and replay offline, a manifest entry with sha256 for every file, provenance on every value, deterministic replay, labelled transforms, no identifiable person's data). In addition:

1. **New provenance label `MEASURED_OTHER`.** It is for measured data from a non-NASA agency (EPA RadNet). The badge names the agency. Never show it as NASA data.
2. **Non-NASA papers are reference checks, not replays.** The Chang'e-4 value goes into the manifest `reference` block of the CRaTER entry and into a fidelity test, never into the data stream.
3. **Partial gravity stays honest.** No physiology formula for 0.16 g or 0.38 g is invented silently. P-4 collects the published evidence, the user picks the model, and every parameter cites its source or says `heuristic`.
4. **Inspiration4 data is aggregate only.** Means, ranges or percentiles across the crew per time point. Never one person's values, never a name.
5. **The frozen demo is the baseline.** `demo-ready` stays as it is. The extended demo gets a new tag after Gate P.

### 0.3 Work items and timeline (≈ 14 h)

| Hours | Item | Done when |
|---|---|---|
| P+0 to 1 | **P-0 `MEASURED_OTHER` label.** Add it to the `Provenance` enum, `weakest()` ordering, the `DataSourceBadge` ("Measured · <agency>"), the footer data line and AGENTS.md §2a | Enum, badge and footer tests pass; a `MEASURED_OTHER` observation needs a `dataset_id` like `NASA_*` |
| P+1 to 3 | **P-1 LEO radiation (RadLab).** Confirm which ISS instrument and dates RadLab has; fetch one quiet window (build time, API); replay it into `LEO` like MSL/RAD (absorbed `NASA_MEASURED`; equivalent, neutron, personal `NASA_DERIVED`, with the published Q) | Replayed mean dose-equivalent rate is within the manifest tolerance of the published ISS value for that window; `LEO` radiation tile shows "NASA · ISS-RAD <year>" |
| P+3 to 5 | **P-2 Lunar-surface radiation (CRaTER).** Fetch one quiet hourly window; apply the surface correction named in the manifest; replay into `LUNAR_SURFACE` (`NASA_DERIVED`). Decide whether `TRANSIT` (Earth–Moon) also uses CRaTER without the surface correction | Replayed mean is checked against Chang'e-4's 1,369 µSv/day with the tolerance and solar-cycle caveat stated in the manifest |
| P+5 to 6 | **P-3 Earth radiation (RadNet).** Fetch one station's exposure-rate window; convert mR/h → µSv/h (×10, stated as the transform); replay into `POST_LANDING` as `MEASURED_OTHER` | Post-landing tile shows "Measured · EPA RadNet <station>"; tampered file falls back to `SYNTHETIC` |
| P+6 to 7 | **P-4 Partial-gravity research (decision point).** Collect published evidence for bone, muscle/VO₂max, fluid shift and orthostatic tolerance at 0 / 0.16 / 0.38 / 1 g (ISS and Apollo data, bed-rest and partial-weight-bearing analogs, NASA HRP evidence reports, models). Write the options with sources into `implementationsandgoals.txt` | **The user picks the model.** No physiology code changes before that |
| P+7 to 10 | **P-5 Gravity-dependent physiology.** Implement the chosen model: phase gravity drives BMD loss, fitness/VO₂max drift, fluid-shift effects on HR/BP, and orthostatic risk after a gravity increase (landing). Parameters live in `mission.yaml` with `sources`; the Gravity RIDGE tile explains the current effect | Tests show different drift rates per phase; `orthostatic_intolerance` and `demo_5min` landing still fire as expected; calibration test still passes |
| P+10 to 12 | **P-6 Inspiration4 reference panel (was S-4).** Fetch aggregate CBC/CMP statistics per time point from OSDR; manifest entry; CrewDetail panel showing the pre/post-flight reference ranges (AEGIS has no lab signals yet, so the panel is reference only) | Panel renders offline with a NASA badge; a test checks that the bundled file has no per-person rows |
| P+12 to 14 | **P-7 Extended demo + re-rehearsal.** Add segments to `demo_5min` that show the new phases (proposal: a short LEO opening before trans-Mars departure, with ISS-RAD radiation and 0 g drift; exact segments agreed with the user once P-1..P-6 land). Add `leo_baseline` and `lunar_surface` scenarios. Rehearse twice untouched; update the README walkthrough and PRD §14 | Extended demo plays twice untouched; every expected alert in its window; no-network test passes |

**Gate P (supervisor):** LEO, lunar-surface and Earth radiation replay bundled measured data with correct provenance (`NASA_MEASURED` / `NASA_DERIVED` / `MEASURED_OTHER`); every gravity parameter cites a source or says heuristic; the Inspiration4 panel holds aggregate data only; the extended demo runs with networking blocked; all checks pass. Then **D-4: re-freeze**, tag `demo-ready-v2` (with the user's go-ahead).

### 0.4 If Block P runs behind

Cut in this order, top first: P-6 Inspiration4 panel → P-7 demo extension (keep `demo-ready` and add the new scenarios only) → P-3 Earth radiation → P-5 reduced to orthostatic risk on gravity increase only. **Never cut:** P-0 (needed by P-3), P-1 and P-2 (real radiation for the remaining space phases), and P-4 (no gravity model without the user's decision).

---

## 1. Decisions

1. **AEGIS (`PRD.md` + `AGENTS.md`) is the spec.** The ASTRA-MED documents describe a different product. Keep them out of the build.
2. **Real data first (2026-11-14).** NASA data wherever it is public. Live runtime calls stay forbidden: DONKI, OSDR, CDAWeb, PDS, Horizons, RadLab and RadNet are used only as **bundled snapshots**.
3. **What to take from ASTRA-MED:** the one-click scenario dock, the "same symptom, different cause" compound rule, the reaction-time self-test as a stretch item.
4. **Leave out:** local LLMs, River, NeuroKit2, Dexie, live network APIs, the body map, the gamified mode, signed packets.
5. **Do not copy unverified threshold tables.** A number becomes `verified: true` only with a NASA document and clause id that someone actually read.
6. **The demo is the product.** The story: *real deep-space radiation, measured by NASA's RAD on the way to Mars, replayed into a crew that handles a real solar particle event on its own, while the ground sees it one light-time later.* Block P adds: *every phase uses measured radiation, and the body responds to the gravity of each place.*
7. **Block P (2026-11-14, user):** order radiation → gravity → Inspiration4 panel → extended demo; non-NASA measured data gets its own `MEASURED_OTHER` label; the partial-gravity model is chosen by the user after research; `demo_5min` is extended (not kept frozen) and re-frozen as `demo-ready-v2`.

## 2. Architecture

| Topic | As built (Gates 1–4 + Block R) | Block P change |
|---|---|---|
| Processes | One FastAPI process with `onboard` and `ground` stores; ground written only by `link/` | unchanged |
| Data sources | Seeded simulator in-process; `datasets/` replays (MSL/RAD, Horizons, DONKI/OMNI2) feed the same tick path | New replays: ISS-RAD (RadLab), CRaTER, RadNet; OSDR aggregate panel (read-only reference) |
| Provenance | `NASA_MEASURED`, `NASA_DERIVED`, `SYNTHETIC_CALIBRATED`, `SYNTHETIC` | + `MEASURED_OTHER` |
| Simulator | Phase sets gravity (display only), radiation fallback, comm delay | Phase gravity drives physiology drifts and orthostatic risk |
| Storage | In-memory ring buffers (1-min) + ~140 d daily trends; `data/nasa/` bundled (~210 KB, target < 20 MB) | More bundled windows, same target |
| Rules | THRESHOLD, BASELINE, CUMULATIVE, COMPOUND | unchanged |
| UI | 5 views, offline fallback, `DataSourceBadge`, space-weather card | Inspiration4 panel in CrewDetail; Gravity tile explains the current effect |

## 3. Done

| Block | Items | Status |
|---|---|---|
| 30-hour MVP | Setup, simulator (Gate 1), rules + alerts (Gate 2), crew UI (Gate 3), radiation + SPE, ground link (Gate 4), demo script (D-1, D-2) | approved |
| Block R: real NASA data | R-0 data layer + provenance, R-1 nine verified NASA-STD-3001 limits, R-2 MSL/RAD cruise + Gale replay, R-3 real March 2012 SPE, R-4 Horizons light time, R-5 space-weather card, R-6 calibrated simulator; **Gate R** | approved |
| Freeze | D-3, tag `demo-ready` | approved |

Details of each item are in `implementationsandgoals.txt` (section 2) and `README.md`.

## 4. Cut list for regressions

If something already built breaks late, drop in this order: landing orthostatic scenario → BASELINE rule → recommendation round trip → CrewDetail charts → EVA readiness. Never cut: the SPE emergency flow, the delayed ground view, alert evidence, unverified-limit markers, provenance badges, the freeze block.

## 5. Stretch (only if the user asks, after Gate P)

1. S-2: 30-second reaction-time test feeding COGNITIVE readiness
2. S-3: `arrhythmia` scenario
3. A second real SPE (a larger event) as an extra scenario

## 6. Open items

- Submission deadline and format: still to confirm; they set the length of the D-4 freeze.
- ~~P-1~~ answered: RadLab serves DOSIS 3D DOSTEL (Columbus), Liulin, Lidal and Timepix for the ISS, not ISS-RAD/REM/TEPC. Bundled DOSTEL-1, 2019-01-03..10; reference 731 µSv/day (Zhang et al. 2020, same weeks); <Q> 2.26 from Berger et al. 2017. Replay gives 617 µSv/day (−16 %, inside the stated 150 µSv/day).
- ~~P-2~~ answered: NASA ISWA publishes CRaTER D1+D2 already ×1.333 (Si → water) and altitude-corrected to the surface, so no project-made correction. `TRANSIT` keeps the MSL/RAD cruise replay (free space). Replay gives 1,169 µSv/day vs Chang'e-4 1,369 (−15 %, inside 267).
- ~~P-3~~ answered: Houston TX (where crews return), 2024-06-03..12; RadNet now reports dose equivalent in nSv/h directly. Label says terrestrial gamma, EPA, not NASA.
- P-4: the partial-gravity model (user decision).
- ~~P-7~~ answered (2026-11-14): LEO + lunar stop. A short ISS opening with one South Atlantic Anomaly notice, then a short lunar-surface stop (0.16 g), before the Mars segments. Built 2026-11-14 (P-7 part 2: ISS 0-30m, Moon 30m-50m, then Mars transit; README has the timings).
