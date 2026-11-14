# AEGIS: 30-hour MVP roadmap

Assumes one person plus coding agents, 30 hours of wall-clock time including one 5-hour sleep. Hours are offsets from the start (T+0). If there are more people, the UI block (T+9 to T+14) and the rules block (T+5 to T+9) can run in parallel once the WebSocket payloads are fixed.

## 1. Decisions

1. **AEGIS (`PRD.md` + `AGENTS.md`) is the spec.** The ASTRA-MED documents (`*byargon.md`) describe a different product with a different schema, severity enum and storage model. Building from both will produce two half-apps. Move them to `docs/alt/` so agents stop reading them.
2. **What to take from ASTRA-MED:** the one-click scenario dock, the "same symptom, different cause" compound rule (tachycardia + headache branches on cabin CO₂), and the reaction-time self-test as a stretch item.
3. **What to leave out of ASTRA-MED:** local LLMs (MedGemma, RoBERTa triage, INDUS), River, NeuroKit2, Dexie, live DONKI/OSDR/ISS APIs, the body map, the gamified mode, and signed packets. Each is hours of integration for seconds of demo, and the live APIs break the "no internet at runtime" rule.
4. **Do not copy its threshold table.** It presents specific numbers as NASA-STD-3001 values without verification. Its numbers may go into `limits.yaml` as `verified: false` placeholders only.
5. **The demo is the product.** Everything is ranked by whether it appears in the 5-minute script (PRD §14). The story is: the crew system catches a solar particle event on its own, and the ground sees it 12 minutes later.

## 2. Restructured architecture

| PRD / AGENTS.md says | 30-hour version | Why |
|---|---|---|
| Two FastAPI nodes + docker compose | One FastAPI process holding two state stores, `onboard` and `ground`. The ground store is written only by `link/` messages | Keeps the comm-link rule (§6) and the autonomy demo without multi-process debugging |
| Simulator posts to the ingest API at 1 Hz | Simulator feeds the engine in-process on each simulated tick. `POST /observations` still exists and uses the same code path | Speed control up to 10,000× without HTTP overhead |
| SQLite with raw data + rollups | In-memory ring buffers per signal (1-minute resolution). SQLite only for alerts and link messages, or skipped | No one sees persistence in a demo |
| Five rule types | THRESHOLD, CUMULATIVE, COMPOUND, plus a simple BASELINE z-score. No TREND rule; the BMD slope is a chart from simulator output | TREND needs months of simulated data to mean anything |
| Eight scenarios | `demo_5min`, `spe_event`, `co2_scrubber_degradation`, `insomnia_streak`, `orthostatic_intolerance` | The other three are not in the demo script |
| Nine views | CrewOverview (with RIDGE tiles), CrewDetail, Radiation, AlertCenter, GroundConsole. Environment is the Hostile-Env tile drill-down | Countermeasures and Wellbeing are not in the demo script |
| Generated OpenAPI client, mypy, Playwright | Hand-written TS types, ruff + pytest + tsc. No Playwright | Tooling that pays off after week one |

Rules that stay exactly as written: all limits from `limits.yaml` with the unverified marker, hazards + HRP ids + evidence on every alert, seeded determinism, injectable `Clock`, synthetic data only, no diagnostic wording, the persistent footer.

**Comm delay in a live demo:** nobody waits 12 real minutes. `demo_5min` sets the simulation speed per segment, so 12 simulated minutes pass in about 10 real seconds while the ground console counts down.

## 3. Timeline

| Hours | Block | Done when |
|---|---|---|
| T+0 to 1 | **Setup.** Check the submission requirements and deadline. `git init`, public repo, scaffold backend and frontend, the four config files, domain enums | `/health` responds, the empty UI shell loads |
| T+1 to 5 | **Simulator.** `Clock`, 4 crew with baselines, circadian HR/temp, sleep blocks, cabin environment, radiation split into total and neutron, phases, scenario injector, speed control, WebSocket push | **Gate 1:** a debug page shows 4 crew streaming at 1,000×, and the same seed gives the same numbers |
| T+5 to 9 | **Rules and alerts.** YAML loader, the four rule types, alert lifecycle (RAISED, ACKNOWLEDGED, RESOLVED), hysteresis and dedup, pytest per rule type and per scenario | **Gate 2:** `spe_event` raises EMERGENCY and `co2_scrubber_degradation` raises CAUTION, in pytest and over the WebSocket |
| T+9 to 14 | **Crew UI.** Overview cards with status rings, RIDGE tiles, alert banner and alert list with evidence, CrewDetail with limit-band charts and unverified markers, scenario dock | **Gate 3:** click a scenario, watch the alert appear with evidence, acknowledge it. Record a screen capture as a fallback |
| T+14 to 19 | **Sleep** | |
| T+19 to 22 | **Radiation and SPE.** Radiation view (dose rate, neutron fraction, cumulative % of limit), full-screen EMERGENCY takeover with shelter checklist, headcount, timer, dose counter | The SPE flow runs end to end from one click |
| T+22 to 25 | **Ground link.** Delay queue with priority order, ground store, GroundConsole with "Data as of T−Xm Ys", recommendation round trip, link-blackout toggle, delay test | **Gate 4:** ground sees the SPE after the delay; with the link blacked out the crew UI is unaffected |
| T+25 to 27 | **Demo script.** Cognitive-risk compound rule, EVA readiness score with visible components, `demo_5min.yaml` with per-segment speeds. If time remains: landing orthostatic WARNING, BMD trend chart | `demo_5min` plays through twice without touching anything |
| T+27 to 30 | **Freeze.** No new features. Rehearse, record the video, README with run steps, slides, submit | Submitted with an hour to spare |

## 4. If behind schedule

Cut in this order, top first:

1. Landing orthostatic scenario and the BMD trend chart
2. BASELINE z-score rule
3. Recommendation round trip (keep the delayed ground view)
4. CrewDetail charts (keep sparklines on the overview cards)
5. EVA readiness score (keep the compound alert)

Never cut: the SPE emergency flow, the delayed ground view, alert evidence, unverified-limit markers, the freeze block.

If Gate 2 is not met by T+11, drop the ground console to a single "ground view" panel on the crew page and spend the saved hours on the SPE flow.

## 5. If ahead of schedule

In this order:

1. Context-branching compound rule: tachycardia + headache points to CO₂ when cabin ppCO₂ is over its limit, and to hydration when it is not
2. 30-second reaction-time test that feeds the cognitive readiness score
3. Verify three or four limits against the NASA-STD-3001 PDFs and flip them to `verified: true`, so the demo shows both states of the marker
4. `arrhythmia` scenario

## 6. Open items

- Submission deadline and required format (video length, slides, repo link) are not in the folder. Confirm them in the first hour; they decide how long the freeze block needs to be.
- `EXTRACTNOTION.txt` is empty.
- `AGENTS.md` §2, §5 and §7 and `PRD.md` §13 still describe the full-size plan and need updating to match section 2 above before agents start building.
