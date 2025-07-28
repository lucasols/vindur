#!/usr/bin/env node

import { readdir, rmdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Folders that should never be removed, even if empty
const EXCLUDED_FOLDERS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.vscode',
  '.idea',
  'dist',
  'build',
  'coverage',
  '.nyc_output',
  '.cache',
  'public',
  'static',
  'assets',
  '.github',
  '.husky',
  '.vite',
  '.turbo',
  '.env',
]);

// Additional patterns to exclude (folders starting with these)
const EXCLUDED_PATTERNS = ['.', '__', 'node_modules'];

/**
 * Check if a folder should be excluded from removal
 */
function shouldExcludeFolder(folderName: string): boolean {
  // Check exact matches
  if (EXCLUDED_FOLDERS.has(folderName)) {
    return true;
  }

  // Check patterns
  for (const pattern of EXCLUDED_PATTERNS) {
    if (folderName.startsWith(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a directory is empty
 */
async function isDirectoryEmpty(dirPath: string): Promise<boolean> {
  try {
    const files = await readdir(dirPath);
    return files.length === 0;
  } catch (error) {
    // If we can't read the directory, consider it not empty to be safe
    return false;
  }
}

/**
 * Recursively remove empty directories
 */
async function removeEmptyFolders(dirPath: string): Promise<number> {
  let removedCount = 0;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    // Process subdirectories first (depth-first)
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDirPath = join(dirPath, entry.name);

        // Skip excluded folders
        if (shouldExcludeFolder(entry.name)) {
          continue;
        }

        // Recursively process subdirectory
        removedCount += await removeEmptyFolders(subDirPath);
      }
    }

    // After processing subdirectories, check if current directory is now empty
    const currentDirName = dirPath.split('/').pop() || '';
    if (
      !shouldExcludeFolder(currentDirName)
      && (await isDirectoryEmpty(dirPath))
    ) {
      try {
        await rmdir(dirPath);
        console.log(
          `📁 Removed empty folder: ${dirPath.replace(projectRoot, '.')}`,
        );
        removedCount++;
      } catch (error) {
        console.warn(
          `⚠️  Could not remove ${dirPath}: ${(error as Error).message}`,
        );
      }
    }
  } catch (error) {
    console.warn(
      `⚠️  Could not process ${dirPath}: ${(error as Error).message}`,
    );
  }

  return removedCount;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    console.log('🧹 Scanning for empty folders...');
    console.log(`📂 Starting from: ${projectRoot}`);
    console.log(`🚫 Excluding: ${Array.from(EXCLUDED_FOLDERS).join(', ')}`);
    console.log('');

    const removedCount = await removeEmptyFolders(projectRoot);

    console.log('');
    if (removedCount > 0) {
      console.log(
        `✅ Removed ${removedCount} empty folder${removedCount === 1 ? '' : 's'}`,
      );
    } else {
      console.log('✨ No empty folders found to remove');
    }
  } catch (error) {
    console.error('❌ Error removing empty folders:', (error as Error).message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
