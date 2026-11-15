# AGENTS.md: instructions for coding agents

This repo builds **AEGIS**, an onboard-first astronaut health monitoring system (hackathon MVP).
**Read `PRD.md` first.** It is the source of truth for scope, the domain model and the APIs. This file tells you *how* to build it.
**Then read `ROADMAP.md`.** It sets the scope, the build order and the cut list. Where the PRD describes more than the roadmap, build the roadmap version.

> **Current state (2026-11-15): Block S, simpler UI: BUILT, awaiting supervisor review** (`ROADMAP.md` §0c): roles Crew / CMO / Ground with their own tabs, a Demo controls drawer, one Today list (tests + countermeasures), alerts in one panel, sections folded by default. **Block C, countermeasures and private journal: BUILT, awaiting supervisor review (Gate C)** (`ROADMAP.md` §0b, §2c below): countermeasure catalog + Done logging, countermeasure rows in the crew's Today list (was a filter on the routine board until Block S), per-person weekly adherence for the CMO and the ground (link rollups), the `cm.exercise.low_7d` INFO rule, a private journal on the tablet with CMO-only sharing. Block L, data-honesty labels: DONE, approved (`ROADMAP.md` §0a, `18f018e`): badges say "Simulated" / "Simulated · NASA-calibrated", unverified limits say "Not a NASA limit · <kind>" (`source_kind` in `limits.yaml`), a "Where our data comes from" panel, and the demo opening line. Block T (crew self-tests and body map) DONE: T-0..T-10, Gate T; D-5 re-freeze at tag `demo-ready-v3`. Hand-entered values replace the wearable stream for 30 min (user decision 2026-11-15). Done and frozen: MVP, Block R (tag `demo-ready`), Block P (tag `demo-ready-v2`), Block T (tag `demo-ready-v3`). Block T lets the crew take tests and measurements themselves on a routine (`CREW_ENTERED` values), explains each one, and adds a clickable body map. **No gamification.** §2a covers real data; §2b covers self-tests.

---

## 1. Ground rules

1. **Autonomy first.** Onboard features must never depend on the ground node or on the internet at runtime. If the link is blacked out or the ground side is broken, the crew app must still work fully.
2. **No hardcoded medical limits.** Every threshold comes from `config/limits.yaml` and carries `source_ref` + `verified`. Never present an unverified number as a NASA value. The UI must mark every `verified: false` limit as not NASA. The marker reads "Not a NASA limit · <kind>" (Block L, §8, `ROADMAP.md` §0a), where the required `source_kind` says what the number is (published source, clinical guideline, AEGIS design setting, NASA reference that is not a standard). The marker may change words; it may never disappear or say NASA.
3. **Traceability.** Every rule, alert and score must carry `hazards[]` (RIDGE enum) and `hrp_risks[]` (`HRP-01`…`HRP-17`, see PRD §7.2). PRs that add a rule without these fields are incomplete.
4. **Explainability.** An alert payload must include its evidence (signal refs + values + limit + window). No black-box scores.
5. **Real NASA data where it exists; honest labels everywhere.** Radiation, space weather, comm delay and limits come from bundled NASA snapshots (§2a); where NASA has no data, measured data from another agency is allowed with its own label (`MEASURED_OTHER`). Crew physiology is synthetic, because no public in-flight astronaut vitals exist, and its parameters are cited. Every value carries `provenance`. Never add an identifiable person's health data, and never present a synthetic value as measured.
6. **Decision support, not a diagnosis.** Never write UI copy that diagnoses ("You have X"). Use "Indicators consistent with… / Recommend CMO review".
7. **Determinism.** The simulator and tests use seeded RNG. A scenario + seed must always produce the same alerts.
8. **Offline at runtime.** NASA data is fetched once by `scripts/fetch_nasa_data.py` and replayed from `data/nasa/`. No runtime code may make an outbound internet request (serving the local API and WebSocket is fine).

## 2. Stack & layout

