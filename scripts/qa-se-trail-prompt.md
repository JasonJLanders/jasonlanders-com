# QA Agent Prompt — SE Trail

You are a QA agent for `field-ready/se-trail/index.html`. Read this file completely before doing anything.

## Step 1: Run the automated check script

```
node scripts/qa-se-trail.js
```

Read the output carefully. Fix every FAILURE. Treat WARNINGS as worth investigating.
Do NOT report a check as passing unless the script output explicitly shows ✓ for it.

## Step 2: Evidence-based manual checks

For each item below, you MUST provide the exact line number and quoted text as evidence.
Do not write "confirmed" or "looks good" — quote the actual code.

### 2A — Em-dash verification (belt AND suspenders)
Run this and report the exact count:
```
node -e "const f=require('fs').readFileSync('field-ready/se-trail/index.html','utf8'); const m=f.match(/\u2014|&mdash;|&#8212;/g)||[]; console.log('Em-dashes found:',m.length);"
```
Count must be 0. If not 0, fix them all.

### 2B — Font size verification
Search for all `fontSize:` values inside OnboardingScene (between `class OnboardingScene` and the next `class `).
List every unique fontSize value found. Flag any under 14px as a potential readability issue.
Provide the line numbers.

### 2C — Notification system check
Search for `showStackedNotif` and confirm:
- It exists as a method on CityScene
- `notifQueue` is initialized in `createNotification()`
- `showInboxNotif` calls `showStackedNotif` (not the old inline code)
- `showCompetitorAlert` calls `showStackedNotif`
Quote the relevant lines with line numbers.

### 2D — Badge color and position
Search for the badge/dot drawing code in `createAvailabilityGlow`.
Confirm: color is `0xff3333` (not building color).
Confirm: position uses `b.x + b.w - 8` and `b.y + 8` for center.
Quote the lines.

### 2E — Energy bar update
Search for every place `STATE.energy` is assigned (modified, not just read).
For each one, confirm that a feedback message or HUD redraw follows within 3 lines.
List all assignment locations with line numbers.

### 2F — Vertex encounter scenario
Search for `vertex_encounter` in the SCENARIOS array.
Confirm: `location: 'The Corner'`, `act: 1`, at least 3 choices.
Quote the scenario definition.
Also confirm `STATE.vertexInPlay = true` is set somewhere after the choice is made.

### 2G — Character silhouettes
Confirm `createCharacterSilhouettes` exists and is called in `CityScene.create()`.
Confirm it draws two graphics objects in different colors.
Confirm it has at least one tween for idle animation.
Note: silhouettes should be near HQ building, NOT floating in the middle of the map.
Quote the relevant section.

### 2H — Onboarding text
Search `renderPanel3` for the updated location descriptions.
Confirm "Meet Alex here" is NOT present.
Confirm updated Corner text IS present (should mention AE / coffee / strategy).
Confirm updated Vertex text IS present (should mention rival / Axiom deal / car).
Quote the exact strings.

## Step 3: Fix what you can

Fix any failures from Step 1 or Step 2. After fixing, re-run the script to confirm it passes.

## Step 4: Write QA report

Write `scripts/qa-report-se-trail.md` with:
- Script output (copy the full terminal output)
- Evidence for each 2A-2H check (line numbers + quoted text)
- List of fixes applied (with before/after)
- List of anything that could NOT be verified automatically (visual/runtime)

## Step 5: Commit

```
git add field-ready/se-trail/index.html scripts/qa-report-se-trail.md
git commit -m "QA pass: se-trail fixes and verification"
git push
```

Then run:
```
node scripts/qa-se-trail.js
```
Paste the final output at the end of qa-report-se-trail.md and re-commit if changes were needed.
