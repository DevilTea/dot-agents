#!/usr/bin/env node

/**
 * Generate a self-contained HTML review page for eval results.
 *
 * Scans a workspace directory for run outputs, embeds all data (text, images,
 * grading) into a single HTML file, and opens it in the default browser.
 *
 * Usage:
 *   node generate-review.mjs <workspace-path> [options]
 *
 * Options:
 *   --skill-name <name>              Skill name for the page title
 *   --benchmark <path>               Path to benchmark.json for stats tab
 *   --previous-workspace <path>      Previous iteration workspace for comparison
 *   --output <path>                  Output HTML file (default: <workspace>/review.html)
 *
 * No external dependencies — uses Node.js built-ins only.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative, extname, basename } from 'path';
import { execSync } from 'child_process';

const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.csv', '.py', '.js', '.ts', '.tsx', '.jsx',
  '.yaml', '.yml', '.xml', '.html', '.css', '.sh', '.rb', '.go', '.rs',
  '.java', '.c', '.cpp', '.h', '.hpp', '.sql', '.r', '.toml', '.mjs',
]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const METADATA_FILES = new Set(['transcript.md', 'user_notes.md', 'metrics.json']);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findRuns(workspace) {
  const runs = [];
  findRunsRecursive(workspace, workspace, runs);
  runs.sort((a, b) => (a.evalId - b.evalId) || a.id.localeCompare(b.id));
  return runs;
}

function hasRunEvidence(dir) {
  // A directory is a valid run if it has at least some evidence of execution:
  // - outputs/ with at least one file
  // - grading.json exists
  // - transcript.md exists
  const outputsDir = join(dir, 'outputs');
  const hasOutputFiles = existsSync(outputsDir)
    && statSync(outputsDir).isDirectory()
    && readdirSync(outputsDir).some(f => statSync(join(outputsDir, f)).isFile());
  const hasGrading = existsSync(join(dir, 'grading.json'));
  const hasTranscript = existsSync(join(dir, 'transcript.md'));
  return hasOutputFiles || hasGrading || hasTranscript;
}

function findRunsRecursive(root, current, runs) {
  if (!existsSync(current) || !statSync(current).isDirectory()) return;
  const outputsDir = join(current, 'outputs');
  if (existsSync(outputsDir) && statSync(outputsDir).isDirectory()) {
    // outputs/ dir exists — but only register as a run if there's actual evidence
    if (hasRunEvidence(current)) {
      const run = buildRun(root, current);
      if (run) runs.push(run);
    }
    return;
  }
  const skip = new Set(['node_modules', '.git', '__pycache__', 'skill', 'inputs']);
  for (const child of readdirSync(current).sort()) {
    const childPath = join(current, child);
    if (statSync(childPath).isDirectory() && !skip.has(child)) {
      findRunsRecursive(root, childPath, runs);
    }
  }
}

function loadEvalsJson(root) {
  // Try evals/evals.json relative to workspace root, then its parent
  // (handles iteration dirs like workspace/iteration-N where evals is at workspace/evals/)
  for (const base of [root, join(root, '..')]) {
    const evalsPath = join(base, 'evals', 'evals.json');
    if (existsSync(evalsPath)) {
      try {
        const data = JSON.parse(readFileSync(evalsPath, 'utf-8'));
        return data.evals || [];
      } catch { /* ignore */ }
    }
  }
  return null;
}

// Cache loaded evals per root
const _evalsCache = new Map();
function getEvals(root) {
  if (!_evalsCache.has(root)) {
    _evalsCache.set(root, loadEvalsJson(root));
  }
  return _evalsCache.get(root);
}

/**
 * Build an eval-name-to-eval mapping from evals.json.
 * Uses `dir_name` field in each eval entry to match against directory names.
 * Returns a Map<dirName, evalEntry> or null if evals.json is not available.
 */
const _evalDirMapCache = new Map();
function getEvalDirMap(root) {
  if (_evalDirMapCache.has(root)) return _evalDirMapCache.get(root);

  const evals = getEvals(root);
  if (!evals) {
    _evalDirMapCache.set(root, null);
    return null;
  }

  const map = new Map();
  for (const e of evals) {
    if (e.dir_name) {
      map.set(e.dir_name, e);
    }
  }

  _evalDirMapCache.set(root, map);
  return map;
}

