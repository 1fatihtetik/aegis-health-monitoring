# AEGIS: onboard-first astronaut health monitoring

Hackathon MVP. A crew-side system that watches 4 synthetic astronauts and the cabin, raises explainable
alerts on its own, and syncs to a ground console over a delayed, lossy link (Earth–Mars light time from JPL
Horizons, about 11 min one way on the demo date).

> Decision support only, not a medical diagnosis.
> **Real NASA data (Block R + Block P, approved; demo re-frozen at tag `demo-ready-v2`).** 9 limits verified against NASA-STD-3001
> clauses (R-1), plus water 2.5 L/day, inspired O2 and the 24-h noise dose from Vol 2 Rev F (2026-11-15); cabin radiation in Mars transit, on the Mars surface and during the March 2012 solar particle
> event is replayed from MSL Curiosity RAD measurements (R-2, R-3); the comm delay is the JPL Horizons Earth–Mars
> light time (R-4); the ground console shows the real DONKI/OMNI2 record of that event (R-5); every simulator
> constant cites a source or says "heuristic" (R-6). Crew physiology is simulated and labelled so.

> **Block P (phases and gravity), done.** Measured radiation for LEO, the lunar surface and Earth, physiology
> that responds to each phase's gravity (linear model), an Inspiration4 aggregate blood panel, and the extended demo.

> **Block T (crew self-tests and body map), done; demo re-frozen at tag `demo-ready-v3`.** The crew takes tests and measurements
> themselves on a plain due / done / overdue routine: reaction-time test (PVT-B), guided blood pressure, SpO2,
> temperature, body mass, glucose and intake entries, sleepiness and workload questionnaires (stay on board),
> a 10-minute stand test, an Amsler grid eye check, a SANS (eye/brain) rule and a landing Go / Hold gate.
> Results show on a clickable body map. Values typed by a person are labelled `CREW_ENTERED`. No gamification.
> The demo adds three scripted self-test moments (see the walkthrough below). Plan: `ROADMAP.md` §0.

Specs: `PRD.md` (product), `ROADMAP.md` (scope; Block T is §0), `AGENTS.md` (how to build).
Agent handoff and the API contract: `implementationsandgoals.txt`.

> **Block L (data-honesty labels), built.** Every label says what a value **is**: badges read "Simulated" or
> "Simulated · NASA-calibrated" (not "Synthetic"), and a limit without a NASA clause reads "Not a NASA limit ·
> Published source / Clinical guideline / AEGIS design setting / NASA reference, not a standard" (`source_kind` in
> `config/limits.yaml`; was "⚠ unverified"). The footer's "Where our data comes from" panel explains what is real
> NASA data, what is measured by another agency, what is simulated and why, and counts the limits per kind.
> Wording only: no data, rule, limit value or `verified` flag changed. Plan: `ROADMAP.md` §0a.

## Data: what is real and what is not

