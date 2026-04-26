#!/usr/bin/env node
/**
 * RAG Eval Diff Script
 *
 * Compares a new eval results.json against a committed baseline and prints a
 * per-pair diff showing improvements and regressions. Useful after any change
 * to the retrieval pipeline (embedding model, HNSW migration, scoring logic).
 *
 * Usage:
 *   # Compare latest run against most recent baseline:
 *   node scripts/diffEval.js eval-output/results.json
 *
 *   # Compare against a specific baseline:
 *   node scripts/diffEval.js eval-output/results.json eval-output/baseline-2026-04-17.json
 *
 * Output: colored per-pair table, aggregate delta, and a list of regressions.
 */

const fs = require('fs');
const path = require('path');

// ── Load files ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node scripts/diffEval.js <new-results.json> [baseline.json]');
  console.error('  If baseline is omitted, uses the most recent eval-output/baseline-*.json');
  process.exit(1);
}

const newPath = path.resolve(args[0]);
if (!fs.existsSync(newPath)) {
  console.error(`File not found: ${newPath}`);
  process.exit(1);
}
const newData = JSON.parse(fs.readFileSync(newPath, 'utf8'));

let baselinePath;
if (args[1]) {
  baselinePath = path.resolve(args[1]);
} else {
  // Auto-detect most recent baseline-*.json in eval-output/
  const evalDir = path.dirname(newPath);
  const baselines = fs.readdirSync(evalDir)
    .filter(f => f.startsWith('baseline-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (baselines.length === 0) {
    console.error('No baseline-*.json found in', evalDir);
    console.error('Commit your first baseline with:');
    console.error('  cp eval-output/results.json eval-output/baseline-YYYY-MM-DD.json');
    process.exit(1);
  }
  baselinePath = path.join(evalDir, baselines[0]);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`Baseline not found: ${baselinePath}`);
  process.exit(1);
}
const baseData = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

// ── Build lookup maps ───────────────────────────────────────────────────

const baseByQuestion = new Map();
for (const r of baseData.results) {
  baseByQuestion.set(r.question, r);
}

// ── Diff ────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function colorDelta(delta, suffix = '') {
  if (delta > 0.01) return `${GREEN}+${(delta * 100).toFixed(1)}%${suffix}${RESET}`;
  if (delta < -0.01) return `${RED}${(delta * 100).toFixed(1)}%${suffix}${RESET}`;
  return `${DIM}=${suffix}${RESET}`;
}

console.log(`\n${BOLD}RAG Eval Diff${RESET}`);
console.log(`  Baseline: ${path.basename(baselinePath)} (v${baseData.datasetVersion || '?'})`);
console.log(`  New:      ${path.basename(newPath)} (v${newData.datasetVersion || '?'})`);
console.log('');

// Aggregate
const aggRecallDelta = (newData.avgRecall || 0) - (baseData.avgRecall || 0);
const aggMrrDelta = (newData.mrr || 0) - (baseData.mrr || 0);
const aggKwDelta = (newData.avgKeywordCoverage || 0) - (baseData.avgKeywordCoverage || 0);

console.log(`${BOLD}Aggregate:${RESET}`);
console.log(`  Recall@10:  ${(baseData.avgRecall * 100).toFixed(1)}% → ${(newData.avgRecall * 100).toFixed(1)}%  ${colorDelta(aggRecallDelta)}`);
console.log(`  MRR:        ${(baseData.mrr * 100).toFixed(1)}% → ${(newData.mrr * 100).toFixed(1)}%  ${colorDelta(aggMrrDelta)}`);
console.log(`  Keyword:    ${((baseData.avgKeywordCoverage || 0) * 100).toFixed(1)}% → ${((newData.avgKeywordCoverage || 0) * 100).toFixed(1)}%  ${colorDelta(aggKwDelta)}`);
console.log('');

// Per-pair diff
const improvements = [];
const regressions = [];
const unchanged = [];

