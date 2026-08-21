# Memory — Hello SUNA

<!-- Durable facts about this project that an agent should not have to rediscover. Append; do not rewrite history. -->

- Figure 1 (`figures/hello/`) is hand-drawn on purpose and has no `source/`.
  Do not "fix" this by generating it — Reviewer #1's point 4 is about it.
- Figure 2 (`figures/timesheet/`) is generated. Edit `source/plot.py` and rerun
  it; never hand-edit `figure.svg` or the `.suna.json` manifest beside it.
- The slopes quoted in Results come from `results/happiness_fit.json`. If the
  data change, rerun `analysis/fit_happiness.py` before touching the prose.
- `hunter2007` is cited only from the supplement, so the supplement's reference
  list numbers independently of the main paper's. That is deliberate.
- The unanswered `dataLocation` assertion in `manuscript/letters/cover.json` is
  left for a human. An agent may draft the argument; it may not sign the
  affidavit.
