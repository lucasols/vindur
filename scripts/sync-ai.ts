#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const projectRoot = join(import.meta.dirname, '..');
const claudeMdPath = join(projectRoot, 'CLAUDE.md');
const cursorRulesPath = join(projectRoot, '.cursor/rules/global.mdc');

const globalHeader = `---
description:
globs:
alwaysApply: true
---
`;

try {
  const claudeMdContent = readFileSync(claudeMdPath, 'utf-8');
  const fullContent = globalHeader + claudeMdContent;

  writeFileSync(cursorRulesPath, fullContent, 'utf-8');

  console.info(' Successfully synced CLAUDE.md to .cursor/rules/global.mdc');
} catch (error) {
  console.error('L Error syncing files:', error);
  process.exit(1);
}
