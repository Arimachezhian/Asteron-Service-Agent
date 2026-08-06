# Adding the lead-response agent — what's actually new to do

You've already done the hard parts once (Node, npm, API keys, wrangler
login, GitHub). This is just the delta: get the updated code deployed.

No new API keys needed — the lead-response agent reuses the exact same
GEMINI_API_KEY / GROQ_API_KEY secrets you already set on the Worker.

---

## 1. Replace your project folder

Unzip the new `asteron-retention-agent.zip` and swap it in for your old
`asteron-worker` folder (or just copy the new/changed files over — either
works, but a clean swap is less error-prone). If you had a `.git` folder
inside your old one, copy that back in afterward so you don't lose your
GitHub connection — or just re-run `git remote add origin ...` again if
it's simpler.

## 2. Install and test

```
npm install
npm test
```
Expect: `16 passed, 0 failed`, `15 passed, 0 failed`, and three
`ALL CHECKS PASSED` blocks. That last one specifically covers the new
lead-response tab.

## 3. Redeploy the Worker

Same command as before — it now includes the new `/triage` route
alongside the existing `/diagnose`:
```
npx wrangler deploy
```
You'll get the same URL you had before (`wrangler.toml` keeps the Worker
name fixed) — no need to update anything that references it.

Quick check:
```
https://asteron-retention-agent.YOUR-SUBDOMAIN.workers.dev/health
```
Should still show `"gemini": true, "groq": true` — same secrets, same
Worker, just more code behind it now.

## 4. Rebuild the dashboard

```
npm run build:dashboard -- --worker-url=https://asteron-retention-agent.YOUR-SUBDOMAIN.workers.dev
```
(Your real URL, no trailing slash.)

## 5. Test locally before pushing

Open `dashboard/index.html` directly in your browser. You should now
see **two tabs** at the top: "Retention Agent" and "Lead Response
Agent." Click the second one — you'll see a queue of flagged leads.
Click one, click "Run triage," and watch for:
- The "📡 Calling Gemini live..." loading message
- A live diagnosis coming back with a `● Live AI call — gemini-2.5-flash
  · responded in X.Xs` badge
- "View raw agent response" — click to expand and see the actual JSON
  Gemini returned

## 6. Push to GitHub

```
git add .
git commit -m "Add lead-response agent (Problem 1) with tabbed dashboard"
git push
```
Wait ~30-60 seconds for GitHub Pages to rebuild, then refresh your live
link:
```
https://YOUR-USERNAME.github.io/asteron-retention-agent/dashboard/
```
You should see both tabs live, same as your local test.

---

## For the recording

A clean sequence that shows both agents are real, not scripted:
1. Open the live GitHub Pages link (not a local file — shows it's genuinely hosted)
2. Retention tab: click a job, run diagnosis, point out the confidence score and evidence
3. Switch to the Lead Response tab
4. Click a flagged lead, run triage, and this time **pause on the loading
   state** for a second before it resolves — that visible wait, plus the
   "responded in X.Xs" badge afterward, is what makes it obviously live
5. Expand "View raw agent response" once, briefly — shows there's real
   structured JSON behind the pretty UI, not a mock
6. Click through Approve on one, Reject on another — shows the human
   approval gate is real, not decorative

If anything doesn't work when you get there, come back to this chat —
I'll still have the full working state to debug against.
