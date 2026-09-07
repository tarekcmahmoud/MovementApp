# Bodyweight Ladders

A progression tracker for bodyweight strength training, built on the community
chart *Bodyweight Fitness Progressions* v5.4 by u/shellerik. 244 exercises across
8 categories and 37 ladders, with prerequisites that cross between them.

Installable PWA. No build step, no dependencies, no backend. Your data stays on
your device.

- **Ladders** — browse the progressions and mark what you can hold
- **Priority** — pick up to 4 goals and see the whole route there, in order
- **Build** — compose workouts from blocks and supersets
- **Log** — run a session, then get offered the rungs you just earned

## Run it locally

There is no Node or Python on the dev machine, so the server is PowerShell:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8123
```

Then open <http://localhost:8123/>. Service workers and `localStorage` need a
real HTTP origin, so `file://` will not work.

## Get it onto an Android phone

The app has to be served over HTTPS to be installable. GitHub Pages is free and
enough.

**1. Create an empty repo.** Go to <https://github.com/new>, name it
`bodyweight-ladders`, and create it **without** a README or .gitignore. Public or
private both work — Pages needs Public on a free account.

**2. Push this folder to it.** From the project directory, substituting your
username:

```bash
git remote add origin https://github.com/YOUR-USERNAME/bodyweight-ladders.git
git branch -M main
git push -u origin main
```

Git for Windows will open a browser window to sign you in to GitHub the first
time. Do that yourself — never paste a token or password into a chat.

**3. Turn on Pages.** In the repo: **Settings → Pages**. Under "Build and
deployment", set Source to **Deploy from a branch**, branch **main**, folder
**/ (root)**, and Save. First build takes a minute or two.

Your URL will be:

```
https://YOUR-USERNAME.github.io/bodyweight-ladders/
```

**4. Install it on the phone.** Open that URL in **Chrome on Android**, then
either tap the "Install" prompt, or use **⋮ → Add to Home screen → Install**.
You get a real launcher icon, no browser chrome, and it works offline.

> Load it once while online so the service worker can cache the shell and the
> Barlow font. After that it runs with no signal.

## Moving your data over

Your progress lives in `localStorage` per device — installing on the phone starts
it fresh, seeded with the snapshot in `docs/HANDOVER.md` §7.

To carry real data across, open the **Build** tab and scroll to
"Back up and move data":

- **Copy backup** / **Download file** on the device that has your data
- **Restore from text** on the new one — paste and confirm

That panel is also your only backup. Clearing Chrome's site data for the app
wipes everything, so download a copy occasionally.

## Deploying an update

```bash
git add -A && git commit -m "..." && git push
```

Pages redeploys on push. **Bump `CACHE` in `sw.js`** whenever you change
`app.js`, `styles.css`, `chart.json` or `index.html` — otherwise installed phones
keep serving the cached shell and will not see the update.

## Provenance, and what not to trust

Some of `chart.json` is transcribed from the published source and some is
inferred or invented. **Milestone flags are placeholders, not real data**, and the
chart's four difficulty tiers were never captured. Both are carried by cell colour
in the original sheet.

Read [CLAUDE.md](CLAUDE.md) before editing the chart, and
[docs/HANDOVER.md](docs/HANDOVER.md) for why the app is shaped the way it is.

## Credits

Chart: *Bodyweight Fitness Progressions* v5.4 by u/shellerik (March 2019),
derived from *Overcoming Gravity* 2nd ed. by Steven Low, the
r/bodyweightfitness Recommended Routine and Exercise Wiki, and Antranik.
