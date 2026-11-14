# AGENTS.md: instructions for coding agents

This repo builds **AEGIS**, an onboard-first astronaut health monitoring system (hackathon MVP).
**Read `PRD.md` first.** It is the source of truth for scope, the domain model and the APIs. This file tells you *how* to build it.
**Then read `ROADMAP.md`.** It sets the scope, the build order and the cut list. Where the PRD describes more than the roadmap, build the roadmap version.

> **Current priority (2026-11-14): Block R, real NASA data** (`ROADMAP.md` §0, PRD §1.8 and §6 M0). Do Block R before the freeze and before any stretch item. §2a below covers how to handle real data.

---

## 1. Ground rules

1. **Autonomy first.** Onboard features must never depend on the ground node or on the internet at runtime. If the link is blacked out or the ground side is broken, the crew app must still work fully.
2. **No hardcoded medical limits.** Every threshold comes from `config/limits.yaml` and carries `source_ref` + `verified`. Never present an unverified number as a NASA value. The UI must show an "unverified" marker for `verified: false`.
3. **Traceability.** Every rule, alert and score must carry `hazards[]` (RIDGE enum) and `hrp_risks[]` (`HRP-01`…`HRP-17`, see PRD §7.2). PRs that add a rule without these fields are incomplete.
4. **Explainability.** An alert payload must include its evidence (signal refs + values + limit + window). No black-box scores.
5. **Real NASA data where it exists; honest labels everywhere.** Radiation, space weather, comm delay and limits come from bundled NASA snapshots (§2a). Crew physiology is synthetic, because no public in-flight astronaut vitals exist, and its parameters are cited. Every value carries `provenance`. Never add an identifiable person's health data, and never present a synthetic value as measured.
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
    link/           store-and-forward delay queue, priority, blackout; the ground store
    db/             in-memory ring buffers per signal (1-min resolution)
    datasets/       (Block R) manifest + sha256 check, replay adapters: rad.py (MSL/RAD),
                    donki.py, omni.py, horizons.py; pure functions of (dataset, offset, seed)
  tests/
data/nasa/          (Block R) bundled NASA snapshots, read-only, checked in
  MANIFEST.yaml     one entry per file: id, tier, source_url, retrieved, sha256, terms, transform
  raw/              files exactly as downloaded (untrusted input; parse with python -P (keeps the script dir off sys.path), never execute)
  derived/          small normalized CSV/JSON produced by the fetch script from raw/
scripts/
  fetch_nasa_data.py  build-time only: downloads, normalizes, writes MANIFEST.yaml
frontend/           React + TS + Vite + Tailwind + TanStack Query + uPlot/Recharts (implemented by Claude)
  src/
    views/          CrewOverview (includes RIDGE tiles; Environment is the Hostile-Env
                    drill-down), CrewDetail, Radiation, AlertCenter, GroundConsole
    components/     StatusRing, Sparkline, LimitBandChart, AlertBanner, EmergencyTakeover,
                    ScenarioDock, AlertChecklist, EvidenceDetails, HeadacheReport, LimitBadge
    api/            hand-written typed client + WebSocket hook; limits.ts bundles config/limits.yaml
                    for the offline fallback (GET /api/v1/limits replaces it when connected)
config/
  limits.yaml       all thresholds (PRD §9)
  rules.yaml        rule definitions
  mission.yaml      phases, gravity, comm delay, simulator parameters
  crew.yaml         4 synthetic crew + baselines
  readiness.yaml    readiness score components, weights, alert penalties
  datasets.yaml     (Block R) which dataset feeds which signal/phase/scenario, time windows, compression
