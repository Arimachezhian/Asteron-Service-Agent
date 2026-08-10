# Queue polish — sorting, fast-forward removed, overdue rebalanced

No Worker changes this round — `wrangler deploy` is NOT needed. Only
the lead dataset and dashboard changed, so the steps below are shorter
than previous rounds.

## What changed

1. **Sort dropdown added** to the lead queue — "Newest first" (default),
   "Score: High → Low", "Most overdue first."
2. **Simulate New Lead fixed** — it was backdating new leads by a random
   amount up to 30 hours, which is why they never appeared at the top.
   Now stamped with the real current time, so under the default sort
   they land at the top, every time.
3. **Fast-forward removed entirely** — buttons, function, all gone.
4. **Overdue timing rebalanced** — only 3 of 14 flagged leads now show
   genuine overdue status (1-2h over, not dramatic), most sit
   comfortably within their SLA window, and the 3 intentionally-cold
   leads (testing the "gone cold" / LOW-score path) are unchanged, as
   you said was fine to keep.

## One thing that matters for your recording specifically

Every lead's "hours since qualified" is computed from a **fixed
timestamp set at dataset-generation time** — it's not dynamic. That
means the "fresh vs. overdue" balance you see right now will keep
drifting further toward "overdue" the longer you wait, exactly like
what happened this session (checked mid-session and found 18/18 leads
had drifted into overdue, purely from real time passing while we
worked).

**Practical implication: regenerate the dataset shortly before you
actually record**, not hours ahead of time:
```
node data/build_leads_dataset.mjs
node detection/detect_leads.mjs
```
Then re-score and rebuild (see below) so what's on screen during
recording reflects the intended fresh mix, not a stale one.

## Steps

**1.** Swap in the new files (same folder-swap approach as before,
preserving `.git`), or manually replace: `data/build_leads_dataset.mjs`,
`data/leads.json`, `data/flagged_leads.json`, `dashboard/index.template.html`,
`test/dashboard_new_features_test.mjs`.

**2.**
```
npm install
npm test
```
Expect `16 passed`, `22 passed`, `12 passed`, four `ALL CHECKS PASSED`
blocks (Worker bundle unaffected — no need to re-check that separately).

**3. Re-score against your already-deployed Worker** (no redeploy
needed, it's unchanged — just re-running scoring against the new
dataset):
```
npm run score:leads -- --worker-url=https://asteron-retention-agent.aces4iimb.workers.dev
```

**4. Rebuild the dashboard:**
```
npm run build:dashboard -- --worker-url=https://asteron-retention-agent.aces4iimb.workers.dev
```

**5. Test locally.** Lead Response tab — confirm the sort dropdown
works, click "Simulate new lead" a couple of times and confirm each one
lands at the top under "Newest first," and eyeball the queue's overall
overdue/fresh balance.

**6. Push:**
```
git add .
git commit -m "Queue sorting, remove fast-forward demo control, rebalance overdue timing"
git push
```
