#!/usr/bin/env node
// ============================================================
// QA Static Check Script — SE Trail
// Run: node scripts/qa-se-trail.js
// Exit code 0 = pass, 1 = failures found
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'field-ready', 'se-trail', 'index.html');
const content = fs.readFileSync(FILE, 'utf8');
const lines = content.split('\n');

let failures = 0;
let warnings = 0;

function pass(msg) { console.log('  \x1b[32m✓\x1b[0m ' + msg); }
function fail(msg) { console.log('  \x1b[31m✗\x1b[0m ' + msg); failures++; }
function warn(msg) { console.log('  \x1b[33m⚠\x1b[0m ' + msg); warnings++; }

function countMatches(pattern, label, maxAllowed) {
  const matches = content.match(pattern) || [];
  if (matches.length > maxAllowed) {
    fail(label + ': found ' + matches.length + ' (max ' + maxAllowed + ')');
  } else {
    pass(label + ': ' + matches.length + ' found (ok)');
  }
}

function requireString(str, label) {
  if (content.includes(str)) {
    pass(label + ': present');
  } else {
    fail(label + ': MISSING');
  }
}

function forbidString(str, label) {
  const idx = content.indexOf(str);
  if (idx === -1) {
    pass(label + ': not found (ok)');
  } else {
    const lineNum = content.substring(0, idx).split('\n').length;
    fail(label + ': found at line ' + lineNum);
  }
}

function findAllOccurrences(pattern, label) {
  const results = [];
  lines.forEach((line, i) => {
    if (pattern.test(line)) results.push({ line: i + 1, text: line.trim().substring(0, 80) });
  });
  if (results.length > 0) {
    fail(label + ': ' + results.length + ' occurrence(s)');
    results.forEach(r => console.log('      Line ' + r.line + ': ' + r.text));
  } else {
    pass(label + ': none found (ok)');
  }
}

console.log('\n\x1b[1mSE Trail QA — Static Check\x1b[0m');
console.log('File: ' + FILE);
console.log('Size: ' + (content.length / 1024).toFixed(1) + ' KB, ' + lines.length + ' lines\n');

// ---- ENCODING / PUNCTUATION ----
console.log('\x1b[1m[Encoding & Punctuation]\x1b[0m');
findAllOccurrences(/\u2014|&mdash;|&#8212;/, 'Em-dashes (U+2014 / &mdash; / &#8212;)');
findAllOccurrences(/(?<![<-])--(?![->\s*\/])/, 'Double-dashes in visible text');

// ---- BANNED WORDS (in visible text / strings only) ----
console.log('\n\x1b[1m[Banned Words]\x1b[0m');
const bannedWords = [
  'crucial', 'nuanced', 'robust', 'seamless', 'delve', 'multifaceted',
  'tapestry', 'pivotal', 'transformative', 'game-changer', 'leverage',
  'underscore', 'landscape'
];
bannedWords.forEach(word => {
  // Only check inside string literals (quoted content), not variable names or comments
  const pattern = new RegExp('"[^"]*\\b' + word + '\\b[^"]*"|\'[^\']*\\b' + word + '\\b[^\']*`', 'gi');
  const matches = content.match(pattern) || [];
  if (matches.length > 0) {
    warn('Banned word "' + word + '": ' + matches.length + ' occurrence(s) in strings');
  } else {
    pass('Banned word "' + word + '": clean');
  }
});

// ---- REQUIRED STRINGS ----
console.log('\n\x1b[1m[Required Elements]\x1b[0m');
requireString('umami', 'Umami analytics script');
requireString('og:title', 'OG title tag');
requireString('og:description', 'OG description tag');
requireString('og:url', 'OG URL tag');
requireString('/field-ready/', 'Back link to Field Ready hub');
requireString('jasonlanders.com/field-ready/se-trail', 'Correct OG URL for se-trail');

// ---- GAME STRUCTURE ----
console.log('\n\x1b[1m[Game Structure]\x1b[0m');
requireString('TitleScene', 'TitleScene class');
requireString('OnboardingScene', 'OnboardingScene class');
requireString('CityScene', 'CityScene class');
requireString('DecisionScene', 'DecisionScene class');
requireString('ScrambleScene', 'ScrambleScene class');
requireString('OutcomeScene', 'OutcomeScene class');
requireString('AudioSystem', 'AudioSystem');
requireString('resetState()', 'resetState function call');
requireString('phaser@3', 'Phaser CDN script');

// ---- KNOWN CONTENT REQUIREMENTS ----
console.log('\n\x1b[1m[Content Requirements]\x1b[0m');
requireString('vertex_encounter', 'Vertex encounter scenario');
requireString('VERTEX IN PLAY', 'Vertex in play HUD flag');
requireString('showStackedNotif', 'Stacked notification system');
requireString('notifQueue', 'Notification queue array');
requireString('Meet your AE', 'Updated Corner description (not "Meet Alex here")');
requireString('making a move on your customer', 'Updated Vertex description');
requireString('0xff3333', 'Red badge color');

// ---- JS SYNTAX HAZARDS ----
console.log('\n\x1b[1m[JS Syntax Hazards]\x1b[0m');
// Unescaped apostrophes inside single-quoted strings (common breakage point)
const apostrophePattern = /'[^']*[a-z]'[a-z][^']*'/g;
const apostropheMatches = content.match(apostrophePattern) || [];
if (apostropheMatches.length > 0) {
  warn('Possible unescaped apostrophes in single-quoted strings: ' + apostropheMatches.length + ' candidate(s)');
  apostropheMatches.slice(0, 3).forEach(m => console.log('      ' + m.substring(0, 80)));
} else {
  pass('Apostrophe check: no obvious issues');
}

// Check for unclosed template literals or obvious syntax errors via balanced brace count
const openBraces = (content.match(/\{/g) || []).length;
const closeBraces = (content.match(/\}/g) || []).length;
if (openBraces === closeBraces) {
  pass('Brace balance: ' + openBraces + ' open / ' + closeBraces + ' close (balanced)');
} else {
  fail('Brace balance: ' + openBraces + ' open vs ' + closeBraces + ' close — UNBALANCED');
}

// ---- NODE SYNTAX CHECK ----
console.log('\n\x1b[1m[Node Syntax Check]\x1b[0m');
const { execSync } = require('child_process');
// Extract just the <script> block and check it
try {
  const scriptMatch = content.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  if (scriptMatch) {
    const tmpFile = path.join(__dirname, '_qa_tmp.js');
    fs.writeFileSync(tmpFile, scriptMatch[1]);
    try {
      execSync('node --check "' + tmpFile + '"', { stdio: 'pipe' });
      pass('JS syntax check: no errors');
    } catch (e) {
      fail('JS syntax error: ' + e.stderr.toString().trim().split('\n')[0]);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  } else {
    warn('Could not extract script block for syntax check');
  }
} catch (e) {
  warn('Syntax check error: ' + e.message);
}

// ---- SUMMARY ----
console.log('\n' + '─'.repeat(50));
if (failures === 0 && warnings === 0) {
  console.log('\x1b[32m\x1b[1m✓ ALL CHECKS PASSED\x1b[0m\n');
} else {
  if (failures > 0) console.log('\x1b[31m\x1b[1m✗ ' + failures + ' FAILURE(S)\x1b[0m' + (warnings > 0 ? '  \x1b[33m⚠ ' + warnings + ' WARNING(S)\x1b[0m' : ''));
  else console.log('\x1b[33m\x1b[1m⚠ ' + warnings + ' WARNING(S) (no hard failures)\x1b[0m');
  console.log('');
}

process.exit(failures > 0 ? 1 : 0);
