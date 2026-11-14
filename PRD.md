# PRD — AEGIS: Autonomous Exploration Guardian for Integrated crew health & Safety

> Working title. Rename freely.
> Status: Draft v1.1 · 2026-11-14 · Audience: product team + coding agents (see `AGENTS.md`)
> **v1.1 change: real NASA data is now priority 1** (§1.8, §6 M0, `ROADMAP.md` §0). The MVP replays NASA-measured radiation, space-weather and ephemeris data and uses NASA-STD-3001 limits with clause ids. Crew physiology stays synthetic, because no public in-flight astronaut vitals exist, and it is labelled as synthetic.

---

## 0. TL;DR

AEGIS is an **onboard-first crew health monitoring system** for long-duration and deep-space missions (ISS → Artemis/Moon → Mars). It fuses data from wearables, medical devices, radiation dosimeters and cabin environment sensors, maps every signal to NASA's **5 spaceflight hazards** and **17 Human Research Program (HRP) risks**, and gives the crew and their **onboard medical officer** actionable alerts **without needing Earth**, because at Mars a one-way message can take up to 20 minutes. Ground teams get a delayed, synchronized copy for flight-surgeon review and research.

The hackathon MVP is a web app driven by **real NASA data where it is public**: deep-space and Mars-surface dose rates measured by MSL/RAD (including a real solar particle event), DONKI space-weather records, JPL Horizons light-time delay and NASA-STD-3001 limits. A **NASA-calibrated simulator** fills in the crew physiology that NASA does not publish. Around that data it adds a **rules + trend engine**, a **crew dashboard**, a **ground (flight surgeon) dashboard** with configurable comm delay, and a **radiation module** inspired by the CSA's CANS neutron spectrometer.

---

## 1. Source research summary

§1.1–§1.7 come from the six pages supplied (plus linked sub-pages the research followed). §1.8 lists the public NASA datasets added in v1.1. Facts are paraphrased. Where the sources give **no numbers**, this PRD says so, and thresholds must be configurable (see §9).

### 1.1 NASA OCHMO — Human Spaceflight & Aviation Standards
- **NASA-STD-3001**, the Spaceflight Human-System Standard:
  - **Vol 1, Crew Health** (Rev C, Nov 2023): requirements to support astronaut health and medical care.
  - **Vol 2, Human Factors, Habitability & Environmental Health**: vehicle design and operations requirements for crew safety and performance.
- Aerospace Medical Certification Standard (crew health, safety, "occupational longevity"); Aviation Medical Certification Standards; Human Integration Design Handbook; Human Rating Guidance.
- **Standards Hierarchy Pyramid**: rates how standards affect *loss of crew*, *loss of mission* and *loss of mission objectives*. We reuse this as our **alert severity model** (§7.4).
- Technical Brief categories: Fundamentals of Human Health in Spaceflight; Medical Operations & Clinical Care; Vehicle Systems/Environmental Design; Safety/Contingency/Mishaps.
- Related tools: **Integrated Medical Model** (LEO, Lunar, Mars, Deep Space runs), in-flight medical care, Vehicle Acceleration Limits Library, Decompression Sickness Prebreathe Library, **VTE (venous thromboembolism) risk score algorithm**, **Martian dust exposure limits**, CHAPEA Mission 2 (378 days of simulated Mars).
- ⚠️ The page lists **no numeric limits**. The limits are in the STD-3001 PDFs.

### 1.2 NASA HRP — the five hazards (RIDGE)
| Hazard | Key effects (from sources) | Facts |
|---|---|---|
| **R**adiation | Higher cancer risk, CNS damage, changes in cognition, reduced motor function, behavioral changes. Sources: galactic cosmic rays, solar particle events, coronal mass ejections | NASA is developing continuous crew exposure monitoring |
| **I**solation & confinement | Behavioral issues. Sleep loss, circadian desynchronization and work overload lower performance | HERA analog 650 sq ft, 45-day stays; CHAPEA 1,700 sq ft, 4 crew, about 1 year. Light therapy, journaling |
| **D**istance from Earth | Medical emergencies and equipment failures with little ground support; rationing supplies | Mars is about 140M miles away on average; mission about 3 years; **up to 20 min one-way comm delay** |
| **G**ravity fields | Dizziness and motion sickness, problems with orientation, coordination and balance, fainting after landing, fluid shift to the head causing vision issues, bone and muscle loss, kidney stones | **1–1.5% bone mineral density loss per month**; 6-month transit; Mars ≈ ⅓–⅜ g |
| **H**ostile/closed environments | Temperature, pressure, lighting, noise, CO₂, microbes spreading between crew, stress hormones, immune changes, allergies | Monitor microbes and immune responses |

The hazards "feed off one another". The system must model **compound risk**, not just isolated signals.

### 1.3 NASA HRP — 17 Human System Risks
**Human physiology (11):** (1) altered immune response, including viral reactivation; (2) sensorimotor/vestibular changes; (3) cardiovascular adaptations; (4) decompression sickness; (5) host–microorganism interactions; (6) hypoxia; (7) inadequate food & nutrition; (8) EVA injury/compromised performance (fatigue, DCS, low O₂ or high CO₂ in the suit); (9) reduced cardiorespiratory & musculoskeletal fitness; (10) **SANS** (Spaceflight Associated Neuro-ocular Syndrome, described as a leading risk); (11) bone changes.
**Behavioral & human factors (5):** (12) behavioral changes & psychiatric disorders; (13) inadequate teamwork; (14) inadequate sleep & irregular schedules; (15) inadequate systems-operations support; (16) injury from dynamic loads (landing).
**Radiation (1):** (17) radiation-induced cancers.

