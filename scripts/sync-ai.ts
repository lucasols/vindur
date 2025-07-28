import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const CLAUDE_MD_PATH = join(process.cwd(), 'CLAUDE.md');
const GLOBAL_MDC_PATH = join(process.cwd(), '.cursor/rules/global.mdc');

function syncAI() {
  try {
    const claudeContent = readFileSync(CLAUDE_MD_PATH, 'utf-8');

    // Add a header indicating this is generated from CLAUDE.md
    const globalMdc = `---
alwaysApply: true
---

${claudeContent.replace(
  `# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.`,
  '',
)}`;

    // Ensure the directory exists
    mkdirSync(dirname(GLOBAL_MDC_PATH), { recursive: true });

    writeFileSync(GLOBAL_MDC_PATH, globalMdc, 'utf-8');
    console.log(
      '✅ Synced AI guidelines to .cursor/rules/global.mdc successfully',
    );
  } catch (error) {
    console.error('❌ Error syncing AI guidelines:', error);
    process.exit(1);
  }
}

syncAI();
