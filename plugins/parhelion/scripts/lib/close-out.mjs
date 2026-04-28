import { readFileSync } from 'fs';

export function buildSummaryArtifact({ task, disposition, revision, reviewRevision, rationale, now, reviewPaths = [] }) {
  const requirementsRevision = task.latestApprovedRequirementsRevision ?? '';
  const planRevision = task.latestApprovedPlanRevision ?? '';
  const summaryRationale = rationale || 'No additional rationale provided.';
  const reviewList = reviewPaths.length > 0
    ? reviewPaths.map((path) => `- ${path}`).join('\n')
    : '- No review artifacts were referenced.';

  return `---
task_id: ${task.taskId}
artifact: summary
revision: ${revision}
status: final
disposition: ${disposition}
plan_revision: ${planRevision}
requirements_revision: ${requirementsRevision}
review_revision: ${reviewRevision ?? ''}
---

# Close-out Summary

## Disposition

${disposition}

## Task

${task.title}

## Revisions

- Requirements: ${requirementsRevision || 'not created'}
- Plan: ${planRevision || 'not created'}
- Final Review: ${reviewRevision || 'not created'}

## Review Artifacts

${reviewList}

## Rationale

${summaryRationale}

## Closed At

${now}
`;
}

export function readReviewStatus(path) {
  const content = readFileSync(path, 'utf8');
  const match = content.match(/^status:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}