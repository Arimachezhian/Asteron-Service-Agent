# Quickstart — from zip file to working agent

Follow this top to bottom, in order. Each step says what to type and what
"it worked" looks like. If a step fails, stop and fix it before moving on
— later steps depend on earlier ones.

Total time: ~20-30 minutes, most of it waiting for installs.

---

## 0. Unzip

Unzip `asteron-retention-agent.zip` somewhere sensible (Desktop is fine).
You should get one folder, `asteron-worker/`, containing `src/`, `data/`,
`dashboard/`, `detection/`, `test/`, and a few config files. Everything
below assumes your terminal is open **inside that folder**.

You can delete any of the loose individual files you downloaded earlier
(the ones named `index.js`, `index.html`, `build.mjs`, etc. sitting
directly in your Downloads folder) — this zip replaces all of them with
the correct folder structure.

## 1. Install Node.js (skip if you already have it)

Open a terminal (Mac: Terminal app. Windows: PowerShell or Command
Prompt) and type:
```
node --version
```
If you see something like `v20.x.x` or `v22.x.x`, skip to step 2. If you
see "command not found," install Node from **nodejs.org** — download
the LTS version, run the installer, restart your terminal, and try
`node --version` again.

## 2. Open a terminal in the project folder

- **Mac:** right-click the `asteron-worker` folder → "New Terminal at
  Folder" (or open Terminal and type `cd ` then drag the folder in, then
  press Enter).
- **Windows:** open the `asteron-worker` folder in File Explorer, click
  the address bar, type `cmd`, press Enter.

Confirm you're in the right place:
```
npm --version
```
Any version number means you're good.

## 3. Install dependencies

```
npm install
```
Takes 10-20 seconds. It worked if it ends with something like `added
119 packages` and no red "error" text.

## 4. Run the tests

```
npm test
```
You should see `16 passed, 0 failed` and two `ALL CHECKS PASSED` blocks.
This confirms the logic works correctly on your machine — nothing to do
with the internet yet, just proving the code itself is sound.

## 5. Get two free API keys

These let the agent actually think. Both are free, no credit card.

**Gemini (primary):**
1. Go to **aistudio.google.com**, sign in with a Google account.
2. Click "Get API key" → "Create API key."
3. Copy the key somewhere safe (a notes app) — you'll paste it in step 7.

**Groq (fallback, used only if Gemini has an issue):**
1. Go to **console.groq.com**, sign up.
2. Find "API Keys" in the left menu → "Create API Key."
3. Copy that key too.

## 6. Install and log into Cloudflare's tool

```
npx wrangler login
```
This opens a browser tab asking you to log into (or sign up for) a free
Cloudflare account, then click "Allow." Once you see "Successfully
logged in" in the terminal, close the browser tab.

## 7. Give the Worker your API keys

```
npx wrangler secret put GEMINI_API_KEY
```
It'll prompt you to paste the key — paste it (it won't show on screen,
that's normal) and press Enter.

```
npx wrangler secret put GROQ_API_KEY
```
Same thing with the Groq key.

## 8. Deploy the Worker

```
npx wrangler deploy
```
Takes a few seconds. Look for a line like:
```
https://asteron-retention-agent.YOUR-SUBDOMAIN.workers.dev
```
**Copy that URL — you need it in the next step.** This is your agent,
now live on the internet.

Quick sanity check — paste this into a browser (swap in your real URL):
```
https://asteron-retention-agent.YOUR-SUBDOMAIN.workers.dev/health
```
You should see JSON like `{"ok": true, "providers_configured": {"gemini": true, "groq": true}}`.
If both say `true`, you're fully wired up.

## 9. Bake your Worker URL into the dashboard

```
npm run build:dashboard -- --worker-url=https://asteron-retention-agent.YOUR-SUBDOMAIN.workers.dev
```
(Use your actual URL from step 8, no trailing slash.)

## 10. Open the dashboard

Find `dashboard/index.html` in the folder and double-click it — it opens
in your browser. The Worker URL field at the top should already be
filled in. Click **"Test connection"** — it should turn green and say
"connected — gemini, groq."

## 11. Run your first live diagnosis

Click any job in the left-hand queue, then click **"Run diagnosis."**
Within a few seconds you'll get either:
- a dealer question (click one of the quick-answer buttons), or
- a full diagnosis: category, evidence, confidence, and a recommended
  action.

That's the whole pipeline running for real — record → completeness
check → Gemini → validation → your screen.

---

## If something breaks

- **`npm install` fails** → make sure you're inside the `asteron-worker`
  folder (step 2), and that Node installed correctly (step 1).
- **`wrangler login` doesn't open a browser** → it prints a URL in the
  terminal; copy-paste that into any browser manually.
- **`/health` shows `"gemini": false`** → the secret didn't save. Re-run
  `npx wrangler secret put GEMINI_API_KEY` and paste the key again,
  carefully (no extra spaces).
- **Dashboard "Test connection" turns red** → double check you copied
  the full URL from step 8 exactly, including `https://`.
- **Diagnosis just spins / never returns** → open your browser's
  developer console (F12 or right-click → Inspect → Console tab) and
  look for a red error — usually a typo in the Worker URL.

## What to do next (once this works)

- Put this whole folder in a GitHub repo, then turn on **GitHub Pages**
  for it (repo Settings → Pages → deploy from the `dashboard/` folder)
  so the dashboard has a real shareable link instead of a local file —
  useful for the judged demo.
- Once it's a GitHub repo, the nightly detection job
  (`.github/workflows/detect.yml`) will start running automatically.
- See `README.md` in this folder for the deeper design write-up —
  useful for Q&A prep, not needed to get the demo running.
