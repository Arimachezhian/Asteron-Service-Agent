# The complete checklist — everything, start to finish, GitHub included

This is the one file to follow. It covers everything currently in this
zip — every round of changes made this session — in the correct order.
You don't need to read `AGENT2_DEPLOY.md`, `LEAD_AGENT_V2_UPGRADE.md`,
`LEAD_QUEUE_PRESCORING.md`, or `QUEUE_POLISH_UPDATE.md` in sequence to
figure out what to run; they're kept in the zip only as background on
*why* things changed, useful if a judge asks. This file is the *what to
run*, once, top to bottom.

**Total time: ~10-15 minutes**, plus however long you spend eyeballing
the result before pushing.

---

## 0. Get the code in

**Preserve your GitHub connection first:**
- File Explorer → View tab → turn on "Hidden items"
- Open your current `asteron-worker` folder, copy the `.git` folder to your Desktop

**Swap the folder:**
- Rename your current `asteron-worker` to `asteron-worker-OLD` (don't delete yet)
- Unzip the new `asteron-retention-agent.zip`, rename the extracted folder to `asteron-worker`
- Copy the `.git` folder from your Desktop back into the new `asteron-worker`

**Verify the connection survived:**
```
git status
```
You should see a long list of modified/new files, and **no** "not a git
repository" error.

## 1. Install and sanity-check

```
npm install
npm test
```
Expect: `16 passed`, `22 passed`, `12 passed`, and **four**
`ALL CHECKS PASSED` blocks. This works immediately — the zip ships with
a clearly-labeled placeholder dataset so testing doesn't depend on a
live Worker yet.

## 2. Redeploy the Worker

Real backend logic changed across several rounds since you last
deployed (dealer routing, High/Medium/Low scoring, automatic
first-contact sending) — this step is not optional this time:
```
npx wrangler deploy
```
Same URL as always (fixed in `wrangler.toml`):
```
https://asteron-retention-agent.aces4iimb.workers.dev
```
Quick check:
```
https://asteron-retention-agent.aces4iimb.workers.dev/health
```
Should show `"gemini": true, "groq": true`.

## 3. Score every lead for real

This calls your live Worker for genuine Gemini/Groq scoring on all 14
flagged leads — replaces the placeholder data with the real thing:
```
npm run score:leads -- --worker-url=https://asteron-retention-agent.aces4iimb.workers.dev
```
Takes ~15-20 seconds. Watch each lead's real score print as it happens.

## 4. Build the dashboard with real data baked in

```
npm run build:dashboard -- --worker-url=https://asteron-retention-agent.aces4iimb.workers.dev
```

## 5. Test locally — actually look at it before pushing anything

Open `dashboard/index.html` directly in your browser.

**Retention tab:** click a job, run a diagnosis, confirm it still works.

**Lead Response tab:**
- Score badges (HIGH/MEDIUM/LOW) should already be sitting on tickets —
  zero clicks needed
- Click into an auto-sent lead — read-only message, no approve button
- Click into one flagged for review (if any came back that way) —
  normal Approve/Edit/Reject controls
- Try the **sort dropdown** — Newest first / Score / Most overdue —
  confirm the order actually changes
- Click **"+ Simulate new lead"** a couple of times — each one should
  land at the **top** of the queue under the default "Newest first"
  sort, and score itself automatically within a couple of seconds
- Eyeball the overall mix of SLA badges — should be mostly green/fresh
  with only a few genuinely overdue, not a wall of red. If it looks
  wrong, it's because time has passed since the dataset was generated —
  see the note at the bottom of this file.
- Click **"Test connection"** at the top — should go green

## 6. Push to GitHub

```
git add .
git commit -m "Full lead-agent rebuild: scoring, dealer routing, auto-send, sortable pre-scored queue"
git push
```

Wait 30-60 seconds for GitHub Pages to rebuild, then open your live link:
```
https://arimachezhian.github.io/Asteron-Service-Agent/dashboard/
```

**If the push or the Pages build hangs or fails** — don't stack
retries. Check the Actions tab, confirm nothing is still "in progress"
before trying again once, cleanly. (This bit us earlier in the session;
patience on this one specific step matters more than speed.)

**Confirm on the live link, not just locally:**
- Both tabs load
- "Test connection" goes green
- The lead queue shows pre-scored tickets with score badges, same as
  your local test

## 7. Delete `asteron-worker-OLD`

Once everything above checks out.

---

## One thing worth remembering going forward

The lead dataset's "hours since qualified" is baked in at generation
time, not computed live — so the fresh/overdue mix quietly drifts more
overdue the longer you wait between generating it and actually
recording. If you take a break of more than an hour or two before your
final recording, regenerate fresh right before you record:
```
node data/build_leads_dataset.mjs
node detection/detect_leads.mjs
npm run score:leads -- --worker-url=https://asteron-retention-agent.aces4iimb.workers.dev
npm run build:dashboard -- --worker-url=https://asteron-retention-agent.aces4iimb.workers.dev
git add .
git commit -m "Refresh lead timing before recording"
git push
```
