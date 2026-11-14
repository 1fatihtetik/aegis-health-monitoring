# AEGIS: roadmap

Assumes one person plus coding agents. Hours are offsets from the start of each block.

**Current state (2026-11-14):** the original 30-hour MVP is built. Gates 1–4, D-1 and D-2 are approved (see `implementationsandgoals.txt`).
**Current priority: Block R, real NASA data (§0).** It comes before the freeze (D-3) and before every stretch item. A health monitor that only shows numbers it invented proves nothing. Block R replaces invented numbers with NASA-published measurements and NASA-published limits wherever a public source exists, and labels everything else honestly.

---

## 0. Block R: real NASA data (PRIORITY 1)

### 0.1 What "real data" can and cannot mean

There is **no public archive of continuous in-flight astronaut vitals** (heart rate, SpO₂, sleep and so on for named ISS crew). That data sits in NASA's LSDA/LSAH under controlled access. AEGIS will not pretend otherwise. Real NASA data enters in four places where it is public, and the crew physiology stays synthetic but is tuned to published NASA values:

| Tier | What | NASA source (public) | Replaces |
|---|---|---|---|
| **D1 Limits** | Numeric limits with clause ids | NASA-STD-3001 Vol 1 / Vol 2 and OCHMO Technical Briefs (e.g. TB-004 Carbon Dioxide: 1-h mean ppCO₂ ≤ 3 mmHg, [V2 6004]; Radiation Protection brief: career effective dose 600 mSv, [V1 4030]) | `verified: false` placeholders in `config/limits.yaml` |
| **D2 Radiation replay** | Measured deep-space and Mars-surface dose rates, including solar particle events seen in cruise | MSL Curiosity **RAD** (Radiation Assessment Detector): PDS PPI `MSL-M-RAD-3-RDR-V1.0`, and SPDF/CDAWeb `MSL_RAD_OBS-L2` | The constant 75 µSv/h (`MARS_TRANSIT`) and 28 µSv/h (`MARS_SURFACE`) backgrounds and the synthetic ×80 SPE curve |
| **D3 Space weather context** | The real event behind the SPE: SEP, flare and CME records, plus the near-Earth >10 MeV proton flux | NASA CCMC **DONKI** (SEP/FLR/CME records), NASA SPDF **OMNIWeb** (OMNI2 hourly proton flux, GOES-sourced) | A made-up event with no history |
| **D4 Comm delay** | Earth–Mars one-way light time for the simulated date | NASA JPL **Horizons** ephemeris (Earth→Mars range ÷ c) | The constant `comm_delay_s: 720` |
| **D5 Calibration references** (no live stream) | Published NASA values used to set simulator parameters | HRP hazard pages (BMD −1 to −1.5 %/month, already used), OCHMO TB-004 (historical ISS CO₂ range and the CO₂–headache relationship), Inspiration4 clinical panels on NASA **OSDR** (OSD-569/570/571/575, aggregate only) | Unsourced simulator constants |

Physiology (HR, HRV, SpO₂, BP, sleep, exercise) stays `SYNTHETIC_CALIBRATED`, which means simulated with each parameter cited. That is the honest limit of public data, and the UI says so.

### 0.2 Hard rules for Block R

1. **Fetch once, replay offline.** `scripts/fetch_nasa_data.py` downloads snapshots at build time into `data/nasa/`. The runtime never calls the internet. A test blocks sockets and runs `demo_5min`.
2. **Provenance on every value.** Each observation carries `provenance`: `NASA_MEASURED` | `NASA_DERIVED` | `SYNTHETIC_CALIBRATED` | `SYNTHETIC`. Charts, tiles and alert evidence show it.
3. **Manifest for every file.** `data/nasa/MANIFEST.yaml` lists the dataset id, source URL, retrieval date, sha256, licence or terms note, and the transform applied. No file without a manifest entry.
4. **Determinism stays.** Replay is a pure function of (dataset, time offset, seed). Noise added for per-crew variation is seeded and documented.
5. **No identifiable person's health data.** OSDR Inspiration4 data is used only as aggregate reference ranges, never as a named crew member's record.
6. **Transforms are labelled.** Anything that is not a straight replay (spreading one area dose rate across 4 crew, the shelter factor, the 30 % neutron split, time compression) is `NASA_DERIVED` or `SYNTHETIC_CALIBRATED` and names its formula in the manifest.