### 1.4 NASA HRP — ongoing research (monitoring modalities)
- **Artemis II:** ARCHeR (well-being, activity, sleep), wrist **actigraphy** (motion, sleep, light exposure), Immune Biomarkers (blood/saliva), Standard Measures (consistent data for a research data bank).
- **ISS:** B-Complex (vitamin B vs. eye/brain changes), Brain Fluid Pressure, CIPHER (multiple body systems), manual piloting after gravity transitions, Spacecraft Occupant Protection, Spinal Fluid Biomarkers, **Thigh Cuff** (SANS countermeasure), Venous Haemostasis (ultrasound, clotting), Zero T2 (exercise without a treadmill).
- **Past:** Altered Immunity, Food Acceptability/Physiology, Omics Archive, Space Gardening, Spinal Health, **Tempus Pro** (telemedicine device that integrates health data for near-real-time remote diagnosis, **closest prior art**).
- Devices: actigraphy, ultrasound, OCT (optical coherence tomography), fundoscope, exercise hardware, biosample kits.

### 1.5 CSA — Monitoring radiation for astronaut health (Feb 2026)
- **CANS (Canadian Active Neutron Spectrometer)**: compact, **autonomous, continuous** neutron measurement. CSA gave Bubble Technology Industries a $5.5M contract to develop it.
- **Neutrons are about 30% of total ISS radiation** and are especially harmful biologically.
- Heritage: bubble detectors, MOSFET dosimetry, EVARM, Radi-N/Radi-N2.
- Earth uses: cancer therapy, aircrew radiation protection, nuclear threat detection.

### 1.6 CSA — Why science in space
- Two goals: prepare for deep space, and improve life on Earth.
- Deep-space challenges: more weightlessness, more radiation, longer isolation, **communication delays**, less reliance on Earth for food, materials and **emergency medical help**.
- Spaceflight looks like **accelerated aging** and a sedentary lifestyle. Six months in orbit gives data that would take years to collect on Earth. Systems studied: bones, heart, blood vessels, brain. Earth benefits: balance in seniors, osteoporosis, cardiovascular disease, type-2 diabetes.
- Canadian experiments: Space Health study (Bio-Monitor), Vascular Aging/Calcium/Echo, CARDIOBREATH, SANSORI/SANSORI-2 (eyes), TBone/TBone2 (bone), AstroFit, SPARK (anemia), C-STARS (mental well-being), Wayfinding, BP Reg (predicting fainting).

### 1.7 Design implications
1. **Autonomy first.** Detection, alerting and guidance run onboard. Ground is advisory and delayed.
2. **Hazard → Risk → Signal traceability.** Every metric and alert links to a hazard and an HRP risk ID.
3. **Trends beat thresholds.** Bone loss, SANS, fitness and radiation dose build up over months, so slopes and cumulative totals matter.
4. **Compound risk.** For example, sleep loss + high CO₂ + high workload → cognitive performance risk.
5. **Standard Measures.** Collect data the same way every time and export it for research (Earth benefit).
6. **Config-driven limits.** The overview pages give no numeric limits, so limits live in a versioned config tied to STD-3001 clause ids (§9).
7. **Real data, honest provenance.** Use NASA-measured data wherever it is public (§1.8). Label every value as measured, derived or synthetic. A health monitor shown only on invented numbers proves nothing.

### 1.8 Public NASA datasets used (v1.1)

| Tier | Dataset | What it gives AEGIS | Access |
|---|---|---|---|
| D1 | **NASA-STD-3001** Vol 1 (Crew Health) and Vol 2 (Human Factors, Habitability & Environmental Health); **OCHMO Technical Briefs** | Numeric limits with clause ids. Confirmed so far: 1-h mean ppCO₂ ≤ 3 mmHg (Vol 2 Rev D [V2 6004], OCHMO TB-004); career effective dose < 600 mSv (Vol 1 [V1 4030], OCHMO Radiation Protection brief) | nasa.gov PDFs |
| D2 | **MSL Curiosity RAD** (Radiation Assessment Detector) | Measured dose rates inside a spacecraft in Mars cruise (Nov 2011–Aug 2012) and on the surface at Gale crater, including solar particle events seen in cruise. Published means: ≈ 0.48 mGy/day and ≈ 1.8 mSv/day in cruise; ≈ 0.21 mGy/day and ≈ 0.64 mSv/day on the surface (Zeitlin 2013, Hassler 2014) | PDS PPI `MSL-M-RAD-3-RDR-V1.0`; SPDF CDAWeb `MSL_RAD_OBS-L2` |
| D3 | **DONKI** (CCMC Space Weather Database Of Notifications, Knowledge, Information); **OMNIWeb** OMNI2 hourly | SEP, flare and CME records linked to the replayed event; near-Earth >10 MeV proton flux (GOES-sourced) | api.nasa.gov DONKI; SPDF OMNI2 |
| D4 | **JPL Horizons** | Earth–Mars range for the mission dates → one-way light time | ssd.jpl.nasa.gov |
| D5 | HRP hazard and risk pages; OCHMO TB-004 (historical ISS CO₂ range, CO₂–headache relationship); **OSDR** Inspiration4 blood studies (OSD-569/570/571/575: CBC, metabolic panels) | Calibration of simulator parameters; aggregate reference ranges | nasa.gov; osdr.nasa.gov |

**Not available publicly:** continuous in-flight astronaut vitals (HR, HRV, SpO₂, BP, actigraphy and sleep for ISS crews). These sit in NASA LSDA/LSAH under controlled access. AEGIS therefore keeps crew physiology synthetic, cites each simulator parameter, and labels the values `SYNTHETIC_CALIBRATED`.

---

## 2. Problem statement

On a Mars mission, crews will be up to 20 minutes from help, for about 3 years, while exposed to all five hazards at once. Today, health data is collected by separate devices and studies (actigraphy, ultrasound, dosimeters, biosamples, surveys) and is mostly analyzed on the ground after a delay. There is no single onboard system that:
- fuses physiological, behavioral, radiation and environmental data in real time,
- interprets it against spaceflight standards and HRP risks,
- warns early about slow-building conditions (bone, SANS, fitness, cumulative dose),
- works fully offline and syncs with Earth across a delayed, intermittent link.

## 3. Goals & non-goals