```text
backend/            Python 3.11+, FastAPI, Pydantic v2, in-memory store
  app/
    main.py         FastAPI app + /ws/live; one process holding the onboard and ground stores
    runtime.py      real-time loop, speed/pause, WebSocket broadcast (only place that reads the wall clock)
    world.py        one scenario run: sim -> store -> rules -> alerts -> snapshot -> link
    config.py       loads config/*.yaml; Config.limit(ref) is the only way to read a limit
    clock.py        SimClock (injectable)
    api/routes.py   all REST routes; every GET takes ?node=onboard|ground
    domain/         enums (Hazard, HrpRisk, Severity, SIGNALS table), pydantic models
    sim/            simulator core, scenario loader, scenarios/*.yaml
    rules/          rule models, engine (threshold/baseline/cumulative/compound)
    alerts/         lifecycle state machine, dedup (hysteresis is in the engine)
    scores/         readiness scores, radiation summary + SPE state
    countermeasures/ (Block C) catalog models; session log, today's plan, weekly adherence (pure functions)
    link/           store-and-forward delay queue, priority, blackout; the ground store
    db/             in-memory ring buffers per signal (1-min resolution)
    datasets/       (Block R) manifest + sha256 check, replay adapters: rad.py (MSL/RAD),
                    horizons.py (R-4 light time), spaceweather.py (R-5 DONKI + OMNI2 card);
                    Block P adds ISS (RadLab), CRaTER and RadNet replays and the Inspiration4 panel loader;
                    pure functions of (dataset, offset, seed)
  tests/
data/nasa/          (Block R) bundled NASA snapshots, read-only, checked in
  MANIFEST.yaml     one entry per file: id, tier, source_url, retrieved, sha256, terms, transform;
                    `agency` only for non-NASA data (e.g. EPA; missing = NASA)
  raw/              files exactly as downloaded (untrusted input; parse with python -P (keeps the script dir off sys.path), never execute)
  derived/          small normalized CSV/JSON produced by the fetch script from raw/
scripts/
  fetch_nasa_data.py  build-time only: downloads, normalizes, writes MANIFEST.yaml
frontend/           React + TS + Vite + Tailwind + TanStack Query + uPlot/Recharts (implemented by Claude)
  src/
    views/          CrewOverview (includes RIDGE tiles; Environment is the Hostile-Env
                    drill-down), CrewDetail (mode crew|cmo), Radiation, AlertCenter (shown in the alert
                    panel, Block S), GroundConsole; Today (Block S: the crew's list + test screens, was
                    SelfTests); Block C adds Journal
    components/     StatusRing, Sparkline, LimitBandChart, AlertBanner, EmergencyTakeover,
                    ScenarioDock, AlertChecklist, EvidenceDetails, HeadacheReport, LimitBadge;
                    Block T adds MeasurementForm, PvtTest, Questionnaire, StandTest, AmslerGrid,
                    BodyMap, ReadinessGate, SeveritySublabel; Block S TodayList (tests + countermeasures); Block C adds
                    AdherenceChart (+ WeeklyAdherence), SharedJournal
    api/            hand-written typed client + WebSocket hook; limits.ts bundles config/limits.yaml
                    for the offline fallback (GET /api/v1/limits replaces it when connected)
config/
  limits.yaml       all thresholds (PRD §9)
  rules.yaml        rule definitions
  mission.yaml      phases, gravity, comm delay, simulator parameters
  crew.yaml         4 synthetic crew + baselines
  readiness.yaml    readiness score components, weights, alert penalties
  datasets.yaml     (Block R) which dataset feeds which signal/phase/scenario, time windows, compression
  selftests.yaml    (Block T) self-test catalog: why / steps / limit refs / hazards / HRP risks /
                    schedule / escalation, plus body-map regions -> signals, rules, tests
  countermeasures.yaml (Block C) countermeasure catalog: type / why / steps / equipment / prescription refs /
                    session or schedule / triggered_by rules / triggered_by_gate / escalation
Makefile            dev, test, lint, demo
implementationsandgoals.txt   handoff: Claude implements, Antigravity supervises; work queue, review findings, API contract
```

Not in scope (do not build unless `ROADMAP.md` §5 is reached): docker compose, a second backend process, the TREND rule type, a Wellbeing view beyond the Block C journal, journal sentiment analysis, research export, rules editor, generated API client, Playwright. Never (user decision): gamification of any kind, camera input, the downlink summary packet.