Makefile            dev, test, lint, demo
implementationsandgoals.txt   handoff: Claude implements, Antigravity supervises; work queue, review findings, API contract
```

Not in scope (do not build unless `ROADMAP.md` §5 is reached): docker compose, a second backend process, the TREND rule type, Countermeasures and Wellbeing views, research export, rules editor, generated API client, Playwright.

Keep this layout unless there is a strong reason to change it. If you change it, update this file.

## 2a. Real NASA data (Block R)

| Tier | Dataset | Feeds | Provenance |
|---|---|---|---|
| D1 | NASA-STD-3001 Vol 1/Vol 2, OCHMO Technical Briefs | `config/limits.yaml` (`verified: true` + clause id) | n/a (limits) |
| D2 | MSL/RAD dose rates (PDS PPI `MSL-M-RAD-3-RDR-V1.0` or CDAWeb `MSL_RAD_OBS-L2`) | area `dose_rate_absorbed`, `dose_rate_equivalent` in `MARS_TRANSIT`/`MARS_SURFACE`; the SPE in `spe_event` and `demo_5min` | `NASA_MEASURED` (area); `NASA_DERIVED` (personal dose, neutron split, shelter factor) |
| D3 | DONKI SEP/FLR/CME records; OMNIWeb OMNI2 hourly >10 MeV proton flux | event metadata in SPE alert evidence; ground space-weather card | `NASA_MEASURED` |
| D4 | JPL Horizons Earth→Mars range | `link/` one-way delay by date | `NASA_DERIVED` (range ÷ c) |
| D5 | HRP pages, OCHMO TB-004, OSDR Inspiration4 (OSD-569/570/571/575, aggregate only) | simulator constants in `mission.yaml`/`crew.yaml` | `SYNTHETIC_CALIBRATED` |

Rules:
- **Provenance enum:** `NASA_MEASURED` (a replayed value from a NASA archive), `NASA_DERIVED` (computed from NASA data by a formula named in the manifest), `SYNTHETIC_CALIBRATED` (simulated; parameters cite a NASA source), `SYNTHETIC` (simulated; heuristic parameters).
- **Replay through the same path.** Replay adapters emit `Observation`s into the same tick → store → rules path as the simulator. The engine does not know or care where a value came from; the UI does.
- **Time mapping.** `config/datasets.yaml` maps the simulated clock onto a dataset window (start, compression factor, loop or hold). Mapping is deterministic. If compression is used, label it in the UI ("2012-03-07 event, replayed ×N").
- **Gaps.** RAD data has gaps. Fill only by holding the last value for a time set in `datasets.yaml`, then mark points `quality: SUSPECT`. Never interpolate across a gap silently.
- **Startup check.** On startup, verify every file in `datasets.yaml` exists in `MANIFEST.yaml` with a matching sha256. On failure, log it clearly and fall back to the synthetic generator for that signal with `provenance: SYNTHETIC`. Never crash the crew app over a missing dataset.
- **Size.** Bundle windows, not whole archives (target < 20 MB in `data/nasa/`).
- **Limits.** `verified: true` requires a `source_ref` that names a document, revision and clause id (e.g. `"NASA-STD-3001 Vol 2 Rev D [V2 6004], via OCHMO TB-004"`). A brief that restates the standard is fine as the pointer, but name the clause.
- **Never** fetch at runtime, commit an API key (DONKI via api.nasa.gov needs one; use `DEMO_KEY` or an env var in the fetch script only), or bundle per-person OSDR records.

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
- `provenance` and `dataset_id` are added in R-0. Replayed RAD values look like `"provenance": "NASA_MEASURED", "dataset_id": "msl_rad_cruise_2012"`.
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

The simulator now fills only the signals that no public NASA dataset covers (§2a). In Block R, radiation in `MARS_TRANSIT`/`MARS_SURFACE` and the SPE move to RAD replay, and each remaining simulator constant gets a `source_ref` or the word "heuristic".

- 4 crew (`C1`–`C4`, roles CDR/CMO/MS/PS), each with an individual baseline from `crew.yaml`.
- Circadian patterns: HR and temperature rhythms, sleep blocks, two exercise sessions a day.
- Phase-dependent parameters (gravity 0 / 0.16 / 0.38 / 1 g; comm delay; radiation background).
- Slow drifts: BMD −1 to −1.5% per month in 0 g, scaled down by exercise adherence. Cumulative dose integration.
- Radiation stream split into total and **neutron** components (neutrons ≈ 30% in LEO per CSA).
- The simulator feeds the engine in-process on each simulated tick. `POST /api/v1/observations` exists and uses the same code path, but the simulator does not go through HTTP.
- Scenarios in `backend/app/sim/scenarios/*.yaml`: `demo_5min`, `spe_event`, `co2_scrubber_degradation`, `insomnia_streak`, `orthostatic_intolerance`. Deferred: `arrhythmia`, `eva`, `infection`.
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

## 8. UI guidelines

- Tablet first (1024×768 minimum), dark theme by default, high contrast.
- Status = color **and** icon/text (colorblind safe): ✓ nominal, ▲ caution, ■ warning, ✖ emergency.
- No more than 3 taps to any critical action. Large touch targets (≥ 44 px).
- Charts show limit bands from config and mark unverified limits.
- Persistent footer: "Decision support only, not a medical diagnosis." followed by the data line. After R-0 the data line reads "Radiation, space weather and limits: NASA sources. Crew physiology: synthetic."
- Every chart, tile and alert evidence block shows a `DataSourceBadge`: "NASA · MSL/RAD 2012" (measured), "NASA-derived", "Synthetic (NASA-calibrated)" or "Synthetic". Tapping it shows the manifest entry (source, retrieved date, transform).
- Journal entries are private by default. Never sync them to ground unless the user opts in.

## 9. Definition of done (per task)

- [ ] Matches the PRD section it implements (cite it in the PR/commit, e.g. "PRD §6 M6").
- [ ] No hardcoded thresholds. New limits added to `limits.yaml` with `source_ref` + `verified`.
- [ ] Hazards + HRP risks attached to any new rule, alert or metric.
- [ ] Tests added and `make lint test` passes.
- [ ] Works with the link blacked out (for onboard features).
- [ ] Types: no `any` in TS, type hints on public functions in Python.
- [ ] Any new data source: manifest entry, `provenance` on its values, works with networking blocked.
- [ ] Any limit flipped to `verified: true`: document + revision + clause id in `source_ref`.

## 10. Build order

Done: setup → simulator (Gate 1) → rules + alerts (Gate 2) → crew UI (Gate 3) → radiation/SPE → ground link (Gate 4) → demo script (D-1, D-2).

**Now:** Block R (`ROADMAP.md` §0.3, mirrored in PRD §13): R-0 data layer → R-1 verified limits → R-2 RAD replay → R-3 real SPE → R-4 light-time delay → R-5 space-weather card → R-6 calibration + re-rehearsal → **Gate R** → D-3 freeze. R-0 comes first because every later item needs `provenance` and the manifest check. If behind, cut in the order given in `ROADMAP.md` §0.4.