### Goals
- G1: One crew health picture per astronaut and for the whole crew, updated in near real time.
- G2: Autonomous detection with explainable alerts tied to hazards and HRP risks.
- G3: Radiation situational awareness: dose rate, cumulative and mission dose, neutron fraction, solar particle event (SPE) response.
- G4: Delay-tolerant ground link with a realistic comm-delay simulation.
- G5: Countermeasure tracking (exercise, sleep/light, nutrition, Thigh Cuff, supplements) and adherence.
- G6: Research-grade export ("Standard Measures").
- **G0 (priority 1): Real-data grounding.** Radiation, space weather, comm delay and limits come from NASA data (§1.8), with provenance shown on every value.

### Non-goals (MVP)
- Not a certified medical device. Gives no diagnoses, only decision support.
- No real hardware integration. Devices are simulated, or replayed from NASA archives, behind adapters.
- No full Integrated Medical Model reimplementation.
- No real PHI handling. No identifiable person's health data. Crew physiology is synthetic; the NASA data is environmental/radiation data or aggregate reference ranges.
- No live calls to NASA APIs at runtime. Datasets are bundled snapshots.

## 4. Users & personas

| Persona | Needs | Main surface |
|---|---|---|
| **Crew member** | Quick "am I OK?" status, clear actions, low cognitive load, a private journal | Crew app (tablet) |
| **Crew Medical Officer (CMO)** | Detailed physiology for all crew, alert triage, procedures, works with no ground link | Crew app, medical view |
| **Commander** | Crew readiness for EVAs and critical operations; team and workload view | Crew app, readiness view |
| **Flight surgeon (ground)** | Delayed sync of all data, trends, alert history, sends recommendations | Ground console |
| **Researcher** | Standardized, de-identified datasets | Export / API |

## 5. User stories (MVP marked ★)

- ★ US-1: As a crew member, I see my health status (green/amber/red) for each hazard on one screen.
- ★ US-2: As the CMO, I get an alert when a crew member's vitals leave their limits, with the likely cause, the HRP risk, and a suggested action.
- ★ US-3: As the CMO, during a solar particle event I see dose rate rising and get an instruction to go to the storm shelter, with a countdown and headcount.
- ★ US-4: As the commander, I see an EVA go/no-go readiness score for each crew member (sleep, fatigue, CO₂ exposure, DCS prebreathe status).
- ★ US-5: As a flight surgeon, I see the same data delayed by the configured comm delay and can send a recommendation that reaches the crew after that delay.
- ★ US-6: As the CMO, I see 30/90/180-day trends: bone density estimate, body mass, VO₂max proxy, sleep efficiency, cumulative dose.
- US-7: As a crew member, I can fill in a short mood/workload survey and a private journal, analyzed on the device only.
- US-8: As the CMO, I see a SANS watch panel: OCT/fundoscope exam log, headaches/vision complaints, Thigh Cuff use.
- US-9: As a researcher, I export a mission's Standard Measures as CSV/Parquet with a data dictionary.
- US-10: As the CMO, I see a VTE risk score and kidney-stone risk indicators (hydration, urine calcium proxy).
- ★ US-11: As a demo presenter, I can play scenarios (SPE, CO₂ scrubber failure, insomnia streak, cardiac arrhythmia, post-landing fainting) at adjustable speed.

## 6. Scope: feature modules

### M0. NASA data layer ★ (priority 1, v1.1)
- `scripts/fetch_nasa_data.py` (build time only) downloads the D1–D5 windows into `data/nasa/raw/`, writes normalized files to `data/nasa/derived/`, and records each in `data/nasa/MANIFEST.yaml` (dataset id, tier, source URL, retrieval date, sha256, terms, transform).
- `config/datasets.yaml` maps datasets to signals, phases and scenarios, plus the time mapping (window start, compression, loop/hold, gap hold time).
- Replay adapters (`backend/app/datasets/`) implement the same `DeviceAdapter → Observation` interface as M1, so the engine path does not change.
- Every observation carries `provenance` (`NASA_MEASURED` | `NASA_DERIVED` | `SYNTHETIC_CALIBRATED` | `SYNTHETIC`) and `dataset_id`.
- Startup verifies the manifest and sha256. A missing or bad file falls back to the synthetic generator for that signal, labelled `SYNTHETIC`, and never stops the crew app.
- `GET /api/v1/datasets` lists the sources. The UI shows a `DataSourceBadge` on every chart, tile and alert evidence block.
- Work items R-0…R-6 and Gate R: `ROADMAP.md` §0.3.

### M1. Data ingestion & device adapters ★
- Adapter interface: `DeviceAdapter → stream of Observation`.
- Simulated device types:
  - **Biomonitor wearable** (Bio-Monitor/Astroskin-like): HR, ECG-derived HRV, SpO₂, respiration rate, skin temperature, blood pressure (intermittent), 3-axis accelerometer.
  - **Actigraphy wristband** (Artemis II-like): activity counts, sleep/wake state, ambient light (lux).
  - **Personal dosimeter**: absorbed dose rate (µGy/h), dose-equivalent rate (µSv/h). *v1.1:* derived from the replayed RAD area rate (shelter factor, per-crew noise), `NASA_DERIVED`.
  - **Area dosimeter** *(v1.1)*: **replayed MSL/RAD** dose rates for `MARS_TRANSIT` and `MARS_SURFACE`, `NASA_MEASURED`.
  - **Area neutron spectrometer** (CANS-like): neutron flux, neutron dose-equivalent, energy spectrum bins.
  - **Cabin environment**: ppCO₂ (mmHg), ppO₂, cabin pressure (kPa), temperature (°C), relative humidity, noise (dBA), VOC index, microbial sample results (periodic).
  - **Exercise device**: modality, duration, load, HR during the session.
  - **Clinical/periodic inputs** (manual entry): body mass, OCT/fundoscope findings, ultrasound notes, biosample results (e.g., cortisol, viral shedding flag), urine.
  - **Surveys**: mood, workload (NASA-TLX-style), sleep quality, symptom checklist, food acceptability.
