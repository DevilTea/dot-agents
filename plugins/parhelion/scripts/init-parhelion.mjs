#!/usr/bin/env node

import { ensureStateRoot } from './lib/state-root.mjs';

function main() {
  const targetArg = process.argv[2] || '.';

  const { parhelionRoot, createdFiles, reusedFiles } = ensureStateRoot(targetArg);

  console.log(`Initialized Parhelion state root at ${parhelionRoot}`);
  console.log(`Created ${createdFiles.length} file(s)`);
  for (const filePath of createdFiles) {
    console.log(`  + ${filePath}`);
  }

  if (reusedFiles.length > 0) {
    console.log(`Reused ${reusedFiles.length} existing file(s)`);
    for (const filePath of reusedFiles) {
      console.log(`  = ${filePath}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}