Keep this layout unless there is a strong reason to change it. If you change it, update this file.

## 2a. Real data (Block R, extended by Block P)

| Tier | Dataset | Feeds | Provenance |
|---|---|---|---|
| D1 | NASA-STD-3001 Vol 1/Vol 2, OCHMO Technical Briefs | `config/limits.yaml` (`verified: true` + clause id) | n/a (limits) |
| D2 | MSL/RAD dose rates (PDS PPI `MSL-M-RAD-3-RDR-V1.0` or CDAWeb `MSL_RAD_OBS-L2`) | area `dose_rate_absorbed`, `dose_rate_equivalent` in `MARS_TRANSIT`/`MARS_SURFACE`; the SPE in `spe_event` and `demo_5min` | `NASA_MEASURED` (area); `NASA_DERIVED` (personal dose, neutron split, shelter factor) |
| D3 | DONKI SEP/FLR/CME records; OMNIWeb OMNI2 hourly >10 MeV proton flux | event metadata in SPE alert evidence; ground space-weather card | `NASA_MEASURED` |
| D4 | JPL Horizons Earth→Mars range | `link/` one-way delay by date | `NASA_DERIVED` (range ÷ c) |
| D5 | HRP pages, OCHMO TB-004, OSDR Inspiration4 (OSD-569/570/571/575, aggregate only) | simulator constants in `mission.yaml`/`crew.yaml`; (P-6) aggregate CBC/CMP reference panel in CrewDetail | `SYNTHETIC_CALIBRATED` (constants); `NASA_MEASURED` (aggregate panel) |
| D6 (Block P) | NASA OSDR RadLab ISS dosimeter (DOSIS 3D DOSTEL-1, Columbus: the only ISS series RadLab serves for the window; no ISS-RAD/REM/TEPC there); LRO CRaTER hourly dose from NASA ISWA (already water- and surface-corrected by the CRaTER team) | area dose rates in `LEO` (P-1) and `LUNAR_SURFACE` (P-2, surface-corrected); Chang'e-4 LND 1,369 µSv/day as a reference check only | `NASA_MEASURED` (ISS); `NASA_DERIVED` (CRaTER surface correction, personal dose) |
| D7 (Block P, non-NASA) | US EPA RadNet gamma dose equivalent rate (Houston TX, one window) | area dose rate in `POST_LANDING` (P-3); RadNet now publishes nSv/h, so nSv/h ÷ 1000 → µSv/h | `MEASURED_OTHER` |