- Every observation is normalized to a common schema with units and a quality flag (§8).

### M2. Synthetic data simulator ★ (critical for the demo)
- *v1.1:* the simulator covers only the signals no public NASA dataset provides (physiology, sleep, exercise, cabin atmosphere). Each parameter gets a `source_ref` (NASA-calibrated) or is marked heuristic. Radiation in Mars phases and the SPE move to M0 replay.
- Produces realistic daily rhythms (circadian HR/temperature, sleep blocks, exercise sessions) for 4 crew members with individual baselines.
- Mission-phase profiles: `LEO`, `TRANSIT`, `LUNAR_SURFACE`, `MARS_TRANSIT`, `MARS_SURFACE`, `RETURN`, `POST_LANDING`. Each phase sets the radiation background, gravity level (0, 0.16, 0.38, 1 g) and comm delay.
- Slow drifts: bone mineral density −1 to −1.5% per month in 0 g (slower with good exercise adherence), muscle/fitness decline linked to exercise adherence, rising cumulative dose.
- **Scenario injector** (US-11): scriptable events in YAML/JSON, e.g.
  - `spe_event`: *v1.1:* replays a real SEP measured by RAD in Mars cruise (candidate: early March 2012), time-compressed and labelled, with its DONKI record; neutron component derived.
  - `co2_scrubber_degradation`: ppCO₂ rises over hours.
  - `insomnia_streak`: sleep efficiency drops over N nights.
  - `arrhythmia`: irregular RR intervals.
  - `orthostatic_intolerance`: falling BP + rising HR after a gravity transition.
  - `eva`: suit-environment parameters, raised metabolic rate.
  - `infection`: temperature + HR + symptoms + viral shedding flag.
- Controls: playback speed 1× to 10,000×, deterministic seeds, pause/jump.

### M3. Health rules & analytics engine ★
- **Threshold rules** (config-driven): value outside a limit for a set time.
- **Personal baseline rules**: z-score against a rolling 14-day personal baseline (catches changes that absolute limits miss).
- **Trend rules**: linear slope over a window (e.g., body mass −X%/30 d, sleep efficiency trend, BMD estimate).
- **Cumulative rules**: dose integrals (24 h, 30 d, mission, career) checked against configured limits.
- **Compound rules**: boolean or weighted combinations across modalities (e.g., `sleep_debt > 6h AND ppCO2 > limit_1h AND workload_high` → cognitive performance risk, HRP-14 + Hostile Env).
- **Readiness scores** (0–100) per crew member: Overall, EVA, Cognitive, Physical. Transparent weighted formulas whose components can be inspected.
- **Scores ported from literature** (optional, P1): VTE risk indicator, kidney stone risk indicator, orthostatic intolerance prediction after landing.
- Each rule has an `id`, `hazard[]`, `hrp_risk[]`, `severity`, `rationale`, `recommended_action`, and `source_ref` (e.g., "NASA-STD-3001 Vol 2 §6.x, VERIFY").

### M4. Alerting & crew guidance ★
- Severity levels follow the Standards Hierarchy Pyramid:
  - `CAUTION` → may affect a mission objective
  - `WARNING` → may cause loss of mission or major health impact
  - `EMERGENCY` → immediate threat to crew life (loss of crew)
- Alert lifecycle: `RAISED → ACKNOWLEDGED → IN_TREATMENT → RESOLVED`, also `SUPPRESSED`/`FALSE_POSITIVE`, with an audit trail.
- Deduplication and hysteresis to avoid alert fatigue (crew attention is a scarce resource).
- Every alert shows: what, who, since when, the evidence chart, linked hazard/risk, a suggested checklist (e.g., "SPE: go to the shelter, log location, dosimeter check every 15 min").
- EMERGENCY alerts play a sound and take over the screen. Lower levels show as banners or toasts.

### M5. Crew dashboard (onboard UI) ★
- **Crew overview**: one card per astronaut with a status ring, readiness scores, top active alert.
- **Hazard view (RIDGE)**: 5 tiles (Radiation, Isolation, Distance, Gravity, Hostile Env), each with status and drill-down.
- **Individual view**: live vitals (sparklines), sleep last 7 nights, exercise adherence, cumulative dose, trends.
- **Radiation view** (M6).
- **Environment view**: cabin CO₂/O₂/pressure/temperature/humidity/noise with limit bands.
- **Countermeasures**: today's exercise prescription vs. done, light-therapy schedule, supplements, Thigh Cuff sessions.
- **Wellbeing**: survey, private journal (stays local, sentiment analyzed on the device only, opt-in sharing).
- Design: works offline, dark-mode friendly, large touch targets, readable at a glance, no more than 3 taps to any critical action.

### M6. Radiation module ★
- Live dose rate (personal + area), with the **neutron fraction** shown separately (about 30% of ISS radiation according to CSA).
- Cumulative dose: 24 h / 30 d / mission / career, as a % of the configured limits.
- SPE mode: when dose rate goes above the SPE threshold → EMERGENCY, shelter procedure, headcount, timer, post-event dose report.
- *v1.1:* the dose-rate chart is the replayed MSL/RAD measurement, badged "NASA · MSL/RAD" with the date. The SPE evidence names the real event (date, DONKI SEP id, linked flare/CME). The neutron fraction stays the CSA ≈ 30 % figure, labelled `NASA_DERIVED` (CSA-sourced).
- Mission planning helper (P2): predicted mission dose for each phase profile.

### M7. Ground link & comm-delay simulation ★
- Store-and-forward message bus between `onboard` and `ground` nodes.
- Configurable one-way delay (0 s LEO → about 1.3 s Moon → 4–20+ min Mars), bandwidth cap, and blackout windows (e.g., solar conjunction).
- *v1.1:* in Mars phases the delay comes from a bundled **JPL Horizons** Earth–Mars range table for the simulated date (`NASA_DERIVED`). The manual override (`POST /link/delay`) stays for demos.
- *v1.1:* the ground console shows a space-weather card (DONKI + OMNI2) for the active event and can forward it to the crew through the delayed link.
- Ground console shows the "as-of" timestamp and the delay clearly. Recommendations arrive onboard after the delay.
- Priority queue: EMERGENCY summaries go first, bulk telemetry is downsampled.