function buildRun(root, runDir) {
  let prompt = '';
  let evalId = 0;
  let evalName = '';

  // Try eval_metadata.json (in runDir or parent)
  for (const candidate of [join(runDir, 'eval_metadata.json'), join(runDir, '..', 'eval_metadata.json')]) {
    if (existsSync(candidate)) {
      try {
        const meta = JSON.parse(readFileSync(candidate, 'utf-8'));
        prompt = meta.prompt || '';
        evalId = meta.eval_id ?? 0;
        evalName = meta.eval_name || '';
      } catch { /* ignore */ }
      if (prompt) break;
    }
  }

  // Fallback: look up prompt from evals/evals.json using eval directory name
  if (!prompt) {
    const parentDirName = basename(join(runDir, '..'));
    const evalDirMap = getEvalDirMap(root);
    if (evalDirMap && evalDirMap.has(parentDirName)) {
      const match = evalDirMap.get(parentDirName);
      prompt = match.prompt || '';
      evalId = match.id ?? 0;
      evalName = match.eval_name || parentDirName;
    }
    if (!evalName) evalName = parentDirName;
  }

  // Collect output files from outputs/ dir, with fallback to runDir itself
  const outputsDir = join(runDir, 'outputs');
  const files = [];
  const dirsToScan = [];
  if (existsSync(outputsDir) && readdirSync(outputsDir).some(f => statSync(join(outputsDir, f)).isFile())) {
    dirsToScan.push(outputsDir);
  } else {
    // Fallback: if outputs/ is empty or missing, check runDir for output files
    // (handles subagents that wrote to the wrong directory level)
    dirsToScan.push(runDir);
  }
  const seenFiles = new Set();
  for (const scanDir of dirsToScan) {
    for (const f of readdirSync(scanDir)) {
      if (METADATA_FILES.has(f)) continue;
      if (['grading.json', 'eval_metadata.json'].includes(f)) continue;
      const filePath = join(scanDir, f);
      if (!statSync(filePath).isFile()) continue;
      if (seenFiles.has(f)) continue;
      seenFiles.add(f);
      const ext = extname(f).toLowerCase();
      const fileData = { name: f, ext };

      if (TEXT_EXTS.has(ext)) {
        try {
          fileData.content = readFileSync(filePath, 'utf-8');
          fileData.type = 'text';
        } catch {
          fileData.type = 'binary';
        }
      } else if (IMAGE_EXTS.has(ext)) {
        const buf = readFileSync(filePath);
        const mime = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1).replace('jpg', 'jpeg')}`;
        fileData.dataUri = `data:${mime};base64,${buf.toString('base64')}`;
        fileData.type = 'image';
      } else {
        fileData.type = 'binary';
      }
      files.push(fileData);
    }
  }

  // Read grading
  let grading = null;
  const gradingPath = join(runDir, 'grading.json');
  if (existsSync(gradingPath)) {
    try { grading = JSON.parse(readFileSync(gradingPath, 'utf-8')); } catch { /* ignore */ }
  }

  // Read transcript
  let transcript = null;
  const transcriptPath = join(runDir, 'transcript.md');
  if (existsSync(transcriptPath)) {
    try { transcript = readFileSync(transcriptPath, 'utf-8'); } catch { /* ignore */ }
  }

  const relPath = relative(root, runDir);
  return {
    id: relPath.replace(/\//g, '-'),
    path: relPath,
    evalId,
    evalName,
    prompt,
    files,
    grading,
    transcript,
  };
}

function generateHtml(runs, skillName, benchmarkData, previousRuns) {
  const prevRunMap = {};
  if (previousRuns) {
    for (const r of previousRuns) prevRunMap[r.id] = r;
  }

  // Escape </script> in JSON to prevent premature script tag closure in HTML
  const safeJson = (obj) => JSON.stringify(obj).replace(/<\/script/gi, '<\\/script');
  const runsJson = safeJson(runs);
  const prevRunsJson = safeJson(previousRuns || []);
  const benchmarkJson = safeJson(benchmarkData || null);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(skillName || 'Skill')} — Eval Review</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #1a1a1a; }
  .tabs { display: flex; background: #1a1a1a; }
  .tab { padding: 12px 24px; color: #888; cursor: pointer; border-bottom: 3px solid transparent; font-weight: 500; }
  .tab.active { color: #fff; border-bottom-color: #d97757; }
  .tab:hover { color: #ccc; }
  .tab-content { display: none; padding: 24px; max-width: 1200px; margin: 0 auto; }
  .tab-content.active { display: block; }
  .nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .nav button { padding: 8px 16px; border: 1px solid #ddd; background: #fff; border-radius: 6px; cursor: pointer; font-size: 14px; }
  .nav button:hover { background: #eee; }
  .nav .counter { font-size: 14px; color: #666; }
  .card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .card h3 { margin-bottom: 12px; font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
  .prompt-text { font-size: 15px; line-height: 1.6; white-space: pre-wrap; }
  .file-output { margin-bottom: 12px; }
  .file-name { font-family: monospace; font-size: 13px; color: #d97757; margin-bottom: 4px; }
  .file-content { background: #f8f8f8; border: 1px solid #e8e8e8; border-radius: 4px; padding: 12px; font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 400px; overflow-y: auto; }
  .file-image { max-width: 100%; border: 1px solid #e8e8e8; border-radius: 4px; }
  .grade { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 4px; font-size: 13px; margin: 2px 4px 2px 0; }
  .grade.pass { background: #eef6ee; color: #2d7a2d; }
  .grade.fail { background: #fceaea; color: #c44; }
  .evidence { font-size: 12px; color: #666; margin-left: 8px; }
  .feedback-box { width: 100%; min-height: 80px; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-family: inherit; font-size: 14px; resize: vertical; }
  .feedback-box:focus { outline: none; border-color: #d97757; box-shadow: 0 0 0 2px rgba(217,119,87,0.15); }
  .submit-btn { display: block; margin: 24px auto; padding: 12px 32px; background: #d97757; color: #fff; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; font-weight: 500; }
  .submit-btn:hover { background: #c4613f; }
  .collapsible summary { cursor: pointer; font-weight: 500; color: #666; font-size: 13px; }
  .collapsible summary:hover { color: #333; }
  .benchmark-table { width: 100%; border-collapse: collapse; }
  .benchmark-table th, .benchmark-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; font-size: 13px; }
  .benchmark-table th { background: #f8f8f8; font-weight: 600; }
  .prev-output { opacity: 0.7; border-left: 3px solid #ddd; padding-left: 12px; }
</style>
</head>
<body>
<div class="tabs">
  <div class="tab active" onclick="switchTab('outputs')">Outputs</div>
  <div class="tab" onclick="switchTab('benchmark')">Benchmark</div>
</div>

<div id="outputs-tab" class="tab-content active">
  <div class="nav">
    <button onclick="prevRun()">← Previous</button>
    <span class="counter" id="counter"></span>
    <button onclick="nextRun()">Next →</button>
  </div>
  <div id="run-content"></div>
  <button class="submit-btn" onclick="submitAll()">Submit All Reviews</button>
</div>

<div id="benchmark-tab" class="tab-content">
  <div id="benchmark-content"></div>
</div>

<script>
const RUNS = ${runsJson};
const PREV_RUNS = ${prevRunsJson};
const BENCHMARK = ${benchmarkJson};
const feedback = {};
let currentIdx = 0;

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(\`.tab-content#\${tab}-tab\`).classList.add('active');
  event.target.classList.add('active');
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function renderRun(idx) {
  currentIdx = idx;
  const run = RUNS[idx];
  document.getElementById('counter').textContent = \`\${idx + 1} / \${RUNS.length} — \${run.path}\`;

  let html = '';

  // Prompt
  html += \`<div class="card"><h3>Prompt</h3><div class="prompt-text">\${escHtml(run.prompt || '(no prompt recorded)')}</div></div>\`;

  // Outputs
  html += '<div class="card"><h3>Output</h3>';
  if (run.files.length === 0) {
    html += '<p style="color:#888">No output files found.</p>';
  }
  for (const f of run.files) {
    html += \`<div class="file-output"><div class="file-name">\${escHtml(f.name)}</div>\`;
    if (f.type === 'text') {
      html += \`<div class="file-content">\${escHtml(f.content)}</div>\`;
    } else if (f.type === 'image') {
      html += \`<img class="file-image" src="\${f.dataUri}" alt="\${escHtml(f.name)}">\`;
    } else {
      html += '<div style="color:#888;font-size:13px">[Binary file — cannot display inline]</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  // Previous output (if available)
  const prevRun = PREV_RUNS.find(r => r.id === run.id);
  if (prevRun && prevRun.files.length) {
    html += '<details class="card collapsible"><summary>Previous Output</summary><div class="prev-output" style="margin-top:12px">';
    for (const f of prevRun.files) {
      html += \`<div class="file-output"><div class="file-name">\${escHtml(f.name)}</div>\`;
      if (f.type === 'text') html += \`<div class="file-content">\${escHtml(f.content)}</div>\`;
      else if (f.type === 'image') html += \`<img class="file-image" src="\${f.dataUri}">\`;
      html += '</div>';
    }
    html += '</div></details>';
  }

  // Grading
  if (run.grading && run.grading.expectations) {
    html += '<details class="card collapsible"><summary>Formal Grades</summary><div style="margin-top:12px">';
    for (const exp of run.grading.expectations) {
      const cls = exp.passed ? 'pass' : 'fail';
      const icon = exp.passed ? '✓' : '✗';
      html += \`<div class="grade \${cls}">\${icon} \${escHtml(exp.text)}</div>\`;
      if (exp.evidence) html += \`<span class="evidence">\${escHtml(exp.evidence)}</span>\`;
      html += '<br>';
    }
    if (run.grading.summary) {
      const s = run.grading.summary;
      html += \`<p style="margin-top:8px;font-size:13px;color:#666">Pass rate: \${s.passed}/\${s.total} (\${(s.pass_rate * 100).toFixed(0)}%)</p>\`;
    }
    html += '</div></details>';
  }

  // Transcript
  if (run.transcript) {
    html += '<details class="card collapsible"><summary>Transcript</summary>';
    html += \`<div class="file-content" style="margin-top:12px">\${escHtml(run.transcript)}</div></details>\`;
  }

  // Feedback
  const savedFeedback = feedback[run.id] || '';
  html += \`<div class="card"><h3>Feedback</h3><textarea class="feedback-box" placeholder="Leave feedback for this test case..." oninput="feedback['\${run.id}']=this.value">\${escHtml(savedFeedback)}</textarea></div>\`;

  document.getElementById('run-content').innerHTML = html;
}

function prevRun() { if (currentIdx > 0) renderRun(currentIdx - 1); }
function nextRun() { if (currentIdx < RUNS.length - 1) renderRun(currentIdx + 1); }

function submitAll() {
  const reviews = RUNS.map(r => ({
    run_id: r.id,
    feedback: feedback[r.id] || '',
    timestamp: new Date().toISOString(),
  }));
  const data = JSON.stringify({ reviews, status: 'complete' }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'feedback.json';
  a.click();
}

function renderBenchmark() {
  const el = document.getElementById('benchmark-content');
  if (!BENCHMARK) {
    el.innerHTML = '<div class="card"><p style="color:#888">No benchmark data available. Run aggregate-benchmark.mjs first.</p></div>';
    return;
  }
  let html = \`<div class="card"><h3>Benchmark: \${escHtml(BENCHMARK.skill_name || 'Skill')}</h3>\`;
  html += '<table class="benchmark-table"><thead><tr><th>Config</th><th>Pass Rate</th><th>Time (s)</th><th>Runs</th></tr></thead><tbody>';
  for (const [config, stats] of Object.entries(BENCHMARK.run_summary || {})) {
    html += \`<tr>
      <td>\${escHtml(config)}</td>
      <td>\${(stats.pass_rate.mean * 100).toFixed(1)}% ± \${(stats.pass_rate.stddev * 100).toFixed(1)}%</td>
      <td>\${stats.time_seconds.mean.toFixed(1)} ± \${stats.time_seconds.stddev.toFixed(1)}</td>
      <td>\${stats.run_count}</td>
    </tr>\`;
  }
  html += '</tbody></table>';

  if (BENCHMARK.delta) {
    const d = BENCHMARK.delta;
    html += \`<p style="margin-top:12px;font-size:13px;color:#666">Delta (\${d.configs[0]} vs \${d.configs[1]}): pass_rate \${d.pass_rate > 0 ? '+' : ''}\${(d.pass_rate * 100).toFixed(1)}%, time \${d.time_seconds > 0 ? '+' : ''}\${d.time_seconds.toFixed(1)}s</p>\`;
  }
  html += '</div>';

  // Per-eval breakdown from raw results
  if (BENCHMARK.raw_results) {
    html += '<div class="card"><h3>Per-Eval Breakdown</h3>';
    for (const [config, runs] of Object.entries(BENCHMARK.raw_results)) {
      html += \`<h4 style="margin:12px 0 8px;font-size:14px">\${escHtml(config)}</h4>\`;
      html += '<table class="benchmark-table"><thead><tr><th>Eval</th><th>Pass Rate</th><th>Passed</th><th>Failed</th></tr></thead><tbody>';
      for (const r of runs) {
        html += \`<tr><td>\${escHtml(r.eval_name || 'eval-' + r.eval_id)}</td><td>\${(r.pass_rate * 100).toFixed(0)}%</td><td>\${r.passed}</td><td>\${r.failed}</td></tr>\`;
      }
      html += '</tbody></table>';
    }
    html += '</div>';
  }

  el.innerHTML = html;
}

// Keyboard nav
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft') prevRun();
  if (e.key === 'ArrowRight') nextRun();
});

// Init
if (RUNS.length) renderRun(0);
renderBenchmark();
</script>
</body>
</html>`;
}

// --- CLI ---
const args = process.argv.slice(2);
let workspacePath = null;
let skillName = '';
let benchmarkPath = null;
let previousWorkspace = null;
let outputPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--skill-name' && i + 1 < args.length) skillName = args[++i];
  else if (args[i] === '--benchmark' && i + 1 < args.length) benchmarkPath = args[++i];
  else if (args[i] === '--previous-workspace' && i + 1 < args.length) previousWorkspace = args[++i];
  else if (args[i] === '--output' && i + 1 < args.length) outputPath = args[++i];
  else if (!workspacePath) workspacePath = args[i];
}