Rules:
- **Provenance enum:** `NASA_MEASURED` (a replayed value from a NASA archive), `NASA_DERIVED` (computed from NASA data by a formula named in the manifest), `MEASURED_OTHER` (Block P: a replayed measurement from a non-NASA agency such as EPA; needs a `dataset_id` whose manifest entry has `agency`; the badge names the agency and never says NASA; ranks below `NASA_DERIVED`, so a compound with a non-NASA member is never labelled NASA; the tracker and `POST /observations` reject a label that does not match the dataset's agency), `CREW_ENTERED` (Block T: a value a person typed or tapped in the UI; no `dataset_id`; records the entry method; ranks above `SYNTHETIC_CALIBRATED` and below `MEASURED_OTHER`; in memory only, never written to disk or git), `SYNTHETIC_CALIBRATED` (simulated; parameters cite a NASA source), `SYNTHETIC` (simulated; heuristic parameters).
- **Replay through the same path.** Replay adapters emit `Observation`s into the same tick → store → rules path as the simulator. The engine does not know or care where a value came from; the UI does.
- **Time mapping.** `config/datasets.yaml` maps the simulated clock onto a dataset window (start, compression factor, loop or hold). Mapping is deterministic. If compression is used, label it in the UI ("2012-03-07 event, replayed ×N").
- **Gaps.** RAD data has gaps. Fill only by holding the last value for a time set in `datasets.yaml`, then mark points `quality: SUSPECT`. Never interpolate across a gap silently.
- **Startup check.** On startup, verify every file in `datasets.yaml` exists in `MANIFEST.yaml` with a matching sha256. On failure, log it clearly and fall back to the synthetic generator for that signal with `provenance: SYNTHETIC`. Never crash the crew app over a missing dataset.
- **Size.** Bundle windows, not whole archives (target < 20 MB in `data/nasa/`).
- **Limits.** `verified: true` requires a `source_ref` that names a document, revision and clause id (e.g. `"NASA-STD-3001 Vol 2 Rev D [V2 6004], via OCHMO TB-004"`). A brief that restates the standard is fine as the pointer, but name the clause.
- **Never** fetch at runtime, commit an API key (DONKI via api.nasa.gov needs one; use `DEMO_KEY` or an env var in the fetch script only), or bundle per-person OSDR records.
- **Reference values from non-NASA papers** (e.g. Chang'e-4) go into the manifest `reference` block and a fidelity test, never into the data stream.
- **LEO SAA (P-1):** the ISS crosses the South Atlantic Anomaly several times a day and the measured dose rate spikes past the SPE alarm level. The replay emits `saa_transit` (position inside the SAA box of Berger et al. 2017) and `rad.spe.dose_rate` stands down through its `unless:` predicate. Never "fix" this by editing or capping the data.
- **Partial gravity:** the user picked model A, LINEAR (P-4): drift rate = 0 g rate x (1 - g), BP = in-flight baseline + g x Norsk 2015 offset, orthostatic risk after a gravity increase = Meck 2001 fraction x the increase. Parameters live in `mission.yaml sim.gravity` and each cites its source or says `heuristic`. Do not swap the model without the user.

## 2b. Crew self-tests (Block T, done)

Decided by the user on 2026-11-14; plan in `ROADMAP.md` §0. Do not start before the go-ahead.

| Item | What | Feeds |
|---|---|---|
| T-0 | `CREW_ENTERED` label, `config/selftests.yaml` catalog, `GET /selftests`, severity sublabel (CAUTION = LOMO, WARNING = LOM, EMERGENCY = LOC; PRD §7.4) | everything below |
| T-1 | Due / done / overdue schedule from the sim clock; RIDGE filter; extra checks after a gravity increase | starts the tests |
| T-2 | PVT-B reaction test (3 min, 1-4 s gaps, lapse > 355 ms; Basner et al. 2011) | COGNITIVE readiness, `cog.performance_risk` |
| T-3 | Guided measurements: BP, SpO₂, temperature, body mass, glucose (mg/dL), fluid (mL), sodium (mg) | existing and new rules |
| T-4 | KSS, NASA-TLX, motion sickness, mood (onboard only) | local compound rules |
| T-5 | 10-min stand test (supine, then 1/3/5/10 min) | `cardio.orthostatic`, Gravity tile, T-8 |
| T-6 | Clickable SVG body map (brain & eyes, heart & vessels, lungs, bones & muscles, kidneys, blood & immune) | shows alerts, signals, tests, Inspiration4 panel |
| T-7 | SANS compound rule (HRP-10) with intake | CAUTION + eye self-check |
| T-8 | `LANDING` readiness gate (Go / Hold) | before a gravity increase |
| T-9 | Amsler grid self-exam (click input) | T-7, body map eye region |
| T-10 | Extended `demo_5min`, re-freeze `demo-ready-v3` | demo |

Rules:
- **No gamification.** No points, streaks, badges, levels, leaderboards or compliance scores. Overdue is a neutral `INFO` item with no readiness penalty.
- **Same path.** Test results are `Observation`s through `POST /api/v1/observations` (or the in-process call) → store → rules. No second evaluator.
- **`CREW_ENTERED` only for UI input.** Scripted results for the synthetic crew stay `SYNTHETIC` ("scripted self-test result"). Never present a synthetic result as crew-entered.
- **Every test explains itself** from the catalog: why (hazard + HRP risk), numbered steps, the normal band from `limits.yaml` with the not-NASA marker (§8), when to involve the CMO / ground. No test text hardcoded in components.
- **New limits are honest.** Glucose, temperature, PVT-B, KSS, stand-test and intake bands enter `limits.yaml` as `verified: false` with a paper or "clinical heuristic" `source_ref`, unless a NASA clause was actually read.
- **Questionnaires (T-4) stay onboard.** Their signals are marked onboard-only; `link/` never sends them, not even as rollups.
- **Short modes are labelled** ("Demo length, not the 3-minute protocol"). Real-time stand tests keep the protocol length; scenarios run them on the sim clock.
- **Body map regions and their links live in config**, colour = highest open severity + icon + text, never a diagnosis.

## 2c. Countermeasures and private journal (Block C, built)

Decided by the user on 2026-11-15; plan in `ROADMAP.md` §0b; built 2026-11-15, awaiting Gate C.

- **Built as:** `countermeasure_done` (1) and `exercise_minutes` signals (entry-only) with `Observation.countermeasure_id`; `GET /countermeasures`, `/countermeasures/plan?crew_id=`, `/countermeasures/adherence?node=`, `/countermeasures/log`; `GET|POST /journal/shared`, `DELETE /journal/shared/{crew}/{entry}` (all refuse `?node=ground`). The simulator's own exercise sessions count as done (its seeded session model) and a logged session also counts in the daily `exercise_adherence_pct`. Non-exercise items count from the scenario start. Ground adherence is the last `adherence` link message (rollup priority, every `rollup_every`). Scenario event `countermeasure {crew, item, minutes?}` (SYNTHETIC) and effect `exercise_drop {crew, adherence}` (also shapes the history when it starts before it).

- **No third to-do list.** Countermeasures are rows in the crew's one Today list next to the T-1 self-tests (Block S, S-2; first built as a filter on the routine board), from `config/countermeasures.yaml` (why, steps, prescription refs into `limits.yaml`, hazards, HRP risks, `triggered_by` rules). Logged sessions are `Observation`s on the usual path (`CREW_ENTERED` from the UI, `SYNTHETIC` when scripted).
- **Adherence: CMO and ground yes, ranking never.** Per-person weekly prescribed vs done (charts and %) in the onboard CMO view and the ground console (ground only through `link/` rollups). Fixed C1..C4 order, one person per chart, no sorting by adherence, no crew average, no best/worst. The crew member's own view stays neutral (today: done / not logged, `INFO` at most, no %).
- **Journal: on the tablet, CMO-only sharing.** Stored in the browser's local storage on the crew tablet; never written to disk by the backend, never in `data/` or git, never in a `link/` message. "Share with CMO" is per entry, off by default, preview + confirm; the shared copy lives in onboard memory only and can be withdrawn. No sentiment analysis, no rule reads journal text. Copy says "Saved on this tablet, never sent to Earth" and does not claim encryption.

## 3. Commands

```bash
make dev        # run the backend + frontend (hot reload)
make test       # pytest (backend) + vitest (frontend)
make lint       # ruff (backend), tsc --noEmit (frontend)
make demo       # start the 5-minute scripted demo scenario (PRD §14)
```

Run `make lint test` before you call a task done. Report failures honestly.

## 4. Key contracts

### Observation (ingest)
```json
{ "id": "uuid", "ts": "2026-11-14T12:00:00Z", "crew_id": "C1", "location": null,
  "device_id": "bio-C1", "signal": "heart_rate", "value": 72.0, "unit": "bpm",
  "quality": "GOOD", "phase": "MARS_TRANSIT",
  "provenance": "SYNTHETIC_CALIBRATED", "dataset_id": null }
```
- `provenance` and `dataset_id` are added in R-0. Block T adds `CREW_ENTERED` (no `dataset_id`). Replayed RAD values look like `"provenance": "NASA_MEASURED", "dataset_id": "msl_rad_cruise_2012"`.
- `POST /api/v1/observations` takes a list and is idempotent on `id`.
- Units are canonical per signal (PRD §7.3). Adapters convert. The engine never converts.

### Rule (config/rules.yaml)
```yaml
- id: env.co2.high_1h
  type: THRESHOLD            # THRESHOLD|BASELINE|CUMULATIVE|COMPOUND (TREND deferred)
  signal: ppco2
  op: ">"
  limit_ref: environment.ppco2_mmHg_1h_max
  window: 1h
  agg: mean
  severity: CAUTION
  hazards: [HOSTILE_CLOSED_ENV]
  hrp_risks: [HRP-12, HRP-14]
  rationale: "Elevated CO2 linked to headache and reduced cognitive performance."
  action: "Check CDRA/scrubber status; increase ventilation; monitor symptoms."
```
Compound rules reference other rule ids or signal predicates using `all:` / `any:` / `weights:`.

### Alert (WebSocket `type: "alert"`)
```json
{ "id": "uuid", "rule_id": "env.co2.high_1h", "crew_id": null, "severity": "CAUTION",
  "state": "RAISED", "raised_ts": "...", "hazards": ["HOSTILE_CLOSED_ENV"],
  "hrp_risks": ["HRP-12","HRP-14"],
  "evidence": { "signal": "ppco2", "value": 3.6, "limit": 3.0, "limit_verified": true,
                "limit_source_ref": "NASA-STD-3001 Vol 2 Rev D [V2 6004]", "window": "1h",
                "provenance": "SYNTHETIC_CALIBRATED", "dataset_id": null },
  "action": "...", "origin": "ONBOARD" }
```

### Severity
`INFO < CAUTION < WARNING < EMERGENCY`. These map to the NASA Standards Hierarchy Pyramid (PRD §7.4). Only `EMERGENCY` may take over the full screen.

## 5. Simulator requirements (high priority, the demo depends on it)

The simulator now fills only the signals that no public dataset covers (§2a). Block R moved radiation in the Mars phases and the SPE to RAD replay and gave each simulator constant a `source_ref` or the word "heuristic". Block P moves `LEO`, `LUNAR_SURFACE` and `POST_LANDING` radiation to replays too.

- 4 crew (`C1`–`C4`, roles CDR/CMO/MS/PS), each with an individual baseline from `crew.yaml`.
- Circadian patterns: HR and temperature rhythms, sleep blocks, two exercise sessions a day.
- Phase-dependent parameters (gravity 0 / 0.16 / 0.38 / 1 g; comm delay; radiation background).
- Slow drifts: BMD −1 to −1.5% per month in 0 g, scaled down by exercise adherence. Cumulative dose integration.
- Block P (P-5, built): gravity drives physiology with the user's LINEAR model (bone and fitness drift at (1 - g) x the 0 g rate, BP rises g x 8/9 mmHg, orthostatic risk recorded after a gravity increase).
- Radiation stream split into total and **neutron** components (neutrons ≈ 30% in LEO per CSA).
- The simulator feeds the engine in-process on each simulated tick. `POST /api/v1/observations` exists and uses the same code path, but the simulator does not go through HTTP.
- Scenarios in `backend/app/sim/scenarios/*.yaml`: `nominal`, `demo_5min`, `spe_event`, `co2_scrubber_degradation`, `insomnia_streak`, `orthostatic_intolerance`, `headache_branching`; Block C adds `exercise_lapse`. Block P adds `leo_baseline` and `lunar_surface` and extends `demo_5min` (P-7). Block T adds scripted self-test results to scenarios (seeded, `SYNTHETIC`) and extends `demo_5min` again (T-10). Deferred: `arrhythmia`, `eva`, `infection`.
- `demo_5min` sets the simulation speed per segment, so a 12-minute comm delay passes in about 10 real seconds.
- Speed control 1×–10,000×. Simulated clock is injectable everywhere (never call `datetime.now()` in domain code; use `Clock`).

## 6. Comm-link rules

- Onboard and ground are two stores in one process. Ground code never reads or writes onboard state directly, and the ground store is written only by delivered `link/` messages. All traffic goes through `link/` messages with `deliver_ts = sent_ts + delay`.
- A link-blackout toggle stops delivery in both directions. The crew UI must be unaffected.
- Priority order: EMERGENCY alert summaries → other alerts → recommendations → 1-min rollups → raw data (raw only if bandwidth allows).
- Ground UI must show "Data as of T−Xm Ys" on every view.

## 7. Testing expectations

- Every rule type has unit tests (fires, doesn't fire, hysteresis, dedup).
- Every in-scope scenario has an integration test: run it with a fixed seed at max speed and assert the expected alert ids and severities fire within their windows.
- Test the link delay: a recommendation sent at T arrives at T+delay, not earlier. Test the blackout: nothing is delivered, and onboard alerts still fire.
- Frontend: component tests for StatusRing, AlertBanner, EmergencyTakeover if time allows. Backend tests come first.
- Block R:
  - **No-network test:** patch `socket.create_connection` and `socket.socket.connect` to raise for non-loopback addresses, then run `demo_5min` to the end in-process. It must pass.
  - **Manifest test:** every file in `config/datasets.yaml` has a manifest entry with a matching sha256; a tampered file falls back to `SYNTHETIC` and logs the reason.
  - **Replay fidelity:** the mean replayed cruise dose-equivalent rate is within the tolerance stated in the manifest of the published value (≈ 1.8 mSv/day); the same for the Gale-crater window (≈ 0.64 mSv/day).
  - **Limits test:** every `verified: true` limit has a clause id in `source_ref`.
  - **Provenance test:** every observation, timeseries point and alert evidence has a `provenance` value.
  - Scenario tests stay: `spe_event` still raises EMERGENCY + WARNING, now driven by replayed values.
- Block P:
  - **Replay fidelity per phase:** LEO replay mean within the manifest tolerance of the published ISS value; CRaTER surface-corrected mean checked against Chang'e-4 (1,369 µSv/day) with the tolerance and solar-cycle note in the manifest.
  - **`MEASURED_OTHER`:** needs a `dataset_id`; the badge never says NASA; tampered RadNet file falls back to `SYNTHETIC`.
  - **Gravity:** drift rates differ by phase as the chosen model says; `orthostatic_intolerance` and the `demo_5min` landing still fire.
  - **Inspiration4:** the bundled file has no per-person rows.
  - **Extended demo:** plays twice with identical alerts and passes the no-network test.

- Block T:
  - **Provenance:** `CREW_ENTERED` needs no `dataset_id`, ranks between `SYNTHETIC_CALIBRATED` and `MEASURED_OTHER`, and is never put on a scripted scenario value.
  - **Catalog:** every self-test has why / steps / hazards / HRP risks; every limit ref exists in `limits.yaml`.
  - **Schedule:** same scenario + seed gives the same due list; a gravity increase adds the extra checks; overdue never goes above `INFO`.
  - **PVT-B:** gap range, lapse rule, false starts; COGNITIVE readiness includes the PVT-B component.
  - **Onboard only:** no T-4 signal reaches the ground store, also after a blackout ends.
  - **No gamification:** a test fails if UI copy contains points, streak, badge, level-up or leaderboard wording.
  - **Body map:** region colour follows open alerts; every region links at least one signal or test.
  - **Extended demo:** plays twice with identical alerts and passes the no-network test.

- Block C (`backend/tests/test_block_c.py`, `frontend/src/test/blockC.test.tsx`):
  - **Catalog:** every item has why / steps / equipment / hazards / HRP risks / prescription; the loader refuses missing hazards/HRP, unknown limit refs and unknown trigger rules; steps never wait for the ground.
  - **Logging:** a tap is `CREW_ENTERED` (`entry_method: tap`), a scripted session stays `SYNTHETIC`; works with the link blacked out.
  - **Plan:** same scenario + seed gives the same plan; an alert adds its item and the item leaves when it resolves; "not logged" never above `INFO`; no %, score or rank in the plan.
  - **Adherence:** fixed C1..C4 order, no average; the ground sees a new session only after the link delay; a blackout holds it.
  - **Rule:** `cm.exercise.low_7d` fires, does not fire, hysteresis; `exercise_lapse` trips only C3; `nominal` stays alert-free.
  - **Journal:** share needs the confirm step; `?node=ground` is refused; nothing journal-related in any link message or the ground store (also after a blackout); no disk writes; no sentiment code; per-crew local storage key; entries hidden until tapped; mission time, not the wall clock.
  - **No ranking:** Block C copy has no rank / top / best / worst / ahead of / behind (plus the gamification words).

## 8. UI guidelines

- Tablet first (1024×768 minimum), dark theme by default, high contrast.
- Status = color **and** icon/text (colorblind safe): ✓ nominal, ▲ caution, ■ warning, ✖ emergency.
- No more than 3 taps to any critical action. Large touch targets (≥ 44 px).
- Charts show limit bands from config and mark every `verified: false` limit as not NASA ("Not a NASA limit · <kind>", built from `source_kind` by `limitMarker`/`notNasaLabel` in `frontend/src/api/limits.ts`).
- Persistent footer: "Decision support only, not a medical diagnosis." followed by the data line "Radiation, space weather and <N> limits: NASA sources. Crew physiology: simulated (no public in-flight astronaut data)." with N counted from `limits.yaml` (Block L), and a "Where our data comes from" panel (`DataSourcesPanel`, also opened from any badge's details). When a non-NASA measured source is active (Block P, after landing), the line names it ("Ground radiation: EPA RadNet … (measured, not NASA)"); when no NASA replay is active it says radiation is simulated.
- Every chart, tile and alert evidence block shows a `DataSourceBadge`: "NASA · MSL/RAD 2012" (measured), "NASA-derived", "Measured · EPA RadNet" (Block P, `MEASURED_OTHER`), "Simulated · NASA-calibrated" or "Simulated" (Block L; was "Synthetic"), "Crew-entered". Tapping it shows the manifest entry (source, retrieved date, transform).
- Block L wording rule: labels say what a value **is**, never only what it is not. Allowed: "Simulated", "Published source", "Clinical guideline", "AEGIS design setting". Not allowed: calling a non-NASA number "verified", hiding a simulation badge, or calling simulated data "measured".
- Block T: show the severity sublabel (LOMO / LOM / LOC) next to CAUTION / WARNING / EMERGENCY. Self-test screens: one task per screen, numbered steps, big Start / Done buttons, the normal band and the "Not a NASA limit · <kind>" marker visible while entering. No gamification.
- Block S (`ROADMAP.md` §0c): the app is organised by role (Crew: Today, My health, Journal; CMO: Crew, Crew member, Radiation; Ground: console). Demo controls live in a closed drawer. Alerts open in one panel from the banner or the header chip (no Alert Center tab). Detail starts folded; one tap opens it. A role switch is a view filter, not access control.
- Journal entries are private by default (Block C): saved on the tablet, never synced to ground; a crew member may share one entry with the onboard CMO after a preview and confirm.

## 9. Definition of done (per task)

- [ ] Matches the PRD section it implements (cite it in the PR/commit, e.g. "PRD §6 M6").
- [ ] No hardcoded thresholds. New limits added to `limits.yaml` with `source_ref` + `verified`.
- [ ] Hazards + HRP risks attached to any new rule, alert or metric.
- [ ] Tests added and `make lint test` passes.
- [ ] Works with the link blacked out (for onboard features).
- [ ] Types: no `any` in TS, type hints on public functions in Python.
- [ ] Any new data source: manifest entry, `provenance` on its values, works with networking blocked.
- [ ] Any limit flipped to `verified: true`: document + revision + clause id in `source_ref`.
- [ ] Any new self-test (Block T): catalog entry in `config/selftests.yaml` (why, steps, limit refs, hazards, HRP risks), results through the observation path, no gamification.

## 10. Build order

Done: setup → simulator (Gate 1) → rules + alerts (Gate 2) → crew UI (Gate 3) → radiation/SPE → ground link (Gate 4) → demo script (D-1, D-2) → Block R (R-0..R-6, Gate R) → D-3 freeze (tag `demo-ready`) → Block P (P-0..P-7, Gate P) → D-4 re-freeze (tag `demo-ready-v2`) → Block T (T-0..T-10, Gate T) → D-5 re-freeze (tag `demo-ready-v3`).

→ Block L (L-1..L-3, approved 2026-11-15) → Block C (C-0..C-5, built 2026-11-15) → Block S (S-1, S-2, S-3, S-5, built 2026-11-15).

**Next:** supervisor review of Block C (Gate C) and Block S; the demo walkthrough uses the Block S screens (CMO view, one switch to Ground; `demo_5min` itself unchanged); no re-freeze unless the user asks (D-6, `demo-ready-v4`). Stretch items (only if the user asks): `arrhythmia` scenario, a second real SPE, Countermeasures view + private journal.
