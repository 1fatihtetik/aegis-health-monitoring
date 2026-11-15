# AEGIS: roadmap

Assumes one person plus coding agents. Hours are offsets from the start of each block.

**Current state (2026-11-14):** the 30-hour MVP, Block R (real NASA data) and Block P (phases and gravity) are built and approved. The demo is frozen at tag `demo-ready-v2` (D-4); the Block R demo stays at `demo-ready`. See `implementationsandgoals.txt`.
**Current priority: Block T, crew self-tests and body map (§0). Status: IN PROGRESS (go-ahead 2026-11-15).** Built: T-0, T-3, T-1, T-2, T-4, T-5 (approved), T-7 SANS watch (ready for review). Next: T-8 landing gate.

Why Block T: the hackathon challenge asks for a tool that helps astronauts **assess their own health**. The MVP watches the crew (sensors, environment, radiation), but the crew can only enter one thing (the 0-3 headache rating). Block T lets the crew take the tests and measurements themselves, on a routine, with plain instructions, and shows the result on a clickable body figure.

---

## 0. Block T: crew self-tests and body map (PRIORITY 1, planned)

### 0.1 Challenge coverage (from the brief, 2026-11-14)

| Challenge point | Before Block T | Block T item |
|---|---|---|
| Visual self-assessment tool; HRP + other agencies' data; hazard → indicator effects; crew vs ground attention; clear metrics; several environments; charts over time; colour coding; plain explanations | ✅ built | (kept) |
| Treatment and improvement guidance | ◐ only inside alerts | T-0 measurement catalog ("why / how / what to do"), T-8 gate actions |
| Prevention actions | ◐ only inside alerts | T-1 routine, T-7 SANS actions, T-8 landing gate |
| Astronaut enters data (keyboard, clicks, camera) | ◐ headache 0-3 only | T-2, T-3, T-4, T-5, T-9 (keyboard + clicks; camera stays out) |
| Which measurements are possible in space, and why each exam is needed | ◐ | T-0 catalog, shown in every test |
| Prompts to measure / act on a routine | ❌ | T-1 schedule |
| Clickable human body figure | ❌ (was left out) | T-6 body map |
| Gamification | ❌ | **stays out (user decision)** |

### 0.2 Decisions (user, 2026-11-14)

1. **Taking tests is a must. No gamification:** no points, streaks, badges, levels, leaderboards or compliance scores. The schedule is a plain "due / done / overdue" list; overdue is a neutral `INFO` item, never red.
2. **New provenance label `CREW_ENTERED`.** For values a person types or taps in the UI.
3. **T-6 body map is in** (reverses the earlier "leave out the body map").
4. **Gemini extras accepted:** SANS rule + fluid/sodium intake (T-7), landing readiness gate (T-8), Amsler grid self-exam (T-9). **Rejected:** the downlink summary packet with opt-in sharing (so questionnaire answers stay onboard only), a hardcoded 20-minute delay (we keep JPL Horizons light time).
5. **Severity:** keep `INFO < CAUTION < WARNING < EMERGENCY` in the engine; add the NASA loss category as a small sublabel in the UI (CAUTION = LOMO, loss of mission objectives; WARNING = LOM, loss of mission; EMERGENCY = LOC, loss of crew; from PRD §7.4). No engine change.
6. **Hazard filter on the schedule: RIDGE** (the 5 NASA hazards already tagged on every rule). No second taxonomy.
7. **Demo:** extend `demo_5min` with test moments, re-rehearse, re-freeze as `demo-ready-v3`.

### 0.3 Rules for Block T

All earlier rules still apply (no hardcoded limits, hazards + HRP risks on every rule, evidence in every alert, decision support not diagnosis, offline at runtime, determinism, ≥ 44 px targets, colour + icon). In addition:

