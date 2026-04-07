#!/usr/bin/env node

/**
 * Aggregate individual run results into benchmark summary statistics.
 *
 * Reads grading.json files from run directories and produces:
 *   - benchmark.json with mean, stddev, min, max for each metric per config
 *   - benchmark.md with a human-readable summary
 *
 * Usage:
 *   node aggregate-benchmark.mjs <benchmark-dir> [--skill-name <name>]
 *
 * Directory layout:
 *   <benchmark-dir>/
 *   └── <eval-name>/
 *       ├── with_skill/
 *       │   ├── grading.json
 *       │   └── outputs/
 *       └── without_skill/
 *           ├── grading.json
 *           └── outputs/
 *
 * Also supports run-* subdirectories for multiple runs per config.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, basename, dirname } from 'path';

/**
 * Load evals array from evals.json.
 * Canonical location is <workspace>/iteration-N/evals.json.
 * Legacy fallback: <workspace>/iteration-N/evals/evals.json, then sibling skill-dir equivalents.
 * Returns an array of eval entries or null.
 */
function loadEvalsJson(root) {
  const candidateBases = [];
  const seenBases = new Set();

  for (const base of [root, join(root, '..')]) {
    const resolvedBase = resolve(base);
    if (!seenBases.has(resolvedBase)) {
      candidateBases.push(resolvedBase);
      seenBases.add(resolvedBase);
    }

    const baseName = basename(resolvedBase);
    if (baseName.endsWith('-workspace')) {
      const skillDir = join(dirname(resolvedBase), baseName.slice(0, -'-workspace'.length));
      const resolvedSkillDir = resolve(skillDir);
      if (!seenBases.has(resolvedSkillDir)) {
        candidateBases.push(resolvedSkillDir);
        seenBases.add(resolvedSkillDir);
      }
    }
  }

  for (const base of candidateBases) {
    for (const evalsPath of [join(base, 'evals.json'), join(base, 'evals', 'evals.json')]) {
      if (existsSync(evalsPath)) {
        try {
          const data = JSON.parse(readFileSync(evalsPath, 'utf-8'));
          return data.evals || [];
        } catch { /* ignore */ }
      }
    }
  }
  return null;
}

// Cache eval dir_name -> eval entry mapping
let _evalsByDirName = null;
function getEvalByDirName(root, dirName) {
  if (_evalsByDirName === null) {
    _evalsByDirName = new Map();
    const evals = loadEvalsJson(root);
    if (evals) {
      for (const e of evals) {
        if (e.dir_name) _evalsByDirName.set(e.dir_name, e);
      }
    }
  }
  return _evalsByDirName.get(dirName) || null;
}

function calcStats(values) {
  if (!values.length) return { mean: 0, stddev: 0, min: 0, max: 0 };
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1
    ? values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1)
    : 0;
  return {
    mean: +mean.toFixed(4),
    stddev: +Math.sqrt(variance).toFixed(4),
    min: +Math.min(...values).toFixed(4),
    max: +Math.max(...values).toFixed(4),
  };
}

function discoverEvalDirs(dir) {
  const entries = readdirSync(dir).filter(e => {
    const p = join(dir, e);
    return statSync(p).isDirectory() && !e.startsWith('.');
  });
  // Check for runs/ subdirectory (legacy layout)
  const runsDir = join(dir, 'runs');
  if (existsSync(runsDir) && statSync(runsDir).isDirectory()) {
    return readdirSync(runsDir)
      .filter(e => statSync(join(runsDir, e)).isDirectory())
      .map(e => join(runsDir, e));
  }
  // Look for eval-* or any directory that has config subdirectories
  return entries
    .filter(e => {
      const subDir = join(dir, e);
      const children = readdirSync(subDir).filter(c => statSync(join(subDir, c)).isDirectory());
      return children.some(c => c === 'with_skill' || c === 'without_skill' || c === 'old_skill' || c === 'new_skill');
    })
    .map(e => join(dir, e));
}

function loadRunResults(benchmarkDir) {
  const results = {};
  const evalDirs = discoverEvalDirs(benchmarkDir);

  for (const evalDir of evalDirs) {
    const evalName = basename(evalDir);
    let evalId = 0;

    // Try eval_metadata.json first
    const metaPath = join(evalDir, 'eval_metadata.json');
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        evalId = meta.eval_id ?? 0;
      } catch { /* ignore */ }
    } else {
      // Fallback: look up by dir_name in the iteration evals snapshot
      const evalEntry = getEvalByDirName(benchmarkDir, evalName);
      if (evalEntry) {
        evalId = evalEntry.id ?? 0;
      } else {
        const m = evalName.match(/(\d+)/);
        if (m) evalId = parseInt(m[1], 10);
      }
    }

    // Discover config directories
    const configDirs = readdirSync(evalDir)
      .filter(c => {
        const p = join(evalDir, c);
        return statSync(p).isDirectory() && !['inputs', 'outputs', '.git'].includes(c);
      });

    for (const config of configDirs) {
      const configPath = join(evalDir, config);
      if (!results[config]) results[config] = [];

      // Check for run-* subdirectories
      const runDirs = readdirSync(configPath)
        .filter(r => r.startsWith('run-') && statSync(join(configPath, r)).isDirectory());

      const dirsToCheck = runDirs.length > 0
        ? runDirs.map(r => ({ path: join(configPath, r), runNum: parseInt(r.split('-')[1], 10) }))
        : [{ path: configPath, runNum: 1 }];

      for (const { path: runDir, runNum } of dirsToCheck) {
        const gradingFile = join(runDir, 'grading.json');
        if (!existsSync(gradingFile)) {
          console.warn(`Warning: grading.json not found in ${runDir}`);
          continue;
        }

        let grading;
        try {
          grading = JSON.parse(readFileSync(gradingFile, 'utf-8'));
        } catch (e) {
          console.warn(`Warning: Invalid JSON in ${gradingFile}: ${e.message}`);
          continue;
        }

        const summary = grading.summary || {};
        const timing = grading.timing || {};
        const metrics = grading.execution_metrics || {};

        const result = {
          eval_id: evalId,
          eval_name: evalName,
          run_number: runNum,
          pass_rate: summary.pass_rate ?? 0,
          passed: summary.passed ?? 0,
          failed: summary.failed ?? 0,
          total: summary.total ?? 0,
          time_seconds: timing.total_duration_seconds ?? 0,
          tool_calls: metrics.total_tool_calls ?? 0,
          tokens: 0,
          errors: metrics.errors_encountered ?? 0,
          expectations: grading.expectations || [],
          notes: [],
        };

        // Try timing.json sibling
        if (result.time_seconds === 0) {
          const timingFile = join(runDir, 'timing.json');
          if (existsSync(timingFile)) {
            try {
              const td = JSON.parse(readFileSync(timingFile, 'utf-8'));
              result.time_seconds = td.total_duration_seconds ?? 0;
              result.tokens = td.total_tokens ?? 0;
            } catch { /* ignore */ }
          }
        }

        // Extract notes from user_notes_summary
        const notes = grading.user_notes_summary || {};
        result.notes = [
          ...(notes.uncertainties || []),
          ...(notes.needs_review || []),
          ...(notes.workarounds || []),
        ];

        results[config].push(result);
      }
    }
  }

  return results;
}

