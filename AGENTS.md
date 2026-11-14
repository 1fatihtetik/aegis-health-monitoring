# AGENTS.md: instructions for coding agents

This repo builds **AEGIS**, an onboard-first astronaut health monitoring system (hackathon MVP).
**Read `PRD.md` first.** It is the source of truth for scope, the domain model and the APIs. This file tells you *how* to build it.
**Then read `ROADMAP.md`.** It sets the 30-hour scope, the build order and the cut list. Where the PRD describes more than the roadmap, build the roadmap version.

---

## 1. Ground rules

1. **Autonomy first.** Onboard features must never depend on the ground node or on the internet at runtime. If the link is blacked out or the ground side is broken, the crew app must still work fully.
2. **No hardcoded medical limits.** Every threshold comes from `config/limits.yaml` and carries `source_ref` + `verified`. Never present an unverified number as a NASA value. The UI must show an "unverified" marker for `verified: false`.
3. **Traceability.** Every rule, alert and score must carry `hazards[]` (RIDGE enum) and `hrp_risks[]` (`HRP-01`…`HRP-17`, see PRD §7.2). PRs that add a rule without these fields are incomplete.
4. **Explainability.** An alert payload must include its evidence (signal refs + values + limit + window). No black-box scores.
5. **Synthetic data only.** Never add real personal or health data. The simulator is the only data source.
6. **Decision support, not a diagnosis.** Never write UI copy that diagnoses ("You have X"). Use "Indicators consistent with… / Recommend CMO review".
7. **Determinism.** The simulator and tests use seeded RNG. A scenario + seed must always produce the same alerts.

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
  tests/
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
Makefile            dev, test, lint, demo
implementaionsandgoals.txt   handoff: Claude implements, Antigravity supervises; work queue, review findings, API contract
```

Not in the 30-hour scope (do not build unless `ROADMAP.md` §5 is reached): docker compose, a second backend process, the TREND rule type, Countermeasures and Wellbeing views, research export, rules editor, generated API client, Playwright.

Keep this layout unless there is a strong reason to change it. If you change it, update this file.

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
  "quality": "GOOD", "phase": "MARS_TRANSIT" }
```
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
  "evidence": { "signal": "ppco2", "value": 3.6, "limit": 3.0, "limit_verified": false, "window": "1h" },
  "action": "...", "origin": "ONBOARD" }
```

### Severity
`INFO < CAUTION < WARNING < EMERGENCY`. These map to the NASA Standards Hierarchy Pyramid (PRD §7.4). Only `EMERGENCY` may take over the full screen.

## 5. Simulator requirements (high priority, the demo depends on it)

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

## 8. UI guidelines

- Tablet first (1024×768 minimum), dark theme by default, high contrast.
- Status = color **and** icon/text (colorblind safe): ✓ nominal, ▲ caution, ■ warning, ✖ emergency.
- No more than 3 taps to any critical action. Large touch targets (≥ 44 px).
- Charts show limit bands from config and mark unverified limits.
- Persistent footer: "Decision support only, not a medical diagnosis. Synthetic data."
- Journal entries are private by default. Never sync them to ground unless the user opts in.

## 9. Definition of done (per task)

- [ ] Matches the PRD section it implements (cite it in the PR/commit, e.g. "PRD §6 M6").
- [ ] No hardcoded thresholds. New limits added to `limits.yaml` with `source_ref` + `verified`.
- [ ] Hazards + HRP risks attached to any new rule, alert or metric.
- [ ] Tests added and `make lint test` passes.
- [ ] Works with the link blacked out (for onboard features).
- [ ] Types: no `any` in TS, type hints on public functions in Python.

## 10. Build order

Follow `ROADMAP.md` §3 (mirrored in PRD §13): setup → simulator (Gate 1) → rules + alerts (Gate 2) → crew UI (Gate 3) → radiation/SPE → ground link (Gate 4) → compound rule + EVA readiness + demo script → freeze. Don't start a block before the previous gate passes, and don't start UI work before Gate 2 shows alerts over the WebSocket. If behind, cut in the order given in `ROADMAP.md` §4.