1. **`CREW_ENTERED` honesty.** Only values a person enters in the UI get `CREW_ENTERED`. Results scripted for the four synthetic crew (scenarios, demo) stay `SYNTHETIC` with a basis such as "scripted self-test result". It needs no `dataset_id`; it records the entry method (form, PVT-B, stand test, questionnaire, Amsler). It ranks above `SYNTHETIC_CALIBRATED` and below `MEASURED_OTHER` in `weakest()`. Entered values live in memory only: never written to disk, `data/` or git.
2. **Same path as every other value.** Self-test results are `Observation`s through `POST /api/v1/observations` (or the in-process equivalent) → store → rules. The engine does not care who produced a value. No second evaluator, no event reducer.
3. **Every test explains itself** from one catalog (`config/selftests.yaml`): why it exists (hazard + HRP risk), how to do it (numbered steps), what counts as normal (the band comes from `limits.yaml`, with the "unverified" marker where it applies), and when to involve the CMO or the ground.
4. **New limits go into `limits.yaml`.** Glucose, temperature, PVT-B, KSS, stand-test and intake numbers have no NASA-STD-3001 clause we have read, so they enter as `verified: false` with an honest `source_ref` (paper or "clinical heuristic"). Flip one to `verified: true` only with a document + clause id actually read.
5. **Questionnaires stay onboard.** T-4 signals are marked onboard-only; `link/` never sends them (not even rollups) and the ground store never holds them. The journal rule ("private by default") is unchanged.
6. **Protocols are named, short modes are labelled.** PVT-B runs 3 minutes by default; a short demo mode must say "Demo length, not the 3-minute protocol". The stand test runs on the simulation clock in scenarios; a real-time version uses the real protocol length.
7. **Scenario determinism holds.** Scripted results are part of the scenario (seeded). Human input is not part of the determinism guarantee, and no scenario test depends on it.
8. **The body map shows, it does not diagnose.** Region colour = the highest open severity linked to that region, with the icon (✓ ▲ ■ ✖) and text. Copy says "Indicators consistent with… / Recommend CMO review", never "You have X".

### 0.4 Work items and timeline (≈ 29 h)

