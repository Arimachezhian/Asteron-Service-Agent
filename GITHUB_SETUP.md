# GitHub setup — team repo, hosted dashboard, nightly detection job

Do this after you've deployed the Worker (QUICKSTART.md steps 1-9) so
the dashboard you push already has your live Worker URL baked in. If
you haven't deployed yet, that's fine too — just come back and re-run
step 9 of QUICKSTART.md, then `git add`, commit, and push again before
the demo.

---

## 1. Create the repo

1. Go to **github.com/new** (sign up first if you don't have an
   account — free).
2. Repository name: `asteron-retention-agent` (or whatever you like).
3. Keep it **Public** — GitHub Pages hosting (step 4) is free and
   simplest on a public repo. Nothing sensitive is in this folder (no
   API keys — those live only in Cloudflare, never in these files).
4. Don't check "Add a README" — you already have one. Click **Create
   repository**.

GitHub will show you a page with setup commands — ignore it, use the
ones below instead (they're specific to a folder you already have
locally, not a fresh empty one).

## 2. Push this folder to it

Check if you have git first:
```
git --version
```
If "command not found": Mac usually prompts to install it automatically
the first time you run a git command; on Windows, install **Git for
Windows** from git-scm.com, then reopen your terminal.

From inside the `asteron-worker` folder:
```
git init
git add .
git commit -m "Retention agent: Worker + dashboard + dataset + detection"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/asteron-retention-agent.git
git push -u origin main
```
(Swap in your actual GitHub username and repo name from step 1.) It may
open a browser window asking you to log in and authorize — accept it.

Refresh the GitHub repo page in your browser — you should see all your
folders (`src/`, `dashboard/`, `data/`, etc.).

## 3. Add your teammates

Repo page → **Settings** → **Collaborators** → **Add people** → enter
their GitHub username or email. They'll get an invite email. Once
accepted, they can `git clone` the repo and push changes the same way
you just did.

## 4. Turn on GitHub Pages (a real link for the dashboard)

1. Repo page → **Settings** → **Pages** (left sidebar).
2. Under "Build and deployment," **Source: Deploy from a branch**.
3. **Branch: `main`**, folder: **`/ (root)`** → **Save**.
4. Wait about a minute, then refresh the Pages settings page — it'll
   show a link like:
   ```
   https://YOUR-USERNAME.github.io/asteron-retention-agent/
   ```
5. Your dashboard specifically is at:
   ```
   https://YOUR-USERNAME.github.io/asteron-retention-agent/dashboard/
   ```
   Bookmark that — it's what you open on any laptop or projector for
   the demo, no local file needed.

## 5. One easy-to-miss setting for the nightly detection job

By default, GitHub sometimes gives Actions **read-only** permission,
which will make `.github/workflows/detect.yml` fail silently when it
tries to commit the updated flagged-customer list back to the repo.
Check this now:

1. Repo page → **Settings** → **Actions** → **General**.
2. Scroll to **"Workflow permissions."**
3. Select **"Read and write permissions."**
4. **Save.**

Then test it manually rather than waiting for 2am:

1. Repo page → **Actions** tab → click **"Nightly retention detection"**
   in the left list.
2. Click **"Run workflow"** (dropdown on the right) → **Run workflow**.
3. Wait ~15 seconds, refresh — you should see a green checkmark. Click
   into the run to see the detection output in the logs.

If it's set up to run on schedule already (it is — 2am UTC / 7:30am
IST daily), you don't need to do anything else; it'll just run.

## 6. Keeping it in sync as you keep working

Every time anyone changes a file locally:
```
git add .
git commit -m "describe what changed"
git push
```
Every time someone else has pushed changes you don't have yet:
```
git pull
```

If you rebuild the dashboard with a new Worker URL or new flagged data
(`npm run build:dashboard` or `npm run build:data`), remember to `git
add`, commit, and push again — GitHub Pages only shows what's actually
been pushed.

---

## Quick sanity check that everything's connected

Open `https://YOUR-USERNAME.github.io/asteron-retention-agent/dashboard/`
in a browser. If the Worker URL field is already filled in and "Test
connection" goes green, you're fully wired: GitHub Pages → dashboard →
Cloudflare Worker → Gemini/Groq, all live.
