import { readFileSync } from 'fs';
import { splitFrontmatter } from './frontmatter.mjs';
import { isSafeIdentifier } from './schemas.mjs';

export function parsePlanCheckpoints(markdown) {
  const { body } = splitFrontmatter(markdown, 'plan markdown');
  const checkpoints = [];
  const seen = new Set();

  for (const line of body.split('\n')) {
    const match = line.match(/(?:^|\s)checkpoint_id:\s*([A-Za-z0-9][A-Za-z0-9_-]*)\b/);
    if (!match) {
      continue;
    }

    const checkpointId = match[1].trim().toLowerCase().replace(/_/g, '-');
    if (!isSafeIdentifier(checkpointId)) {
      checkpoints.push({ checkpointId, valid: false });
      continue;
    }

    checkpoints.push({ checkpointId, valid: !seen.has(checkpointId) });
    seen.add(checkpointId);
  }

  return checkpoints;
}

export function readPlanCheckpoints(planPath) {
  return parsePlanCheckpoints(readFileSync(planPath, 'utf8'));
}

export function assertPlanCheckpoint(planPath, checkpointId) {
  const checkpoints = readPlanCheckpoints(planPath);
  const invalid = checkpoints.find((checkpoint) => !checkpoint.valid);
  if (invalid) {
    throw new Error(`Invalid or duplicate checkpoint_id in plan: ${invalid.checkpointId}`);
  }

  if (checkpoints.length === 0) {
    throw new Error(`Approved plan has no checkpoint_id entries: ${planPath}`);
  }

  if (!checkpoints.some((checkpoint) => checkpoint.checkpointId === checkpointId)) {
    throw new Error(`Checkpoint id is not defined in the approved plan: ${checkpointId}`);
  }
}

export function assertPlanHasValidCheckpoints(planPath) {
  const checkpoints = readPlanCheckpoints(planPath);
  const invalid = checkpoints.find((checkpoint) => !checkpoint.valid);
  if (invalid) {
    throw new Error(`Invalid or duplicate checkpoint_id in plan: ${invalid.checkpointId}`);
  }

  if (checkpoints.length === 0) {
    throw new Error(`Approved plan has no checkpoint_id entries: ${planPath}`);
  }
}