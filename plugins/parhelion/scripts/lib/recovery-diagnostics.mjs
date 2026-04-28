export function diagnoseTaskState(task, recovery) {
  const findings = [];

  if (!task) {
    findings.push('No active task is selected.');
    return findings;
  }

  if (task.phase === 'execute' && !task.latestApprovedPlanRevision) {
    findings.push('Task is in execute phase without an approved plan revision.');
  }

  if (task.phase === 'plan' && !task.latestApprovedRequirementsRevision) {
    findings.push('Task is in plan phase without an approved requirements revision.');
  }

  if (recovery?.requiresUserApproval && recovery.pendingAction !== 'awaiting-user-approval') {
    findings.push('Recovery requires user approval but pendingAction is not awaiting-user-approval.');
  }

  if (task.status !== 'active' && recovery?.pendingAction !== 'idle') {
    findings.push('Terminal task has a non-idle recovery pendingAction.');
  }

  return findings;
}