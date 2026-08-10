# Pre-scored queue — scoring runs before the dashboard loads, not on a click

This is the follow-up to `LEAD_AGENT_V2_UPGRADE.md` (still worth reading
if you skipped it — this builds on that round's High/Medium/Low scoring
and automatic first-contact). This round changes **when** scoring
happens, not what it decides.

## What changed

**Before:** the queue opened with every lead marked "Pending." A dealer
had to click into each one and hit "Run triage" before anything
happened — which is exactly the symptom you flagged: leads sitting
there overdue with no message sent, because nothing runs until someone
clicks.

**Now:** a new script, `detection/score_leads.mjs`, calls your real
deployed Worker for every flagged lead **before** the dashboard gets
built — genuine Gemini/Groq calls, not mocked, just moved earlier in
the pipeline. By the time anyone opens the dashboard, every lead
already shows its score (High/Medium/Low, right on the ticket in the
queue) and, where nothing needed a second look, its first-contact
message has already gone out. The only leads that still need a human
click are the genuine exceptions: missing contact info, or something
validation flagged.

"Simulate New Lead" and "Fast-forward" still trigger live, on-demand
calls exactly as before — that's intentional, those two exist
specifically to show the live process happening on camera. This change
only affects the baseline queue.

## Also removed, per your feedback

- The "Case baseline: 16h / 32%" panel — gone. Replaced with a plain
  explanation of what the queue is doing ("every lead is evaluated the
  moment it's captured...") and a live High/Medium/Low/Auto-acknowledged
  breakdown of what's actually sitting in the queue right now — not a
  count of button-clicks from "this session."

## One thing I need to flag honestly

To test the dashboard's rendering, I needed *some* pre-scored data
baked in, but I have no way to call your real deployed Worker from my
side. The version I'm shipping you includes a placeholder
`data/scored_leads.json` — every evidence string, message, and
rationale in it is literally the text `[PLACEHOLDER — NOT REAL AI
OUTPUT]`, on purpose, so there's no chance of mistaking it for genuine
output if you open the dashboard before regenerating it. **You must
run the real scoring step below before this reflects anything real.**

## Updated deploy sequence

Steps 1-6 are unchanged from before (unzip, `npm install`, `npm test`,
`wrangler deploy`). **New step inserted before the dashboard build:**

**1-6.** Same as `LEAD_AGENT_V2_UPGRADE.md` — swap the folder (preserve
`.git`), `npm install`, `npm test`, `npx wrangler deploy`.

**7. Score every lead for real** (NEW — this is the step that replaces
the placeholder data with genuine AI output):
```
npm run score:leads -- --worker-url=https://asteron-retention-agent.aces4iimb.workers.dev
```
Takes about 15-20 seconds for 14 leads (paced deliberately, not
parallel, to avoid re-triggering a rate limit). You'll see each lead's
real score print as it happens:
```
  LEAD-3001: needs dealer input before scoring can even start (n/a, ...)
  LEAD-3003: HIGH — auto-sent (groq-llama-3.3-70b, 1180ms)
  ...
Wrote data/scored_leads.json
  11 auto-acknowledged, 1 flagged for review, 2 need dealer input before scoring can run at all.
```

**8. Build the dashboard** (now reads the real scored data automatically):
```
npm run build:dashboard -- --worker-url=https://asteron-retention-agent.aces4iimb.workers.dev
```
If you skip step 7, this will now refuse to build and tell you exactly
what to run first — it won't silently ship placeholder data.

**9. Test locally.** Open `dashboard/index.html`, Lead Response tab —
you should see score badges already sitting on tickets, no clicks yet.
Click into one that auto-sent: read-only sent message, no approve
button. Click into one flagged for review (if any came back that way):
normal Approve/Edit/Reject controls, same as before.

**10. Push:**
```
git add .
git commit -m "Lead queue pre-scores automatically before load, case-baseline metrics removed"
git push
```

## Re-scoring later

If you regenerate the lead dataset, or just want fresh scores closer to
recording time, re-run steps 7-8 (score, then build) and push again.
`score_leads.mjs` always calls your live Worker fresh — nothing gets
cached or reused from a prior run.
