# AEGIS: onboard-first astronaut health monitoring

Hackathon MVP. A crew-side system that watches 4 synthetic astronauts and the cabin, raises explainable
alerts on its own, and syncs to a ground console over a delayed, lossy link (12 min one way in Mars transit).

> Decision support only, not a medical diagnosis. All data is synthetic. Most limits are placeholders
> (`verified: false` in `config/limits.yaml`); the UI marks them as unverified.

Specs: `PRD.md` (product), `ROADMAP.md` (30-hour scope), `AGENTS.md` (how to build).
Agent handoff and the API contract: `implementationsandgoals.txt`.

## Run it

Needs Python 3.11+ and Node 18+.

```bash
pip install -r backend/requirements.txt
cd frontend && npm install
```

Two terminals (or `make dev` where `make` exists):

```bash
cd backend && python -m uvicorn app.main:app --port 8000
```

```bash
cd frontend && npm run dev
```

- UI: http://localhost:5173 (Vite proxies `/api` and `/ws` to the backend)
- API docs: http://localhost:8000/docs
- Live stream: `ws://localhost:8000/ws/live?node=onboard|ground`

The backend starts the `nominal` scenario at 60x (one simulated minute per real second).
If port 8000 is busy, run the backend on another port and tell Vite: `AEGIS_BACKEND_PORT=8010 npm run dev`.

## Checks

```bash
cd backend && python -m ruff check . && python -m pytest -q
```

```bash
cd frontend && npx tsc --noEmit && npx vitest run
```

## Scenarios

Start one from the Scenario Dock, or with `POST /api/v1/sim/scenario {"name": "...", "seed": 42}`.
The same scenario and seed always produce the same alerts.

| Scenario | What happens | Expected alerts |
|---|---|---|
| `nominal` | Normal mission day | none |
| `demo_5min` | The scripted demo below | see below |
| `spe_event` | Solar particle event | `rad.spe.dose_rate` EMERGENCY, `rad.dose.24h` WARNING |
| `co2_scrubber_degradation` | Cabin CO2 rises for hours | `env.co2.high_1h` CAUTION |
| `insomnia_streak` | C1 sleeps under half of each sleep period for three nights | `sleep.short_24h` CAUTION |
| `orthostatic_intolerance` | Gravity transition, C3 | `cardio.orthostatic` WARNING |
| `headache_branching` | Same symptoms, different cause | `ctx.headache_tachy.hydration` (C2, CO2 normal), then `ctx.headache_tachy.co2` (C4, CO2 high) |

## Demo walkthrough (`demo_5min`, about 4 minutes, plays untouched)

The scenario sets its own speed per segment, scripts a comm blackout and pauses at the end. Times are
simulated offsets from the start. The story: the crew handles everything onboard, without a flight surgeon.

1. **0 to 1 h, 120x, ~30 s.** Normal evening in Mars transit (0 g, 12-min delay). Everything is green.
   Point out the neutron share on the radiation tile.
2. **1 to 19 h, 3600x, ~18 s.** Fast-forward. C1 sleeps badly (`sleep.short_24h` at 5h56m), then cabin CO2
   creeps up. At 17h26m `env.co2.high_1h` and the compound `cog.performance_risk` fire for C1, and C1's EVA
   readiness drops to NO-GO.
3. **19 to 20 h, 60x, ~1 min.** Open the alerts: every member shows value, limit, window and the unverified
   marker, plus a plain-language checklist. At 19h16m C2 reports a headache with a raised heart rate:
   `ctx.headache_tachy.co2` says the cabin CO2 is the likely cause (with normal CO2 the same symptoms would
   point to hydration, see `headache_branching`).
4. **20 to 21h10m, 60x, ~70 s.** Solar particle event at 20h03m: full-screen EMERGENCY, shelter checklist,
   headcount, dose counter. The ground console sees it 12 simulated minutes (~12 real seconds) later, with
   "Data as of T-Xm Ys". Send a recommendation from the ground before ~20h33m; it arrives onboard 12 minutes
   later. `rad.dose.24h` WARNINGs fire onboard at 20h37m for all crew. At 20h45m the link blacks out
   (scripted): the crew UI keeps working, the ground's data age grows, and the WARNINGs (due on the ground at
   20h49m) arrive only after the link returns at 21h10m.
5. **21h10m to 23h30m, 3600x, ~2 s.** Fast-forward.
6. **23h30m to 24h30m, 60x, ~1 min.** Mars landing (0 to 0.38 g). `cardio.orthostatic` WARNING for C3 at 23h45m.
   Close on the long-term trends (BMD, body mass, VO2max proxy, exercise adherence over ~140 days).
   The simulation pauses at 24h30m.

## Layout

```text
backend/app/   FastAPI app, simulator, rules engine, alerts, scores, link, in-memory stores
backend/tests/ pytest: rule types, scenarios, link delay/blackout, API
config/        limits, rules, mission, crew, readiness (every limit has source_ref + verified)
frontend/      React + TS + Vite + Tailwind UI
```
