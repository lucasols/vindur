#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const specsDir = join(projectRoot, 'specs');
const specIndexPath = join(projectRoot, 'SPEC.md');

/**
 * Extracts the title from a markdown file by reading the first # heading
 */
async function extractTitle(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) {
        return trimmed.substring(2).trim();
      }
    }
    
    // Fallback to filename if no title found
    const filename = filePath.split('/').pop()?.replace('.md', '') ?? '';
    return filename.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  } catch (error) {
    console.warn(`Warning: Could not read ${filePath}:`, (error as Error).message);
    return null;
  }
}


/**
 * Gets all markdown files in the specs directory (excluding README.md)
 */
async function getSpecFiles(): Promise<string[]> {
  try {
    const files = await readdir(specsDir);
    return files
      .filter(file => file.endsWith('.md') && file !== 'README.md')
      .sort();
  } catch (error) {
    console.error('Error reading specs directory:', (error as Error).message);
    return [];
  }
}

/**
 * Generates the SPEC.md content
 */
async function generateSpecIndex(): Promise<string | null> {
  const specFiles = await getSpecFiles();
  
  if (specFiles.length === 0) {
    console.warn('No specification files found in specs/ directory');
    return null;
  }
  
  let content = `# Vindur Transform Specifications

> **Auto-generated file** - Do not edit manually. Run \`pnpm generate-spec\` to regenerate.

This document serves as an index for all transform specifications in Vindur. Each specification covers detailed transform logic for specific features.

## Transform Specifications

`;

  // Process each spec file
  for (const file of specFiles) {
    const filePath = join(specsDir, file);
    const title = await extractTitle(filePath);
    
    if (title) {
      const relativePath = `./specs/${file}`;
      content += `- [${title}](${relativePath})
`;
    }
  }
  
  content += `## Development

To regenerate this index file, run:

\`\`\`bash
pnpm generate-spec
\`\`\`

## Structure

All detailed specifications are located in the [\`specs/\`](./specs/) directory. Each file focuses on a specific transform feature to maintain clarity and ease of maintenance.
`;

  return content;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    console.log('Generating SPEC.md index...');
    
    const content = await generateSpecIndex();
    if (!content) {
      console.error('Failed to generate content');
      process.exit(1);
    }
    
    await writeFile(specIndexPath, content, 'utf-8');
    console.log('✅ SPEC.md generated successfully');
    
    // List the specs that were included
    const specFiles = await getSpecFiles();
    console.log(`📋 Included ${specFiles.length} specifications:`);
    specFiles.forEach(file => console.log(`   - ${file}`));
    
  } catch (error) {
    console.error('❌ Error generating SPEC.md:', (error as Error).message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}