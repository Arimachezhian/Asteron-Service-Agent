# Lead agent v2 — scoring, automatic first contact, dealer-integrated messaging

This replaces the ENTIRE project folder, not individual files — this round
touched ~10 interdependent files in the lead-agent pipeline at once
(playbook, schema, prompt, validation, Worker routing, dashboard,
tests), and they all have to agree with each other. Safer to swap the
whole folder than hand-pick files this time.

## What actually changed, conceptually

**1. Lead scoring is now explicit High/Medium/Low**, not the old 4-tier
critical/high/standard/nurture system. Same AI-driven judgment call
underneath (Gemini/Groq weighing conflicting signals — segment value,
urgency, engagement history), just a simpler, more visible taxonomy. It
shows up on screen labeled "Lead score."

**2. The first-contact acknowledgment now sends automatically** — no
dealer click required — the instant a lead is scored, *provided
validation passes with no flags*. That "provided" is the one deliberate
compromise from your literal spec, explained in chat when this was
built: a generic "thanks for your interest, [dealer] will call you
within [SLA]" message is low-stakes enough to fully automate (real
dealer CRMs already do this today), but the same validation net that's
caught real issues in testing all night (fabricated evidence, wrong
channel, mismatched action) stays active as the one thing that can
still route a specific message to human review instead of sending it
broken. `computeAutoSend()` in `src/lead_validate.js` is the single,
auditable place this decision gets made.

**3. The drafted message now names the actual matched dealer** — dealer
routing (deterministic, no AI, unchanged from the last round) now runs
*before* the AI call, and its result gets fed into the prompt, so the
acknowledgment says "a specialist from Asteron Hub Whitefield will call
you," not "someone will call you."

**4. SLA mechanism is unchanged** from the last round — countdown
badges, the fast-forward demo control, the tier-based inferred response
window. Still there, untouched by this round's changes.

## What you'll see in the dashboard now

- **"Lead score: HIGH / MEDIUM / LOW"** with evidence and a confidence bar
- A green **"✓ First-contact message sent automatically"** banner on
  clean results — no Approve/Edit/Reject buttons, since there's nothing
  left to approve. The sent message shows read-only underneath.
- If something's flagged instead, you'll still see the familiar
  Approve/Edit/Reject controls — same as before, that path didn't change
- The recommended dealer panel, unchanged from last round, still shows
  under the score
- The metrics strip now tracks **"Auto-acknowledged"** as a live count
  alongside leads scored and scored HIGH

## Redeploy steps

**1. Preserve your GitHub connection first.** In File Explorer, turn on
"Hidden items" (View tab), open your current `asteron-worker` folder,
and copy the `.git` folder somewhere safe (Desktop is fine).

**2. Swap the folder.** Rename your current `asteron-worker` to
`asteron-worker-OLD` (don't delete yet). Unzip the new
`asteron-retention-agent.zip`, rename the extracted folder to
`asteron-worker`.

**3. Restore the connection.** Copy the `.git` folder from your Desktop
back into the new `asteron-worker` folder.

**4. Verify it worked.** Open a terminal inside the new folder:
```
git status
```
You should see a long list of modified/new files — that's expected,
plenty actually changed — and critically, **no "not a git repository"
error**. That confirms the GitHub link survived the swap.

**5. Install and test:**
```
npm install
npm test
```
Expect `16 passed`, `22 passed`, `12 passed`, and four `ALL CHECKS
PASSED` blocks.

**6. Redeploy the Worker** (real backend logic changed this time):
```
npx wrangler deploy
```

**7. Rebuild the dashboard** with your real Worker URL:
```
npm run build:dashboard -- --worker-url=https://asteron-retention-agent.aces4iimb.workers.dev
```

**8. Test locally first.** Open `dashboard/index.html`, Lead Response
tab, pick any lead, click "Run triage." Confirm you see a score
(HIGH/MEDIUM/LOW), the auto-sent banner (or, occasionally, a flagged
result needing review — both are correct, expected behavior), and the
message referencing a real dealer by name.

**9. Push to GitHub:**
```
git add .
git commit -m "Lead agent v2: High/Medium/Low scoring, automatic first contact, dealer-integrated messaging"
git push
```

**10. Delete `asteron-worker-OLD`** once everything above checks out.

## One thing worth trying live during testing

Trigger the review-flag path on purpose, so you've actually seen both
outcomes before recording: use "Fast-forward" on a lead with only one
contact method (phone-only or email-only), a few times in a row, to
increase the odds the model drafts a channel mismatch or something
else validation catches — confirms the safety net is real, not just
theoretical.