| Data | Source | Status |
|---|---|---|
| Limits (CO2, radiation career dose, cabin atmosphere, noise…) | NASA-STD-3001 Vol 1/Vol 2 and OCHMO Technical Briefs, with clause ids (e.g. 1-h ppCO2 <= 3 mmHg, [V2 6004]) | R-1, done (9 limits); 2026-11-15 adds water 2.5 L/day [V2 6109], inspired O2 127/122 mmHg [V2 6003] and the 24-h noise dose [V2 6115] (Vol 2 Rev F); the rest stay `verified: false` and are marked "Not a NASA limit · <kind>" (Block L) |
| Deep-space and Mars-surface radiation, including a real solar particle event | MSL Curiosity RAD measurements (PDS PPI `MSL-M-RAD-3-RDR-V1.0`, SPDF CDAWeb `MSL_RAD_OBS-L2`) | Done: quiet-GCR cruise (2012-04-10..19, mean 449 µGy/day x <Q> 3.82 = 1.72 mSv/day; published 1.84 ± 0.33), Gale crater (2013-03-23..04-01, 211 µGy/day x 3.05 = 0.64 mSv/day; published 0.64 ± 0.12) and the March 7-10, 2012 SPE (peak 672 µGy/h, replayed x20) |
| Space-weather context for that event | NASA CCMC DONKI (SEP, flare, CME records), SPDF OMNIWeb (OMNI2 hourly >10 MeV proton flux) | Done: X5.4 flare, 2200 km/s CME, near-Earth flux peak 4560 pfu (NOAA S3) on the ground console; the ground can forward it to the crew through the delayed link |
| Earth–Mars comm delay | JPL Horizons ephemeris (daily Earth–Mars one-way light time, 2026-08..2027-08) | Done: 657 s at the demo start (2026-11-14 20:00 UTC), changes with the date; 720 s fallback if the file is missing |
| Cabin CO2 | **Simulated, NASA-calibrated**: nominal 2.0 mmHg and degradation peaks 3.7-3.8 mmHg set from OCHMO-TB-004 Rev D | labelled "Simulated · NASA-calibrated" |
| Crew physiology (HR, HRV, SpO2, BP, sleep, exercise) | **Simulated**, heuristic parameters (each listed under `sources` in `config/crew.yaml`). NASA keeps in-flight astronaut vitals restricted for crew privacy, so no public dataset exists | stays simulated, labelled "Simulated" |
| LEO, lunar-surface and post-landing radiation | **Measured (Block P).** LEO: ISS Columbus DOSTEL-1 via NASA OSDR RadLab (Jan 2019), with South Atlantic Anomaly passes flagged so they do not trigger the SPE alarm. Lunar surface: LRO CRaTER, surface-corrected by the CRaTER team (NASA ISWA), checked against Chang'e-4. After landing: EPA RadNet Houston (non-NASA, labelled `MEASURED_OTHER`). | P-1..P-3, done |
| Gravity effects on the body | **Simulated, linear model (P-5, user's pick)**: bone and fitness loss run at (1 - g) x the zero-g rate (animal partial-loading data, Ellman 2013; Mortreux 2018), blood pressure rises g x 8/9 mmHg (Norsk 2015), fainting risk after a landing from Meck 2001. No human data exist at 0.16 g or 0.38 g | P-5, done |
| Inspiration4 blood panels | **Measured, aggregate only (P-6)**: pre/post-flight CBC/CMP mean ± SD per time point from NASA OSDR (OSD-569 CBC, OSD-575 CMP), cells with n < 3 dropped, never one person's values; reference only, never feeds alerts | P-6, done |
| Crew self-test entries | **Block T**: values a person enters in the UI, labelled `CREW_ENTERED`, kept in memory only. Scripted results for the simulated crew stay `SYNTHETIC` (badge "Simulated") | T-0..T-10, done |

NASA files are downloaded once (`python -P scripts/fetch_nasa_data.py rad-cruise` / `rad-surface` / `rad-spe` /
`horizons` / `space-weather`, build time only; `verify` re-checks the hashes) into `data/nasa/` (~2.1 MB),
listed with source URL, date and sha256 in `data/nasa/MANIFEST.yaml`, and replayed offline. The running
system never calls the internet. Every chart and alert shows a badge saying whether a value is NASA-measured,
NASA-derived, measured by another agency (EPA), crew-entered or simulated.

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
| `spe_event` | Solar particle event (MSL/RAD March 2012 replay) | `rad.spe.dose_rate` EMERGENCY, `rad.dose.24h` WARNING |
| `co2_scrubber_degradation` | Cabin CO2 rises from 2.0 to ~3.8 mmHg over hours (TB-004 headache band) | `env.co2.high_1h` CAUTION |
| `insomnia_streak` | C1 sleeps under half of each sleep period for three nights | `sleep.short_24h` CAUTION |
| `orthostatic_intolerance` | Gravity transition, C3 (scripted low fluid log before the landing: landing gate Hold) | `intake.fluid.low` + `sans.watch` CAUTION, `cardio.orthostatic` WARNING |
| `headache_branching` | Same symptoms, different cause | `ctx.headache_tachy.hydration` (C2, CO2 normal), then `ctx.headache_tachy.co2` (C4, CO2 high) |
| `leo_baseline` | ISS day (LEO, 0 g), measured DOSTEL-1 radiation | `rad.saa.transit` INFO per South Atlantic Anomaly pass; no SPE alarm |
| `lunar_surface` | Lunar landing (0 -> 0.16 g), CRaTER surface dose | none (radiation switches to LRO CRaTER, bone loss slows to 84 % of the 0 g rate) |

## Demo walkthrough (`demo_5min`, about 4 min 50 s, plays untouched)

The scenario sets its own speed per segment, scripts a comm blackout and pauses at the end. Times are
simulated offsets from the start. The story: the crew handles everything onboard, without a flight surgeon.
Block T (T-10) adds three self-test moments. They are scripted results for the simulated crew, badged
"Simulated" ("scripted self-test result"), never "Crew-entered".

**Opening line (L-3), say it first:** "Everything you will see is either replayed NASA data or a simulation built
from published parameters, and every number shows which." Then point at the footer's "Where our data comes from".

0. **0 to 30m, 60x, ~30 s. ISS (LEO, 0 g).** A time-compressed phase tour opens the demo (the crew history stays
   in Mars transit). Radiation is the measured ISS DOSTEL-1 replay ("ISS DOSTEL-1 (DLR) 2019", NASA OSDR archive).
   At 0h05m the station crosses the South Atlantic Anomaly: the dose spike raises one INFO notice
   (`rad.saa.transit`) with a short checklist, never the SPE emergency; it clears by itself at 0h28m.
   Comm delay 0 s.
0b. **30m to 50m, 60x, ~20 s. Lunar surface stop (0.16 g).** Radiation switches to the LRO CRaTER surface dose
   (NASA-derived). The Gravity tile shows bone loss at 84 % of the 0 g rate and the fainting risk recorded for the
   0 to 0.16 g step. Comm delay 1.3 s. No alerts.
1. **50m to 1 h, 120x, ~5 s.** Normal evening in Mars transit (0 g, the delay jumps to ~11 min from JPL Horizons).
   Everything is green. Point out the neutron share on the radiation tile.
2. **1 to 19 h, 3600x, ~18 s.** Fast-forward. C1 sleeps badly (`sleep.short_24h` at 5h56m). **Test moment 1:**
   C1 takes the morning reaction-time test (PVT-B) at 7h45m: 7 lapses, mean 395 ms. At 7h46m `cog.pvt.lapses`
   and the compound `cog.performance_risk` (short sleep + PVT-B lapses) fire for C1, and C1's EVA readiness drops
   to NO-GO. Then cabin CO2 creeps up: `env.co2.high_1h` at 17h26m becomes a second piece of evidence.
3. **19 to 20 h, 60x, ~1 min.** Open the alerts: every member shows value, limit, window and the
   "Not a NASA limit · <kind>" marker where no NASA clause applies, plus a plain-language checklist. At 19h16m C2 reports a headache with a raised heart rate:
   `ctx.headache_tachy.co2` says the cabin CO2 is the likely cause (with normal CO2 the same symptoms would
   point to hydration, see `headache_branching`).
4. **20 to 21h20m, 60x, ~80 s.** Solar particle event: the real MSL/RAD March 2012 measurement, replayed x20.
   Full-screen EMERGENCY at 20h09m, with the RAD replay line, shelter checklist, headcount and dose counter.
   The ground console sees it at 20h20m (one light time, ~11 simulated minutes), with "Data as of T-Xm Ys",
   the one-way delay "(JPL Horizons, 2026-11-14)" and the space-weather card (DONKI flare/CME/SEP, OMNI2
   flux with a marker at the replayed time). Forward the space-weather brief or send a recommendation before
   ~20h33m; it arrives onboard one light time later. At 20h45m the link blacks out (scripted): the crew UI
   keeps working and the ground's data age grows until the link returns at 21h20m. `rad.dose.24h` WARNINGs
   fire onboard at 21h16m (during the blackout) and reach the ground at 21h27m.
5. **21h20m to 23h20m, 3600x, ~2 s.** Fast-forward. **Test moment 2:** at 22h C3 logs only 1200 mL of fluid
   (target 2000 mL): `intake.fluid.low` and the SANS watch (`sans.watch`, months in 0 g + low fluid) open for C3
   at 22h01m.
5b. **23h20m to 23h30m, 60x, ~10 s.** Before touchdown, open the Self-tests tab: the landing gate shows C3 on
   ▲ HOLD (lowest score, with the fluid action and a Simulated badge on the scripted fluid log). The rest of the
   crew is also on Hold, because the SPE's `rad.dose.24h` WARNING lowers every score by 20.
6. **23h30m to 24h30m, 60x, ~1 min.** Mars landing (0 to 0.38 g). `cardio.orthostatic` WARNING for C3 at 23h45m.
   **Test moment 3:** C3's 10-minute stand test ends at 23h45m (top number falls 26 mmHg, pulse up 34 bpm):
   `cardio.stand.positive` CAUTION at 23h46m. Tap C3's Heart & vessels region on the body map: both alerts, the
   stand-test readings and the Start button for the next test.
   Optional live moment (the script does not wait): a presenter takes the 30-second reaction test
   (`pvt_b_short`, labelled "Demo length, not the 3-minute protocol") or the Amsler grid on any crew member;
   those values are badged "Crew-entered" and stay in memory only.
   Close on the long-term trends (BMD, body mass, VO2max proxy, exercise adherence over ~140 days).
   The simulation pauses at 24h30m.

## Layout

```text
backend/app/   FastAPI app, simulator, rules engine, alerts, scores, link, in-memory stores
backend/tests/ pytest: rule types, scenarios, link delay/blackout, API
config/        limits, rules, mission, crew, readiness, datasets (every limit has source_ref + verified);
               Block T adds selftests (test catalog + schedule + body-map regions)
frontend/      React + TS + Vite + Tailwind UI
data/nasa/     (Block R) bundled NASA snapshots + MANIFEST.yaml
scripts/       (Block R) fetch_nasa_data.py, build time only
```