if (!workspacePath) {
  console.error('Usage: node generate-review.mjs <workspace-path> [--skill-name NAME] [--benchmark PATH] [--previous-workspace PATH] [--output PATH]');
  process.exit(1);
}

const absWorkspace = resolve(workspacePath);
if (!existsSync(absWorkspace)) {
  console.error(`Workspace not found: ${absWorkspace}`);
  process.exit(1);
}

// Discover runs
const runs = findRuns(absWorkspace);
console.log(`Found ${runs.length} run(s) in ${absWorkspace}`);

// Verify completeness
const withOutput = runs.filter(r => r.files.length > 0);
const withoutOutput = runs.filter(r => r.files.length === 0);
if (withoutOutput.length > 0) {
  console.warn(`\n⚠️  ${withoutOutput.length} run(s) have no output files:`);
  for (const r of withoutOutput) {
    console.warn(`   ${r.path}  (has grading: ${!!r.grading}, has transcript: ${!!r.transcript})`);
  }
  console.warn('   These runs may still be in progress. Re-run this script after all subagents finish.\n');
}

// Load benchmark
let benchmarkData = null;
if (benchmarkPath && existsSync(benchmarkPath)) {
  try { benchmarkData = JSON.parse(readFileSync(benchmarkPath, 'utf-8')); } catch { /* ignore */ }
} else {
  // Auto-discover benchmark.json in workspace
  const autoBenchmark = join(absWorkspace, 'benchmark.json');
  if (existsSync(autoBenchmark)) {
    try { benchmarkData = JSON.parse(readFileSync(autoBenchmark, 'utf-8')); } catch { /* ignore */ }
  }
}

// Load previous runs
let previousRuns = null;
if (previousWorkspace && existsSync(previousWorkspace)) {
  previousRuns = findRuns(resolve(previousWorkspace));
  console.log(`Found ${previousRuns.length} previous run(s)`);
}

// Generate HTML
const html = generateHtml(runs, skillName, benchmarkData, previousRuns);
const outFile = outputPath || join(absWorkspace, 'review.html');
writeFileSync(outFile, html);
console.log(`✅ Review written to: ${outFile}`);

// Open in browser
try {
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  execSync(`${openCmd} "${outFile}"`);
  console.log('   Opened in browser.');
} catch {
  console.log('   Could not auto-open — please open the file manually.');
}
