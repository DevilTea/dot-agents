import { EXIT_CODES } from './schemas.mjs';

export class ParhelionError extends Error {
  constructor(message, exitCode = EXIT_CODES.userError) {
    super(message);
    this.name = new.target.name;
    this.exitCode = exitCode;
  }
}

export class StateError extends ParhelionError {
  constructor(message) {
    super(message, EXIT_CODES.stateError);
  }
}

export class GitError extends ParhelionError {
  constructor(message) {
    super(message, EXIT_CODES.gitError);
  }
}

export class ValidationError extends ParhelionError {
  constructor(message) {
    super(message, EXIT_CODES.validationError);
  }
}

export function exitWithError(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error instanceof ParhelionError ? error.exitCode : EXIT_CODES.userError);
}