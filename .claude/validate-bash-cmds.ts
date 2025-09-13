#!/usr/bin/env node
/**
 * Claude Code Hook: Bash Command Validator
 * =========================================
 * This hook runs as a PreToolUse hook for the Bash tool.
 * It validates bash commands against ESLint usage rules before execution.
 * Specifically blocks running ESLint on individual files.
 *
 * Read more about hooks here: https://docs.anthropic.com/en/docs/claude-code/hooks
 */

import { readFileSync } from 'node:fs';

// Define validation rules as [regex pattern, message] tuples
const validations: { cmd: RegExp; assert: (cmd: string) => true | string }[] = [
  {
    cmd: /(^timeout|^gtimeout)/,
    assert: () => {
      return `timeout is not allowed, the tests commands already native timeout support, just run the command directly`;
    },
  },
];

function validateCommand(command: string): string[] {
  const issues: string[] = [];
  for (const { cmd, assert } of validations) {
    if (cmd.test(command)) {
      const issue = assert(command);
      if (typeof issue === 'string') {
        issues.push(issue);
      }
    }
  }
  return issues;
}

let inputData: { tool_name: string; tool_input: { command: string } };

try {
  inputData = JSON.parse(readFileSync(0, 'utf8'));
} catch (error) {
  console.error(`Error: Invalid JSON input: ${error}`);
  // Exit code 1 shows stderr to the user but not to Claude
  process.exit(1);
}

const toolName = inputData.tool_name || '';
if (toolName !== 'Bash') {
  process.exit(0);
}

const toolInput = inputData.tool_input || {};
const command = toolInput.command || '';

if (!command) {
  process.exit(0);
}

const issues = validateCommand(command);

if (issues.length > 0) {
  for (const message of issues) {
    console.error(message);
  }

  // Exit code 2 blocks tool call and shows stderr to Claude
  process.exit(2);
}