| Hours | Item | Done when |
|---|---|---|
| T+0 to 2 | **T-0 Foundation.** `Provenance.CREW_ENTERED` (enum, ranking, badge "Crew-entered", footer line, `check_agency` passes it without a dataset); `config/selftests.yaml` catalog (per test: id, signals, why, steps, limit refs, hazards, hrp_risks, schedule, escalation text); `GET /selftests`; severity sublabel (LOMO/LOM/LOC) on AlertBanner, AlertCenter and EmergencyTakeover | Provenance tests (ranking, no dataset needed, never shown as measured by an agency); catalog loader refuses an entry without hazards/HRP or with an unknown limit ref; sublabel rendered |
| T+2 to 6 | **T-3 Guided measurements.** Forms for blood pressure (sys/dia), SpO₂, body temperature, body mass, blood glucose (mg/dL), fluid intake (mL) and sodium intake (mg). Each shows the catalog steps, the live limit band and the unverified marker; submit → `CREW_ENTERED` observations → existing rules (`physio.spo2.low`, BP, temperature) plus new threshold rules where a limit exists | Entering a low SpO₂ raises the existing alert with `CREW_ENTERED` evidence; works with the link blacked out; out-of-range typing is refused with a plain message (units fixed per signal) |
| T+6 to 9 | **T-1 Routine schedule.** Due / done / overdue board driven by the simulation clock from the catalog schedules: morning BP + SpO₂, post-sleep PVT-B, weekly body mass, daily intake, extra checks after a gravity change (stand test, PVT-B). RIDGE filter pills; overdue = neutral `INFO` (no penalty); "Start" opens the test (≤ 3 taps) | Deterministic due list for a scenario + seed; a gravity increase adds the extra checks; overdue never raises above `INFO`; no points/streaks anywhere (test greps the UI copy) |
| T+9 to 12 | **T-2 Reaction-time test (PVT-B).** 3-minute test, keyboard (Space) or tap, random 1-4 s gaps, lapse = response > 355 ms (Basner et al. 2011, PVT-B; used in NASA's Cognition battery); outputs mean RT, lapses, false starts as signals; feeds the COGNITIVE readiness score and `cog.performance_risk`; labelled short demo mode | Timer logic unit-tested (ISI range, lapse rule, false starts); COGNITIVE readiness shows the PVT-B component; short mode labelled |
| T+12 to 14 | **T-4 Questionnaires (onboard only).** Karolinska Sleepiness Scale (1-9), NASA-TLX workload (6 sub-scales), motion sickness rating, mood check. Results feed local compound rules (e.g. sleepiness ≥ 7 + PVT-B lapses → `cog.performance_risk` evidence) | Link test: no T-4 signal reaches the ground store, also after the blackout ends; badge says "Stays on board" |
| T+14 to 17 | **T-5 Stand test.** Guided timer: supine baseline, then standing readings at 1, 3, 5, 10 min (HR + BP); outputs HR rise and systolic drop; feeds `cardio.orthostatic` and the Gravity tile; protocol source named in the catalog (NASA 10-minute stand test, Lee et al.; exact protocol confirmed in T-5) | `orthostatic_intolerance` can be driven by a scripted stand test; real-time mode keeps the protocol length; sim-clock mode in scenarios |
| T+17 to 19 | **T-7 SANS rule + intake (HRP-10).** COMPOUND rule on days at low gravity, cabin ppCO₂ and sodium/fluid intake (+ Amsler flag once T-9 lands); `CAUTION`, hazards GRAVITY_FIELDS + HOSTILE_CLOSED_ENV; every parameter `heuristic` or cited (the CO₂ and sodium links are hypotheses, and the copy says so); action = eye self-check + CMO review | Rule unit tests (fires, does not fire, hysteresis); evidence lists each member; rationale states the evidence is limited |
| T+19 to 21 | **T-8 Landing readiness gate.** New readiness kind `LANDING` (like EVA, with `go_min_ref`): PVT-B, stand test, fluid intake, SpO₂, days at low g. Go / Hold card before a scheduled gravity increase, each component shown, actions for Hold | Gate shows Hold for C3 before the Mars landing in `orthostatic_intolerance`; weights in `readiness.yaml` marked heuristic |
| T+21 to 23 | **T-9 Amsler grid self-exam.** One eye at a time; the astronaut clicks areas that look wavy, missing or blurred; outputs a flag + marked cells; feeds T-7 and the body map eye region; catalog says when to tell the CMO | Click input recorded as `CREW_ENTERED`; "any distortion" flag raises an `INFO`/`CAUTION` per the catalog; no image stored |
| T+23 to 27 | **T-6 Clickable body map.** SVG figure (CrewOverview + CrewDetail) with regions: brain & eyes, heart & vessels, lungs, bones & muscles, kidneys, blood & immune. Each region: colour + icon by highest open severity; drawer with what it does, linked live signals and charts, HRP risks + RIDGE hazards, the tests for it (Start buttons), and the Inspiration4 panel under blood & immune. Region ↔ signal/rule/test mapping lives in config, not code | Region colour follows open alerts; every region has ≥ 1 linked test or signal; keyboard + touch reachable, ≥ 44 px; offline; no diagnosis copy |
| T+27 to 29 | **T-10 Extended demo + freeze v3.** Add test moments to `demo_5min` (e.g. scripted PVT-B lapses for C1 after sleep loss, the landing gate showing Hold and a scripted stand test for C3 after the Mars landing, the due board); optional live PVT-B in short mode that the script does not wait for; rehearse twice untouched; README walkthrough and PRD §14 timings | Demo plays twice with identical alerts; every alert in its window; no-network test passes |

**Gate T (supervisor):** every self-test explains why / how / normal from the catalog; `CREW_ENTERED` only on UI-entered values and never stored; T-4 answers never reach the ground; no gamification anywhere; each new rule has hazards + HRP risks and limits in `limits.yaml` with honest `verified`; the body map colours follow open alerts and never diagnose; everything works with the link blacked out and networking blocked; all checks pass. Then **D-5: re-freeze**, tag `demo-ready-v3` (with the user's go-ahead).

### 0.5 If Block T runs behind

Cut in this order, top first: T-9 Amsler grid → T-8 landing gate (keep the stand test) → T-7 SANS rule (keep intake entry) → T-10 reduced to a separate `selftest_tour` scenario (keep `demo-ready-v2`). **Never cut:** T-0, T-1, T-2, T-3, T-4, T-5 (taking tests is a must) and T-6 (user decision).

---

## 1. Decisions

1. **AEGIS (`PRD.md` + `AGENTS.md`) is the spec.** The ASTRA-MED documents describe a different product. Keep them out of the build.
2. **Real data first (2026-11-14).** NASA data wherever it is public. Live runtime calls stay forbidden: DONKI, OSDR, CDAWeb, PDS, Horizons, RadLab and RadNet are used only as **bundled snapshots**.
3. **What to take from ASTRA-MED:** the one-click scenario dock, the "same symptom, different cause" compound rule, the reaction-time self-test (now T-2).
4. **Leave out:** local LLMs, River, NeuroKit2, Dexie, live network APIs, the gamified mode, signed packets, camera input, the downlink summary packet. (The body map was on this list; the user brought it back as T-6 on 2026-11-14.)
5. **Do not copy unverified threshold tables.** A number becomes `verified: true` only with a NASA document and clause id that someone actually read.
6. **The demo is the product.** The story: *real deep-space radiation, measured by NASA's RAD on the way to Mars, replayed into a crew that handles a real solar particle event on its own, while the ground sees it one light-time later.* Block P added: *every phase uses measured radiation, and the body responds to the gravity of each place.* Block T adds: *the crew tests themselves on a routine, understands each result, and sees it on their own body.*
7. **Block P (2026-11-14, user):** order radiation → gravity → Inspiration4 panel → extended demo; `MEASURED_OTHER` for non-NASA measured data; partial-gravity model A, LINEAR; demo re-frozen as `demo-ready-v2`.
8. **Block T (2026-11-14, user):** see §0.2.

## 2. Architecture

| Topic | As built (MVP + Block R + Block P) | Block T change |
|---|---|---|
| Processes | One FastAPI process with `onboard` and `ground` stores; ground written only by `link/` | unchanged |
| Data sources | Seeded simulator; `datasets/` replays (MSL/RAD, ISS DOSTEL-1, CRaTER, RadNet, Horizons, DONKI/OMNI2) on the same tick path; OSDR Inspiration4 aggregate panel | + crew self-test entries through `POST /observations` |
| Provenance | `NASA_MEASURED`, `NASA_DERIVED`, `MEASURED_OTHER`, `SYNTHETIC_CALIBRATED`, `SYNTHETIC` | + `CREW_ENTERED` |
| Config | `limits`, `rules`, `mission`, `crew`, `readiness`, `datasets` | + `selftests.yaml` (catalog + schedule + body-map regions) |
| Rules | THRESHOLD, BASELINE, CUMULATIVE, COMPOUND (+ `unless:`) | unchanged types; new rules (intake, PVT-B, stand test, SANS, Amsler) |
| Readiness | OVERALL, EVA, COGNITIVE, PHYSICAL | + `LANDING`; COGNITIVE gains a PVT-B component |
| Link | Priority, delay, blackout | onboard-only signals (T-4) never sent |
| UI | 5 views, offline fallback, `DataSourceBadge`, space-weather card, Inspiration4 panel, Gravity tile | + schedule board, test screens, body map, severity sublabel |

## 3. Done

| Block | Items | Status |
|---|---|---|
| 30-hour MVP | Setup, simulator (Gate 1), rules + alerts (Gate 2), crew UI (Gate 3), radiation + SPE, ground link (Gate 4), demo script (D-1, D-2) | approved |
| Block R: real NASA data | R-0 data layer + provenance, R-1 nine verified NASA-STD-3001 limits, R-2 MSL/RAD cruise + Gale replay, R-3 real March 2012 SPE, R-4 Horizons light time, R-5 space-weather card, R-6 calibrated simulator; **Gate R** | approved |
| Freeze | D-3, tag `demo-ready` | approved |
| Block P: phases and gravity | P-0 `MEASURED_OTHER`; P-1 LEO = ISS DOSTEL-1 (DLR, via NASA OSDR RadLab) with SAA stand-down + INFO notice; P-2 lunar = LRO CRaTER (NASA ISWA, checked vs Chang'e-4); P-3 Earth = EPA RadNet Houston; P-4/P-5 linear partial-gravity model; P-6 Inspiration4 aggregate panel; P-7 `leo_baseline`, `lunar_surface`, extended `demo_5min`; **Gate P** | approved |
| Re-freeze | D-4, tag `demo-ready-v2` | approved |

Details of each item are in `implementationsandgoals.txt` (section 2) and `README.md`. The full Block P plan is in git history (`ROADMAP.md` before 2026-11-14 Block T planning).

## 4. Cut list for regressions

If something already built breaks late, drop in this order: landing orthostatic scenario → BASELINE rule → recommendation round trip → CrewDetail charts → EVA readiness. Never cut: the SPE emergency flow, the delayed ground view, alert evidence, unverified-limit markers, provenance badges, the freeze block, and (after Block T) the self-test schedule and tests.

## 5. Stretch (only if the user asks, after Gate T)

1. S-3: `arrhythmia` scenario
2. A second real SPE (a larger event) as an extra scenario
3. Countermeasures view (exercise prescription vs done) and private journal (PRD M5)

## 6. Open items

- Submission deadline and format: still to confirm. They decide whether all of Block T (≈ 29 h) fits or the §0.5 cut order is used.
- T-3: glucose, temperature and intake bands have no NASA clause read yet; they enter as `verified: false` unless one is found (NASA-STD-3001 Vol 1 / OCHMO briefs are checked first).
- T-5: protocol confirmed by the supervisor 2026-11-15 (wall-lean adaptation of Lee et al. 2015, 5 min supine, readings at 1/3/5/10 min, STOP control, Freeman 2011 criteria); built.
- T-7: the SANS evidence for CO₂ and sodium is limited; the rule's copy must say so. Revisit if the HRP SANS evidence report gives a usable measure.
- T-10: the exact demo test moments are proposed in T-10 and agreed with the user before the rehearsal.