### M8. Ground (flight surgeon) console ★
- The same views as the crew app, read-only for crew data, plus:
  - alert history across the whole mission,
  - "Send recommendation" (text + optional checklist), delivered after the delay,
  - long-term trend reports.

### M9. Research export (P1)
- "Standard Measures" export: per-crew, per-day CSV/Parquet + JSON data dictionary. De-identified crew IDs.

### M10. Admin/config (P1)
- Limits & rules editor (YAML), crew profiles & baselines, mission phase timeline, device registry.

## 7. Domain model

### 7.1 Hazards (enum)
`RADIATION`, `ISOLATION_CONFINEMENT`, `DISTANCE_FROM_EARTH`, `GRAVITY_FIELDS`, `HOSTILE_CLOSED_ENV`

### 7.2 HRP risks (enum, IDs used throughout)
| ID | Name | Category | Primary hazards |
|---|---|---|---|
| HRP-01 | Altered immune system responses | Physiology | Hostile Env, Isolation, Radiation |
| HRP-02 | Altered sensorimotor/vestibular function | Physiology | Gravity |
| HRP-03 | Cardiovascular adaptations | Physiology | Gravity, Radiation |
| HRP-04 | Decompression sickness | Physiology | Hostile Env |
| HRP-05 | Host–microorganism interactions | Physiology | Hostile Env |
| HRP-06 | Hypoxia | Physiology | Hostile Env |
| HRP-07 | Inadequate food & nutrition | Physiology | Distance |
| HRP-08 | EVA injury & compromised performance | Physiology | Hostile Env, Gravity |
| HRP-09 | Reduced cardiorespiratory & musculoskeletal fitness | Physiology | Gravity |
| HRP-10 | SANS | Physiology | Gravity |
| HRP-11 | Spaceflight-induced bone changes | Physiology | Gravity |
| HRP-12 | Behavioral changes & psychiatric disorders | Behavioral | Isolation, Distance, Radiation |
| HRP-13 | Inadequate teamwork | Behavioral | Isolation |
| HRP-14 | Inadequate sleep & irregular schedules | Behavioral | Isolation, Hostile Env |
| HRP-15 | Inadequate systems operations support | Behavioral | Distance |
| HRP-16 | Injury from dynamic loads | Behavioral/HF | Gravity |
| HRP-17 | Radiation-induced cancers | Radiation | Radiation |

### 7.3 Signal → risk map (MVP)
Provenance after Block R: `dose_rate_absorbed`/`dose_rate_equivalent` (area) = `NASA_MEASURED` (MSL/RAD); personal dose and neutron rate = `NASA_DERIVED`; all other signals = `SYNTHETIC_CALIBRATED` or `SYNTHETIC`.

| Signal | Unit | Source device | HRP risks |
|---|---|---|---|
| heart_rate | bpm | biomonitor | 03, 09, 12 |
| hrv_rmssd | ms | biomonitor | 03, 12, 14 |
| spo2 | % | biomonitor | 06, 08 |
| resp_rate | /min | biomonitor | 06 |
| skin_temp / core_temp_est | °C | biomonitor | 01, 05 |
| bp_systolic / bp_diastolic | mmHg | biomonitor/cuff | 03, 10 |
| ecg_rhythm_flag | enum | biomonitor | 03 |
| activity_counts | counts/min | actigraphy | 09, 14 |
| sleep_state | enum | actigraphy | 14, 12 |
| light_lux | lux | actigraphy | 14 |
| dose_rate_absorbed | µGy/h | dosimeter | 17, 03, 12 |
| dose_rate_equivalent | µSv/h | dosimeter | 17 |
| neutron_dose_equivalent_rate | µSv/h | neutron spectrometer | 17 |
| ppco2 | mmHg | cabin | 12, 14, 08 |
| ppo2 | kPa | cabin | 06 |
| cabin_pressure | kPa | cabin | 04, 06 |
| cabin_temp / humidity | °C / %RH | cabin | Hostile Env |
| noise_level | dBA | cabin | 14, Hostile Env |
| body_mass | kg | manual | 07, 09 |
| bmd_estimate | % of baseline | model | 11 |
| exercise_minutes / load | min / kg | exercise device | 09, 11 |
| vision_symptom / oct_finding | enum | manual | 10 |
| mood / workload / sleep_quality | score | survey | 12, 13, 14 |
| viral_shedding_flag | bool | biosample | 01 |

### 7.4 Severity ↔ Standards Pyramid
| Level | Meaning | UI |
|---|---|---|
| INFO | Trend worth noting | Feed only |
| CAUTION | Could affect mission objectives | Amber banner |
| WARNING | Could cause loss of mission or serious health impact | Red banner + sound |
| EMERGENCY | Immediate threat to life (loss of crew) | Full-screen takeover + alarm |

## 8. Data model (core entities)

```text
CrewMember(id, callsign, role[CDR|CMO|MS|PS], baseline{hr_rest, hrv, body_mass, bmd, vo2max_proxy}, career_dose_prior_mSv)
Device(id, type, crew_id?|location, adapter, status, last_seen)
Observation(id, ts, crew_id?, location?, device_id, signal, value, unit, quality[GOOD|SUSPECT|BAD], phase,
            provenance[NASA_MEASURED|NASA_DERIVED|SYNTHETIC_CALIBRATED|SYNTHETIC], dataset_id?)
Dataset(id, tier[D1..D5], title, source_url, retrieved, sha256, terms, transform, signals[], window{start,end})
MissionPhase(id, name, start_ts, end_ts, gravity_g, comm_delay_s, radiation_profile)
Rule(id, type[THRESHOLD|BASELINE|TREND|CUMULATIVE|COMPOUND], expr, window, severity, hazards[], hrp_risks[], rationale, action, source_ref)
Alert(id, rule_id, crew_id?, severity, state, raised_ts, ack_ts?, resolved_ts?, evidence{signal_refs, values}, notes[], origin[ONBOARD|GROUND])
ReadinessScore(crew_id, ts, kind[OVERALL|EVA|COGNITIVE|PHYSICAL], value, components{})
Countermeasure(id, crew_id, type[EXERCISE|LIGHT|SUPPLEMENT|THIGH_CUFF|NUTRITION], prescribed, completed, ts)
SurveyResponse(id, crew_id, ts, instrument, answers{}, private:boolean)
Message(id, direction[DOWN|UP], priority, payload, sent_ts, deliver_ts, delivered:boolean)
```

