# QA Report — jasonlanders.com

**Date:** 2026-04-21  
**Scope:** All newly created HTML files (commits 12d0c55, 127d85e, 84628813)  
**Reviewer:** QA automated review

---

## Files Reviewed

### Articles (10 from commit 12d0c55)
- `articles/ai-tools-for-ses-right-now.html`
- `articles/building-technical-champions.html`
- `articles/competitive-deals-for-ses.html`
- `articles/discovery-that-actually-works.html`
- `articles/handling-technical-objections.html`
- `articles/how-to-run-a-great-demo.html`
- `articles/se-comp-and-career.html`
- `articles/se-manager-first-90-days.html`
- `articles/se-metrics-that-matter.html`
- `articles/the-ae-se-partnership.html`

### Articles (prior commits)
- `articles/the-nine-month-problem.html` (commit 127d85e)
- `articles/what-executives-want-from-qbrs.html` (commit 84628813)

### Field Ready game
- `field-ready/so-you-want-to-be-an-se.html` (commit 12d0c55 — renamed from should-i-be-an-se)

---

## Summary

| Severity | Count |
|----------|-------|
| High     | 2     |
| Medium   | 3     |
| Low      | 1     |

---

## Issues

### HIGH — Broken PWA manifest link in `so-you-want-to-be-an-se.html`

**File:** `field-ready/so-you-want-to-be-an-se.html`, line 17  
**Issue:** The manifest link references a file that does not exist:

```html
<link rel="manifest" href="/field-ready/manifest-should-i-be-an-se.json" />
```

The actual manifest file on disk is `manifest-so-you-want-to-be-an-se.json`. The old name `manifest-should-i-be-an-se.json` does not exist. This breaks PWA installation ("Add to Home Screen") for this tool.

**Fix:** Change to `/field-ready/manifest-so-you-want-to-be-an-se.json`.

---

### HIGH — Incomplete rename in `so-you-want-to-be-an-se.html`

**File:** `field-ready/so-you-want-to-be-an-se.html`  
**Issue:** The commit that renamed this game to "So You Want to Be an SE" left multiple references to the old name "Should I Be an SE?" and old URL slug `should-i-be-an-se`. Affected locations:

| Location | Line | Current value | Expected value |
|----------|------|---------------|----------------|
| `<title>` | 7 | `Should I Be an SE? \| Field Ready` | `So You Want to Be an SE \| Field Ready` |
| `<meta property="og:title">` | 12 | `Should I Be an SE? \| Field Ready` | `So You Want to Be an SE \| Field Ready` |
| `<meta property="og:url">` | 14 | `.../field-ready/should-i-be-an-se` | `.../field-ready/so-you-want-to-be-an-se` |
| `<meta name="apple-mobile-web-app-title">` | 20 | `Should I Be an SE?` | `So You Want to Be an SE` |
| `<h1 class="intro-title">` | 529 | `Should I Be an <em>SE?</em>` | `So You Want to Be an <em>SE?</em>` |
| `shareResult()` JS function | 834 | Hardcodes old title and old URL slug | Should reference new title and `so-you-want-to-be-an-se` |

The share text (line 834) also embeds the old URL:
```javascript
'jasonlanders.com/field-ready/should-i-be-an-se'
```

---

### MEDIUM — All 11 new articles have `.html` in `og:url` meta tags

**Files:** All 10 articles from commit 12d0c55, plus `the-nine-month-problem.html`  
**Issue:** Every newly added article sets its Open Graph URL with a `.html` extension, e.g.:

```html
<meta property="og:url" content="https://jasonlanders.com/articles/ai-tools-for-ses-right-now.html" />
```

This contradicts the established SEO convention for this site. Commit 8ac7227 explicitly removed `.html` from all existing `og:url` values, and older articles like `what-executives-want-from-qbrs.html` correctly omit it:

```html
<meta property="og:url" content="https://jasonlanders.com/articles/what-executives-want-from-qbrs" />
```