console.log(`${BOLD}Per-pair:${RESET}`);
console.log(`${'Category'.padEnd(12)} ${'Question'.padEnd(55)} ${'Base'.padEnd(7)} ${'New'.padEnd(7)} ${'Delta'.padEnd(10)}`);
console.log(`${'-'.repeat(12)} ${'-'.repeat(55)} ${'-'.repeat(7)} ${'-'.repeat(7)} ${'-'.repeat(10)}`);

for (const nr of newData.results) {
  const br = baseByQuestion.get(nr.question);
  const baseRecall = br ? br.recall : 0;
  const newRecall = nr.recall;
  const delta = newRecall - baseRecall;

  const cat = nr.category.padEnd(12);
  const q = nr.question.length > 53 ? nr.question.slice(0, 50) + '...' : nr.question;
  const baseStr = `${(baseRecall * 100).toFixed(0)}%`.padEnd(7);
  const newStr = `${(newRecall * 100).toFixed(0)}%`.padEnd(7);

  let deltaStr;
  if (delta > 0.01) {
    deltaStr = `${GREEN}+${(delta * 100).toFixed(0)}%${RESET}`;
    improvements.push({ question: nr.question, category: nr.category, delta });
  } else if (delta < -0.01) {
    deltaStr = `${RED}${(delta * 100).toFixed(0)}%${RESET}`;
    regressions.push({ question: nr.question, category: nr.category, delta });
  } else {
    deltaStr = `${DIM}=${RESET}`;
    unchanged.push(nr.question);
  }

  console.log(`${cat} ${q.padEnd(55)} ${baseStr} ${newStr} ${deltaStr}`);
}

// Summary
console.log('');
console.log(`${BOLD}Summary:${RESET}`);
console.log(`  ${GREEN}Improved:${RESET}  ${improvements.length} pairs`);
console.log(`  ${RED}Regressed:${RESET} ${regressions.length} pairs`);
console.log(`  ${DIM}Unchanged:${RESET} ${unchanged.length} pairs`);

if (regressions.length > 0) {
  console.log(`\n${RED}${BOLD}Regressions (investigate):${RESET}`);
  for (const r of regressions.sort((a, b) => a.delta - b.delta)) {
    console.log(`  ${RED}${(r.delta * 100).toFixed(0)}%${RESET}  [${r.category}] ${r.question}`);
  }
}

// Category breakdown
const categories = new Map();
for (const nr of newData.results) {
  const br = baseByQuestion.get(nr.question);
  const cat = nr.category;
  if (!categories.has(cat)) categories.set(cat, { baseSum: 0, newSum: 0, count: 0 });
  const c = categories.get(cat);
  c.baseSum += br ? br.recall : 0;
  c.newSum += nr.recall;
  c.count++;
}

console.log(`\n${BOLD}Per-category:${RESET}`);
console.log(`${'Category'.padEnd(14)} ${'Pairs'.padEnd(6)} ${'Base'.padEnd(8)} ${'New'.padEnd(8)} ${'Delta'}`);
console.log(`${'-'.repeat(14)} ${'-'.repeat(6)} ${'-'.repeat(8)} ${'-'.repeat(8)} ${'-'.repeat(8)}`);
for (const [cat, c] of categories) {
  const baseAvg = c.baseSum / c.count;
  const newAvg = c.newSum / c.count;
  const delta = newAvg - baseAvg;
  console.log(`${cat.padEnd(14)} ${String(c.count).padEnd(6)} ${(baseAvg * 100).toFixed(1).padEnd(8)}% ${(newAvg * 100).toFixed(1).padEnd(8)}% ${colorDelta(delta)}`);
}

console.log('');

// Exit code: non-zero if any regressions
if (regressions.length > 0) {
  console.log(`${YELLOW}Exit 1: ${regressions.length} regression(s) detected.${RESET}`);
  process.exit(1);
}
