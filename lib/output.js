"use strict";

const { pathExists } = require("./fsutil");

function actionVerb(action) {
  if (action.kind === "remove") return "REMOVE";
  if (action.kind === "selection") return "UPDATE";
  if (action.kind === "json-merge" || action.kind === "toml-merge") return "MERGE";
  if (action.kind === "copy-tree") return "COPY";
  if (action.kind === "state") return "UPDATE";
  return pathExists(action.destination) ? "REPLACE" : "CREATE";
}

function printPlan(actions, notes) {
  for (const note of notes) console.log(note);
  if (!actions.length) return console.log("Everything is in sync.");
  console.log("\nPending sync:");
  for (const action of actions) console.log(`  - ${actionVerb(action)}: ${action.destination} [${action.label}]`);
}

module.exports = { actionVerb, printPlan };