### 0.3 Work items and timeline (≈ 12 h)

| Hours | Item | Done when |
|---|---|---|
| R+0 to 2 | **R-0 Data layer.** `data/nasa/` + `MANIFEST.yaml`, `config/datasets.yaml`, `backend/app/datasets/` (loader interface, manifest check, sha256 check), `provenance` field on `Observation`, `GET /api/v1/datasets`, a `DataSourceBadge` component, and the footer text changed to "…Radiation and space-weather data: NASA archives. Crew physiology: synthetic." | Badge renders; missing or tampered file fails startup with a clear message; no-network test passes |
| R+2 to 4 | **R-1 Verified limits (D1).** Pull NASA-STD-3001 Vol 1 Rev C/Vol 2 Rev D clauses and the OCHMO briefs; set `verified: true` with clause ids for every limit that has a NASA number (start: ppCO₂ 1 h, career dose, the other radiation limits in the brief, ppO₂, temperature, humidity, noise). Heuristic limits stay `verified: false` and say "Project heuristic" | At least 6 limits verified with clause ids; the demo shows both marker states; a test checks that `verified: true` implies a clause id in `source_ref` |
| R+4 to 7 | **R-2 RAD replay (D2).** Fetch the RAD dose-rate product for one cruise window and one Gale-crater window; `RadReplayAdapter` feeds `dose_rate_absorbed`/`dose_rate_equivalent` as `NASA_MEASURED` (area dosimeter) for `MARS_TRANSIT`/`MARS_SURFACE`; per-crew personal dose stays `NASA_DERIVED` | Mean replayed cruise dose-equivalent matches the published ≈ 1.8 mSv/day within the noise stated in the manifest; the radiation view shows "MSL/RAD, cruise 2012" |
| R+7 to 9 | **R-3 Real SPE (D2 + D3).** Pick an SEP that RAD measured in cruise (candidate: early March 2012; confirm in the data); `spe_event` and the SPE segment of `demo_5min` replay it, time-compressed and labelled. Retune `rad.spe.dose_rate` and `rad.dose.24h` only through `limits.yaml` | `spe_event` still raises EMERGENCY + WARNING in pytest, driven by replayed values; the evidence shows the real event date and DONKI id |
| R+9 to 10 | **R-4 Light-time delay (D4).** Horizons table (daily Earth–Mars range for the mission window) → `comm_delay_s` by date in `link/`; demo keeps a fixed date so timing stays rehearsable | Ground console shows "One-way delay 12m 34s (JPL Horizons, <date>)" style text; link tests pass with the table |
| R+10 to 11 | **R-5 Space-weather card (D3).** Bundled DONKI SEP/FLR/CME records + OMNI2 >10 MeV flux for the replayed event; the ground console shows the event card, and the ground can forward it to the crew as a recommendation through the delayed link | Card renders offline; forwarding goes through `link/` |
| R+11 to 12 | **R-6 Calibrated simulator (D5) + re-rehearse.** Every simulator constant in `mission.yaml`/`crew.yaml` gets a `source_ref` or is marked heuristic; CO₂ nominal and degradation levels set from TB-004; rerun D-1/D-2 on the new data | `demo_5min` plays twice untouched; README scenario table updated |

**Gate R (supervisor):** radiation and SPE in `demo_5min` are replayed NASA measurements; ≥ 6 limits verified with clause ids; provenance visible on every chart and on alert evidence; the full demo runs with networking blocked; `make lint test` passes. Only after Gate R: D-3 freeze.

### 0.4 If Block R runs behind

