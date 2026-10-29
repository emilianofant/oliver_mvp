# Task 23: Test & CI Seed (Planned — Post-Publish Priority)

**Priority note:** not a publish gate — the readiness audit rates the missing test suite as WARN, not FAIL. Scope is pinned here now so the README "Where I'd take it next" testing item has a concrete target; implement **after the repo is public** unless the owner reorders.

## 1. Goal
Add a minimal but real tests+CI seed proving the two properties reviewers care about most: (a) `metrics.py` determinism and contract on a fixture, (b) endpoint guard behavior — with GitHub Actions running both so anyone cloning sees green checks.

## 2. Scope & Target Files
- **Python**: new test file for metrics.py (`python/tests/test_metrics.py`, plain pytest): golden-file round trip over one small **synthetic** fixture analysis.json + court config → run the script → assert output key set, byte-identical re-run (the docstring's determinism claim), and fail-fast exit 1 on a missing-field config. A few dozen frames suffice; nothing from `data/` or `samples/` ever enters git.
- **Node**: new supertest file for the server guard probes — traversal sources → proper 400/404 shapes, non-.mp4 upload filter rejection, trim numeric validation (the exact families already proven by hand in the readiness audit area 4). If `server/server.js` doesn't export the app cleanly yet, allow the one guarded refactor: `module.exports = app` with `listen` under a `require.main === module` check — the only server.js edit permitted here.
- **CI**: `.github/workflows/ci.yml` — two jobs (python: venv + pytest; node: `npm ci` in both apps + supertest), on push/PR to main. CI installs `pytest` separately (`pip install pytest`) — **do not** add it to the runtime `requirements.txt` line used by the Docker image.

## 3. Constraints & Guardrails
- Tests pin existing behavior only — no test-driven refactors of production logic. If a probe exposes a real bug, STOP and report it (attach findings); do not change endpoint or engine semantics inside this ticket.
- No new dependencies beyond pytest + supertest; no coverage tooling, no docker-in-docker testing (YAGNI).
- Fixture data stays synthetic — privacy rules unchanged: nothing under `samples/` or `data/`, ever.

## 4. Acceptance Criteria
- [ ] `pytest` green locally on the committed fixture; the determinism assertion genuinely re-runs twice and compares bytes.
- [ ] supertest probes pass for all three guard families (traversal, upload filter, trim validation) against an ephemeral port.
- [ ] GitHub Actions runs both jobs green on a test branch before merge.
- [ ] `git status`: new files plus at most the app-export tweak in `server/server.js`; diff review confirms zero behavior changes to endpoints/engine.
- [ ] README "Where I'd take it next" testing line updated from *planned* to shipped (one-line edit, same branch).
- [ ] Merged via `git merge --no-ff task/23-tests-ci-seed`, tagged `task-23-done`; branch deleted post-merge.