Time-series storage: one table per entity, with Observations indexed on `(crew_id, signal, ts)`. Keep raw data for 7 days at full rate and store 1-min/1-h rollups for longer periods.

## 9. Thresholds & limits (config, NOT hardcoded)

The overview pages give **no numeric limits**. All limits live in `config/limits.yaml`, each with a `source_ref` and a `verified: true|false` flag. The UI shows a "⚠ unverified limit" marker for unverified entries.

**v1.1 (R-1):** pull the numbers from NASA-STD-3001 Vol 1/Vol 2 and the OCHMO Technical Briefs and flip them to `verified: true` with document, revision and clause id. Confirmed so far from the briefs: ppCO₂ 1-h mean ≤ 3 mmHg (Vol 2 Rev D [V2 6004], TB-004) and career effective dose < 600 mSv (Vol 1 [V1 4030], Radiation Protection brief). The radiation brief also lists short-term limits; read the clause before using them. Limits with no NASA number (SPE alert dose rate, 24-h dose alert, HR/SpO₂ clinical heuristics, readiness cut-offs) stay `verified: false` and say "Project heuristic". Target for Gate R: ≥ 6 verified limits.

Starting placeholders (historical; `config/limits.yaml` is authoritative):

```yaml
# config/limits.yaml (illustrative, verify all)
radiation:
  career_effective_dose_mSv: { value: 600, source_ref: "NASA-STD-3001 Vol 1 (career limit), VERIFY", verified: false }
  spe_alert_dose_rate_uSv_h: { value: 100, source_ref: "Project heuristic", verified: false }
  daily_background_LEO_uSv: { value: 500, source_ref: "Typical ISS order of magnitude, VERIFY", verified: false }
environment:
  ppco2_mmHg_1h_max:  { value: 3.0, source_ref: "NASA-STD-3001 Vol 2, VERIFY", verified: false }
  ppo2_kPa_min:       { value: 19.5, source_ref: "VERIFY", verified: false }
  cabin_temp_C:       { min: 18, max: 27, source_ref: "VERIFY", verified: false }
  humidity_pct:       { min: 25, max: 75, source_ref: "VERIFY", verified: false }
  noise_dBA_sleep_max:{ value: 50, source_ref: "NASA-STD-3001 Vol 2, VERIFY", verified: false }
physiology:
  spo2_pct_min:       { value: 92, source_ref: "Clinical heuristic", verified: false }
  hr_bpm:             { min: 40, max: 140, rest_context: true, source_ref: "Clinical heuristic", verified: false }
  baseline_z_alert:   { value: 3.0, source_ref: "Project heuristic", verified: false }
bone:
  bmd_loss_pct_per_month_expected_0g: { min: 1.0, max: 1.5, source_ref: "NASA HRP Gravity Fields page", verified: true }
sleep:
  min_sleep_h_24h:    { value: 6, source_ref: "Project heuristic", verified: false }
```

## 10. Non-functional requirements

| Area | Requirement |
|---|---|
| Autonomy | All detection, alerting and UI work with the ground link down. No cloud dependency at runtime |
| Latency | Observation → alert on screen in ≤ 2 s (onboard). EMERGENCY ≤ 1 s from rule evaluation |
| Throughput | ≥ 4 crew × 20 signals × 1 Hz sustained, plus 250 Hz ECG bursts (optional) |
| Reliability | Ingestion is idempotent. No data loss across a backend restart (WAL/SQLite or queue) |
| Explainability | Every alert and score shows its inputs, rule, and the limit with its source |
| Privacy | Journals and private surveys stay onboard by default. Role-based views (crew sees self + crew summary; CMO sees all; ground sees what was synced). Exports are de-identified |
| Safety framing | A persistent "Decision support, not a diagnosis" disclaimer. No automated treatment |
| Accessibility | WCAG AA contrast, works on tablet 1024×768 and up, colorblind-safe statuses (icon + color) |
| Observability | Structured logs, `/health` endpoint, rule-evaluation metrics |
| Testability | Deterministic simulator seeds. Each rule has unit tests with fixtures |
| Data provenance (v1.1) | Every value shows its provenance; every bundled file has a manifest entry with sha256; the full demo runs with outbound networking blocked |

## 11. Recommended architecture (MVP)

> **30-hour build:** onboard and ground run as two separate stores inside one FastAPI process, joined only by the link delay queue. The simulator feeds the engine in-process, storage is in-memory ring buffers, and there is no docker compose. The diagram below is the target architecture. See `ROADMAP.md` §2.

```text
┌──────────────── ONBOARD NODE ────────────────┐        ┌──────── GROUND NODE ────────┐
│ Simulator ─► Device adapters ─► Ingest API   │        │                              │
│                       │                      │        │  Ground API + same DB schema │
│                  Time-series DB (SQLite/     │ delay  │  Flight-surgeon console      │
│                  DuckDB/Timescale)           │◄──────►│  (React)                     │
│                       │                      │ link   │                              │
│              Rules/analytics engine          │  sim   └──────────────────────────────┘
│                       │                      │
│        Alert manager ─► WebSocket ─► Crew UI │
└──────────────────────────────────────────────┘
```