Cut in this order, top first: R-5 space-weather card → R-4 light-time (keep 720 s, note it as a Horizons-typical value) → R-6 calibration of physiology constants (keep CO₂). **Never cut:** R-0 provenance, R-1 verified limits, R-2/R-3 RAD replay. Those three are the whole point of the block.

---

## 1. Decisions

1. **AEGIS (`PRD.md` + `AGENTS.md`) is the spec.** The ASTRA-MED documents describe a different product. Keep them out of the build.
2. **Real NASA data first (2026-11-14).** Block R outranks the freeze and every stretch item. Earlier decision 3 ("leave out live DONKI/OSDR APIs") still holds for *live runtime calls*: DONKI, OSDR, CDAWeb, PDS and Horizons are used only as **bundled snapshots**.
3. **What to take from ASTRA-MED:** the one-click scenario dock, the "same symptom, different cause" compound rule, the reaction-time self-test as a stretch item.
4. **Leave out:** local LLMs, River, NeuroKit2, Dexie, live network APIs, the body map, the gamified mode, signed packets.
5. **Do not copy unverified threshold tables.** A number becomes `verified: true` only with a NASA document and clause id that someone actually read.
6. **The demo is the product.** The story is now: *real deep-space radiation, measured by NASA's RAD on the way to Mars, replayed into a crew that handles a real solar particle event on its own, while the ground sees it one light-time later.*

## 2. Architecture (as built, plus Block R)

| Topic | Built version | Block R addition |
|---|---|---|
| Processes | One FastAPI process with `onboard` and `ground` stores; ground written only by `link/` | unchanged |
| Data sources | Seeded simulator in-process | `datasets/` replay adapters feed the same tick path; simulator fills the signals no public dataset covers |
| Storage | In-memory ring buffers (1-min) + ~140 d daily trends | Bundled files in `data/nasa/` (read-only, checked in, small: target < 20 MB) |
| Rules | THRESHOLD, BASELINE, CUMULATIVE, COMPOUND | unchanged; limits now carry NASA clause ids where verified |
| UI | 5 views, offline fallback | `DataSourceBadge` on charts/tiles/evidence; ground space-weather card |

## 3. Original 30-hour timeline (complete)

| Hours | Block | Status |
|---|---|---|
| T+0 to 1 | Setup | done |
| T+1 to 5 | Simulator, **Gate 1** | approved |
| T+5 to 9 | Rules and alerts, **Gate 2** | approved |
| T+9 to 14 | Crew UI, **Gate 3** | approved |
| T+19 to 22 | Radiation and SPE | done |
| T+22 to 25 | Ground link, **Gate 4** | approved |
| T+25 to 27 | Demo script (D-1, D-2) | approved |
| T+27 to 30 | Freeze (D-3) | **moved after Gate R** |

## 4. If behind schedule (original MVP cut list)

Already built, so this applies only to regressions: landing orthostatic scenario → BASELINE rule → recommendation round trip → CrewDetail charts → EVA readiness. Never cut: the SPE emergency flow, the delayed ground view, alert evidence, unverified-limit markers, provenance badges, the freeze block.

## 5. If ahead of schedule (after Gate R)

1. 30-second reaction-time test feeding COGNITIVE readiness (S-2)
2. `arrhythmia` scenario (S-3)
3. Inspiration4 reference panel: pre/post-flight CBC/CMP aggregate ranges from OSDR beside the crew's synthetic labs (D5 as a view)
4. A second real SPE (a larger event) as an extra scenario

## 6. Open items

- Submission deadline and format: still to confirm; they set the length of the freeze block.
- Confirm which NASA-STD-3001 revision is current for each clause (the briefs cite Vol 1 Rev B/C and Vol 2 Rev C/D).
- Confirm the RAD product and time window (PDS RDR vs. CDAWeb L2) and that the chosen SEP is in the cruise data.
- The real SPE dose rate will not match the synthetic ×80 curve. The SPE and 24-h limits are heuristics, so retune them in `limits.yaml` (still `verified: false`) and record why.