function aggregate(results) {
  const runSummary = {};
  const configs = Object.keys(results);

  for (const config of configs) {
    const runs = results[config] || [];
    if (!runs.length) {
      runSummary[config] = {
        pass_rate: calcStats([]),
        time_seconds: calcStats([]),
        tokens: calcStats([]),
        run_count: 0,
      };
      continue;
    }

    runSummary[config] = {
      pass_rate: calcStats(runs.map(r => r.pass_rate)),
      time_seconds: calcStats(runs.map(r => r.time_seconds)),
      tokens: calcStats(runs.map(r => r.tokens)),
      run_count: runs.length,
    };
  }

  // Calculate delta if there are exactly two configs
  let delta = null;
  if (configs.length === 2) {
    const [a, b] = configs;
    delta = {
      configs: [a, b],
      pass_rate: +(runSummary[a].pass_rate.mean - runSummary[b].pass_rate.mean).toFixed(4),
      time_seconds: +(runSummary[a].time_seconds.mean - runSummary[b].time_seconds.mean).toFixed(2),
    };
  }

  return { run_summary: runSummary, delta };
}

function generateMarkdown(benchmark, skillName) {
  const lines = [`# Benchmark: ${skillName || 'Skill'}`, ''];
  const { run_summary, delta } = benchmark;

  for (const [config, stats] of Object.entries(run_summary)) {
    lines.push(`## ${config} (${stats.run_count} runs)`);
    lines.push(`- Pass rate: ${(stats.pass_rate.mean * 100).toFixed(1)}% ± ${(stats.pass_rate.stddev * 100).toFixed(1)}%`);
    lines.push(`- Time: ${stats.time_seconds.mean.toFixed(1)}s ± ${stats.time_seconds.stddev.toFixed(1)}s`);
    if (stats.tokens.mean > 0) {
      lines.push(`- Tokens: ${Math.round(stats.tokens.mean)} ± ${Math.round(stats.tokens.stddev)}`);
    }
    lines.push('');
  }

  if (delta) {
    lines.push('## Delta');
    lines.push(`- Pass rate: ${delta.pass_rate > 0 ? '+' : ''}${(delta.pass_rate * 100).toFixed(1)}%`);
    lines.push(`- Time: ${delta.time_seconds > 0 ? '+' : ''}${delta.time_seconds.toFixed(1)}s`);
    lines.push('');
  }

  return lines.join('\n');
}

// --- CLI ---
const args = process.argv.slice(2);
let benchmarkDir = null;
let skillName = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--skill-name' && i + 1 < args.length) {
    skillName = args[++i];
  } else if (!benchmarkDir) {
    benchmarkDir = args[i];
  }
}

if (!benchmarkDir) {
  console.error('Usage: node aggregate-benchmark.mjs <benchmark-dir> [--skill-name <name>]');
  process.exit(1);
}

const absDir = resolve(benchmarkDir);
if (!existsSync(absDir)) {
  console.error(`Directory not found: ${absDir}`);
  process.exit(1);
}

const results = loadRunResults(absDir);
const configs = Object.keys(results);
if (!configs.length) {
  console.error('No grading.json files found in the benchmark directory.');
  process.exit(1);
}

const { run_summary, delta } = aggregate(results);
const benchmark = {
  skill_name: skillName,
  created_at: new Date().toISOString(),
  run_summary,
  delta,
  raw_results: results,
};

const jsonPath = join(absDir, 'benchmark.json');
const mdPath = join(absDir, 'benchmark.md');
writeFileSync(jsonPath, JSON.stringify(benchmark, null, 2));
writeFileSync(mdPath, generateMarkdown(benchmark, skillName));

console.log(`✅ Benchmark written:`);
console.log(`   ${jsonPath}`);
console.log(`   ${mdPath}`);

for (const [config, stats] of Object.entries(run_summary)) {
  console.log(`   ${config}: pass_rate=${(stats.pass_rate.mean * 100).toFixed(1)}% ± ${(stats.pass_rate.stddev * 100).toFixed(1)}% (${stats.run_count} runs)`);
}