**Affected files (all need `.html` removed from `og:url` and the matching JSON-LD `url` field):**

- `articles/ai-tools-for-ses-right-now.html`
- `articles/building-technical-champions.html`
- `articles/competitive-deals-for-ses.html`
- `articles/discovery-that-actually-works.html`
- `articles/handling-technical-objections.html`
- `articles/how-to-run-a-great-demo.html`
- `articles/se-comp-and-career.html`
- `articles/se-manager-first-90-days.html`
- `articles/se-metrics-that-matter.html`
- `articles/the-ae-se-partnership.html`
- `articles/the-nine-month-problem.html`

Each file has two occurrences to fix: the `og:url` meta tag and the `url` property inside the `application/ld+json` script.

---

### MEDIUM — All 11 new articles missing from `sitemap.xml`

**File:** `sitemap.xml`  
**Issue:** The sitemap has not been updated since the 10 articles (commit 12d0c55) and `the-nine-month-problem.html` (commit 127d85e) were added. None of the following articles appear in the sitemap:

- `articles/ai-tools-for-ses-right-now`
- `articles/building-technical-champions`
- `articles/competitive-deals-for-ses`
- `articles/discovery-that-actually-works`
- `articles/handling-technical-objections`
- `articles/how-to-run-a-great-demo`
- `articles/se-comp-and-career`
- `articles/se-manager-first-90-days`
- `articles/se-metrics-that-matter`
- `articles/the-ae-se-partnership`
- `articles/the-nine-month-problem`

These pages will be slower to be discovered and indexed by search engines until they are added.

---

### MEDIUM — Typo in `competitive-deals-for-ses.html`

**File:** `articles/competitive-deals-for-ses.html`, line 90  
**Issue:** The word "debriefing" is misspelled as "debrriefing" (extra 'r'):

> "being honest about why, debrriefing the customer professionally"

---

### LOW — Em dash inconsistency in `what-executives-want-from-qbrs.html`

**File:** `articles/what-executives-want-from-qbrs.html`, line 7  
**Issue:** The `<title>` tag uses a double hyphen `--` as a separator instead of the em dash `—` used consistently across all other article titles:

```html
<title>What Executives Actually Want from a QBR -- Jason Landers</title>
```

Every other article uses `—`, e.g.:

```html
<title>How SEs win competitive deals — Jason Landers</title>
```

---

## Passing Checks

The following were verified and are consistent across all reviewed files:

- **HTML structure:** All files have valid `<!DOCTYPE html>`, `<html lang="en">`, `<head>`, and `<body>` elements.
- **Charset and viewport:** All files include `<meta charset="UTF-8">` and `<meta name="viewport" content="width=device-width, initial-scale=1.0">`.
- **Favicon:** All files link to `/favicon.svg`.
- **Stylesheet references:** Articles correctly use `../css/style.css` and `../css/article.css` relative paths.
- **Google Fonts:** Consistent `Inter` font loading with `preconnect` optimization across all articles.
- **Analytics:** Umami tracking script present on all pages with consistent website ID.
- **Navigation:** All articles have the correct nav links (`Writing`, `About`, `LinkedIn`, `Subscribe`).
- **Footer:** All articles have consistent footer content (name, tagline, copyright `© 2026`).
- **OG type:** All articles correctly set `og:type` to `article`.
- **JSON-LD:** All articles include structured data with correct `@type: Article`, author, and publisher.
- **Meta descriptions:** Present and unique on all reviewed files.
- **Meta keywords:** Present on all reviewed files.
- **CTA section:** All articles include the newsletter CTA section with consistent copy.
- **Content quality:** Articles are well-written, consistent in tone and structure, and match the stated read times.
- **Mobile responsiveness:** `so-you-want-to-be-an-se.html` includes responsive breakpoints at 480px for quiz layout and email form.
- **Newsletter form:** The beehiiv embed in `so-you-want-to-be-an-se.html` uses the correct form action URL.
- **External links:** LinkedIn links correctly use `target="_blank"`.