- **Backend:** Python 3.11+, FastAPI, Pydantic v2, SQLAlchemy/SQLModel + SQLite (MVP), WebSockets for live push, APScheduler or asyncio tasks for rule evaluation.
- **Frontend:** React + TypeScript + Vite, TanStack Query, a charting library (Recharts or uPlot for high-rate data), Tailwind.
- **Comm link simulator:** an in-process asyncio delay queue between two FastAPI apps (or two instances of the same app with `NODE_ROLE=onboard|ground`).
- **Packaging:** `docker compose up` starts onboard, ground, and the frontend. A single `make demo` target loads a scenario.

## 12. API surface (MVP)

```text
POST   /api/v1/observations            # batch ingest (idempotent by id)
GET    /api/v1/crew                    # list crew + current status
GET    /api/v1/crew/{id}/summary       # vitals, scores, active alerts
GET    /api/v1/crew/{id}/timeseries?signal=&from=&to=&agg=
GET    /api/v1/environment/current
GET    /api/v1/radiation/summary       # rates, cumulative, neutron fraction
GET    /api/v1/alerts?state=&severity=
POST   /api/v1/alerts/{id}/ack | /resolve | /note
GET    /api/v1/readiness?kind=EVA
GET    /api/v1/rules  · PUT /api/v1/rules/{id}   (admin)
POST   /api/v1/sim/scenario            # start scenario {name, speed, seed}
POST   /api/v1/sim/control             # pause/resume/speed/jump
GET    /api/v1/link/status             # delay, queue depth, last sync
POST   /api/v1/link/recommendation     # ground → crew (delivered after delay)
GET    /api/v1/export/standard-measures?from=&to=&format=csv|parquet
WS     /ws/live                        # observations (downsampled), alerts, scores
```

Added in the 30-hour build (full shapes are in `implementationsandgoals.txt` section 7):

```text
Every GET takes ?node=onboard|ground and returns { node, now, as_of, age_s, ...data }
GET    /api/v1/limits                  # limits tree + limit bands per signal (value, source_ref, verified)
GET    /api/v1/environment/timeseries?signal=
POST   /api/v1/radiation/shelter       # SPE headcount {crew_id, sheltered}
GET    /api/v1/sim/status              # scenario, seed, speed, paused, scenario list
POST   /api/v1/link/blackout           # {on}
POST   /api/v1/link/delay              # {delay_s | null}
GET    /api/v1/link/recommendations
WS     /ws/live?node=                  # messages: snapshot (full state, ~5/s), alert, recommendation
Not built: PUT /rules/{id}, GET /export/standard-measures, sim "jump"
```

Planned in Block R (v1.1):

```text
GET    /api/v1/datasets                # [{id, tier, title, source_url, retrieved, sha256_ok, provenance, signals[], transform}]
GET    /api/v1/spaceweather/event      # bundled DONKI SEP/FLR/CME + OMNI2 flux for the active replay
Observation, timeseries points and alert evidence gain: provenance, dataset_id (evidence also gains limit_source)
```

## 13. Milestones (hackathon plan)

The 30-hour plan below replaces the original milestones. `ROADMAP.md` has the full version with the cut list and stretch list. Hours are offsets from the start.

| Hours | Block | Done when |
|---|---|---|
| T+0 to 1 | Setup | Repo, scaffold, config files, `/health` responds, empty UI shell loads |
| T+1 to 5 | Simulator | **Gate 1:** 4 crew stream vitals/env/radiation at 1,000×; the same seed gives the same numbers |
| T+5 to 9 | Rules + alerts | **Gate 2:** threshold, baseline, cumulative and compound rules from YAML; `spe_event` raises EMERGENCY and `co2_scrubber_degradation` raises CAUTION in pytest and over WebSocket |
| T+9 to 14 | Crew UI | **Gate 3:** overview with RIDGE tiles, alert list with evidence, crew detail with limit bands, scenario dock |
| T+14 to 19 | Sleep | |
| T+19 to 22 | Radiation + SPE | Neutron fraction, cumulative dose, SPE emergency takeover end to end |
| T+22 to 25 | Ground link | **Gate 4:** delayed ground console, recommendation round trip, link blackout leaves the crew UI unaffected |
| T+25 to 27 | Demo script | Cognitive-risk compound rule, EVA readiness, `demo_5min` plays through twice untouched |
| T+27 to 30 | Freeze | Rehearsed, recorded, README written, submitted |

**Block R (v1.1, priority 1, before the freeze).** Full table in `ROADMAP.md` §0.3.

| Hours | Item | Done when |
|---|---|---|
| R+0 to 2 | R-0 Data layer: manifest, `datasets.yaml`, loaders, `provenance`, `GET /datasets`, badge | No-network test passes; tampered file falls back to SYNTHETIC |
| R+2 to 4 | R-1 Verified limits (D1) | ≥ 6 limits verified with clause ids |
| R+4 to 7 | R-2 MSL/RAD replay (D2) | Replayed cruise mean ≈ 1.8 mSv/day |
| R+7 to 9 | R-3 Real SPE (D2 + D3) | `spe_event` fires EMERGENCY + WARNING from replayed values |
| R+9 to 10 | R-4 Horizons light time (D4) | Ground shows the delay with its source |
| R+10 to 11 | R-5 Space-weather card (D3) | Card works offline; forwarding goes through `link/` |
| R+11 to 12 | R-6 Calibration (D5) + re-rehearsal | `demo_5min` plays twice untouched |

**Gate R:** NASA-measured radiation and SPE in the demo, ≥ 6 verified limits, provenance everywhere, demo runs offline, checks pass. Then the D-3 freeze.

Deferred out of the 30 hours: TREND rules, the `arrhythmia`, `eva` and `infection` scenarios, Countermeasures and Wellbeing views (M5), research export (M9), admin/config (M10), a separate ground process and docker compose (§11).

### Original full-scope milestones (superseded)

| # | Milestone | Done when |
|---|---|---|
| M0 | Skeleton | Repo, compose, health endpoints, empty UI shell, CI running lint + tests |
| M1 | Simulator + ingest | 4 crew members stream realistic vitals/env/radiation into the DB at 1 Hz, 100× speed works |
| M2 | Rules + alerts | Threshold, baseline and cumulative rules from YAML. Alerts appear on the UI via WebSocket |
| M3 | Crew dashboard | Overview, RIDGE tiles, individual view, environment view |
| M4 | Radiation + SPE scenario | Neutron fraction, cumulative dose, SPE emergency flow end to end |
| M5 | Ground link | Configurable delay, ground console, recommendation round-trip |
| M6 | Readiness + trends + compound | EVA readiness, 30/90-day trends, the cognitive-risk compound rule |
| M7 | Demo polish | Scripted 5-minute demo: LEO → Mars transit → SPE → CO₂ fault → landing fainting |
| P1+ | Stretch | Research export, journal sentiment on the device, VTE/kidney-stone scores, rules editor |

## 14. Demo script (5 minutes)

1. **Normal day in Mars transit** (0 g, 12-min delay). Crew overview is all green. Point out the radiation tile: the dose rate is **NASA-measured** (MSL/RAD in Mars cruise), the neutron share is derived, and the CO₂ limit carries a NASA-STD-3001 clause id. The vitals are clearly badged synthetic.
2. **Insomnia streak + CO₂ creep** → compound CAUTION "cognitive performance risk" (HRP-14 + Hostile Env). EVA readiness drops for CDR, so the EVA is rescheduled.
3. **Solar particle event** → EMERGENCY. *v1.1:* this is a **real event measured by RAD on the way to Mars**, replayed time-compressed; the evidence shows its date and DONKI record. Shelter procedure, headcount, dose counter. The ground console sees it one light-time later (Horizons delay), which shows why autonomy matters.
4. **Ground recommendation** is sent and arrives after the delay.
5. **Mars landing** (0 → 0.38 g) → orthostatic WARNING for one crew member (BP Reg-style prediction), sensorimotor caution.
6. **Long-term trend view**: BMD and fitness slopes against exercise adherence. Close with the Earth-benefit angle (aging, osteoporosis, remote care).

## 15. Success metrics

- Demo: every scenario fires the expected alert within its configured window, with **0 missed EMERGENCY** events and ≤ 1 false WARNING per simulated day.
- Explainability: 100% of alerts have a hazard, an HRP risk, evidence and a `source_ref`.
- Real data (v1.1): radiation and SPE in the demo are 100 % replayed NASA measurements; ≥ 6 limits verified with clause ids; 100 % of displayed values carry a provenance badge.
- Autonomy: the full flow works with the ground node stopped.
- Performance: p95 time from ingest to UI ≤ 2 s at 100× speed.

## 16. Risks & open questions

- **Numeric limits not verified**: R-1 pulls the values from the NASA-STD-3001 PDFs and the OCHMO briefs. Until then, the UI labels them. The briefs cite different revisions (Vol 1 Rev B/C, Vol 2 Rev C/D), so record the revision actually read.
- **No public in-flight vitals.** Judges may ask "is this real astronaut data?". Answer plainly: radiation, space weather, delay and limits are NASA data; crew vitals are synthetic and NASA-calibrated. The UI badges say the same.
- **RAD is not a crew dosimeter.** It sat inside the MSL spacecraft and then on the rover, so its shielding differs from a crew habitat. Present it as "measured deep-space environment", and keep the per-crew dose as `NASA_DERIVED`.
- **The real SPE will not match the synthetic ×80 curve.** The SPE alert and 24-h dose limits are heuristics; retune them in `limits.yaml` (still `verified: false`) and rehearse again.
- **Data gaps and formats** in PDS/CDAWeb products: bundle small windows, hold the last value through short gaps, mark `SUSPECT`.
- Mars gravity is given as both ⅓ g and ⅜ g on NASA pages. Use **0.38 g** (physical value) in the simulator.
- Should crew see each other's detailed vitals? Default: no, only a status summary (privacy and teamwork dynamics, HRP-13).
- Alert fatigue vs. sensitivity tuning: needs scenario-based calibration.
- Which device names to show in the UI: use generic names ("biomonitor", "neutron spectrometer") and avoid implying endorsement.

## 17. References

- NASA OCHMO Standards: https://www.nasa.gov/ochmo/human-spaceflight-and-aviation-standards/
- NASA HRP Hazards: https://www.nasa.gov/hrp/hazards/
- NASA HRP Risks: https://www.nasa.gov/hrp/risks/
- NASA HRP Ongoing Research: https://www.nasa.gov/hrp/ongoing-hrp-research/
- CSA, Monitoring radiation for astronaut health (2026-02-26): https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp
- CSA, Why do we conduct science experiments in space: https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp
- CSA, Experiments on the Station (followed link): https://www.asc-csa.gc.ca/eng/iss/science/experiments.asp

Data sources added in v1.1:
- OCHMO TB-004 Carbon Dioxide: https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-004-carbon-dioxide.pdf
- OCHMO Radiation Protection Technical Brief: https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf
- MSL RAD RDR SIS (PDS PPI): https://pds-ppi.igpp.ucla.edu/volume/MSLRAD_1002/DOCUMENT/RAD_RDR_SIS.HTM
- MSL RAD data catalog entry: https://catalog.data.gov/dataset/msl-mars-radiation-assessment-detector-rdr-b9779
- SPDF CDAWeb (MSL_RAD_OBS-L2): https://cdaweb.gsfc.nasa.gov/
- Guo et al. 2015, dose rate variations observed by MSL/RAD in transit: https://arxiv.org/abs/1503.06631
- DONKI: https://kauai.ccmc.gsfc.nasa.gov/DONKI/ (API via https://api.nasa.gov/)
- OMNIWeb / OMNI2: https://omniweb.gsfc.nasa.gov/html/overview.html
- JPL Horizons: https://ssd.jpl.nasa.gov/horizons/
- OSDR Inspiration4 datasets: https://www.nasa.gov/osdr-latest-news-i4-mission-datasets/
