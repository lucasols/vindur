import { runCmdUnwrap } from '@ls-stack/node-utils/runShellCmd';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLISH_HASHES_FILE = join(__dirname, 'publish-hashes.json');

const availablePackages = ['vindur', 'vite-plugin'] as const;

type PackageName = (typeof availablePackages)[number];

const versions = ['major', 'minor', 'patch'] as const;
type Version = (typeof versions)[number];

function narrowStringToUnion<T extends readonly string[]>(
  value: string | undefined,
  allowedValues: T,
): T[number] | undefined {
  if (!value) return undefined;
  return allowedValues.includes(value as T[number]) ?
      (value as T[number])
    : undefined;
}

type PublishHashesData = {
  vindur: Record<string, string>;
  '@vindur-css/vite-plugin': Record<string, string>;
};

/**
 * Generate a SHA-256 hash for all files in a directory recursively
 */
async function generateDirectoryHash(dirPath: string): Promise<string> {
  if (!existsSync(dirPath)) {
    throw new Error(`Directory does not exist: ${dirPath}`);
  }

  const hash = createHash('sha256');
  const files: string[] = [];

  // Recursively collect all files with their content
  function collectFiles(currentPath: string, relativePath = '') {
    const items = readdirSync(currentPath).sort(); // Sort for consistent ordering
    
    for (const item of items) {
      const fullPath = join(currentPath, item);
      const itemRelativePath = relativePath ? join(relativePath, item) : item;
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        collectFiles(fullPath, itemRelativePath);
      } else {
        files.push(itemRelativePath);
      }
    }
  }

  collectFiles(dirPath);

  // Hash each file path and content
  for (const filePath of files) {
    const fullPath = join(dirPath, filePath);
    const content = readFileSync(fullPath);
    
    hash.update(filePath); // Include file path in hash
    hash.update(content);  // Include file content in hash
  }

  return hash.digest('hex');
}

/**
 * Read existing publish hashes from JSON file
 */
function readPublishHashes(): PublishHashesData {
  if (!existsSync(PUBLISH_HASHES_FILE)) {
    return {
      vindur: {},
      '@vindur-css/vite-plugin': {}
    };
  }

  try {
    const content = readFileSync(PUBLISH_HASHES_FILE, 'utf-8');
    return JSON.parse(content) as PublishHashesData;
  } catch (error) {
    console.warn('⚠️  Could not read publish hashes file, starting fresh');
    return {
      vindur: {},
      '@vindur-css/vite-plugin': {}
    };
  }
}

/**
 * Write publish hashes to JSON file
 */
function writePublishHashes(data: PublishHashesData): void {
  writeFileSync(PUBLISH_HASHES_FILE, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Check if the current hash has already been published
 */
async function checkHashBeforePublish(packageName: string, currentHash: string, force = false): Promise<void> {
  const hashes = readPublishHashes();
  const packageHashes = hashes[packageName as keyof PublishHashesData];

  // Check if this hash already exists for any version
  for (const [version, hash] of Object.entries(packageHashes)) {
    if (hash === currentHash) {
      if (force) {
        console.warn(`⚠️  This build has already been published as ${packageName}@${version}`);
        console.warn(`   Hash: ${currentHash}`);
        console.warn('   Force flag enabled - proceeding with publish anyway.');
        return;
      }
      
      console.error(`❌ This build has already been published as ${packageName}@${version}`);
      console.error(`   Hash: ${currentHash}`);
      console.error('   No changes detected in the build output.');
      console.error('   Make code changes before attempting to publish.');
      console.error('   Or use --force flag to publish anyway: node scripts/publishPackage.ts <package> <version> --force');
      process.exit(1);
    }
  }

  console.log(`✅ New build hash verified: ${currentHash.slice(0, 12)}...`);
}

/**
 * Save hash after successful publish
 */
function savePublishHash(packageName: string, version: string, hash: string): void {
  const hashes = readPublishHashes();
  hashes[packageName as keyof PublishHashesData][version] = hash;
  writePublishHashes(hashes);
  console.log(`📝 Saved publish hash for ${packageName}@${version}`);
}

async function publishPackage(packageName: PackageName, version: Version, force = false) {
  await checkIfIsSync();

  const packagePath = packageName === 'vindur' ? './lib' : './vite-plugin';
  const fullPackageName =
    packageName === 'vindur' ? 'vindur' : '@vindur-css/vite-plugin';

  // If publishing vite-plugin, build vindur first since it depends on it
  if (packageName === 'vite-plugin') {
    await runCmdUnwrap('Build vindur dependency', [
      'pnpm',
      '--filter',
      'vindur',
      'build',
    ]);
  }

  // Run tests for the package
  await runCmdUnwrap('Test package', [
    'pnpm',
    '--filter',
    fullPackageName,
    'test',
  ]);

  // Run lint for the package
  await runCmdUnwrap('Lint package', [
    'pnpm',
    '--filter',
    fullPackageName,
    'lint',
  ]);

  // run e2e tests
  await runCmdUnwrap('Run e2e tests', ['pnpm', 'e2e:test']);

  // Check if there are any changes to commit
  const gitStatus = await runCmdUnwrap('Check git status', [
    'git',
    'status',
    '--porcelain',
  ]);
  if (gitStatus.trim()) {
    await runCmdUnwrap('Stage all changes', ['git', 'add', '.']);
    await runCmdUnwrap('Commit fixes', [
      'git',
      'commit',
      '-m',
      `chore: fix linting issues in ${packageName}`,
    ]);
  }

  // Build package
  await runCmdUnwrap('Build package', [
    'pnpm',
    '--filter',
    fullPackageName,
    'build',
  ]);

  // Check if there are any changes to commit after build
  await commitChanges(`chore: update build artifacts for ${packageName}`);

  // Check if we're trying to republish the same code
  const distPath = join(packagePath, 'dist');
  const currentHash = await generateDirectoryHash(distPath);
  await checkHashBeforePublish(fullPackageName, currentHash, force);

  // Bump version
  await runCmdUnwrap('Bump version', ['pnpm', 'version', version], {
    cwd: packagePath,
  });

  await commitChanges(`chore: bump version for ${packageName}`);

  // Publish package
  await runCmdUnwrap(
    'Publish package',
    ['pnpm', 'publish', '--access', 'public'],
    {
      cwd: packagePath,
    },
  );

  // Save hash after successful publish
  const packageJsonPath = join(packagePath, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const publishedVersion = packageJson.version;
  savePublishHash(fullPackageName, publishedVersion, currentHash);
  
  // Commit the updated publish hashes
  await commitChanges(`chore: update publish hashes for ${fullPackageName}@${publishedVersion}`);
  
  console.log(`🎉 Successfully published ${fullPackageName}@${publishedVersion}`);
}

async function checkIfIsSync() {
  const gitStatus = await runCmdUnwrap('Check git status', [
    'git',
    'status',
    '--porcelain',
  ]);

  if (gitStatus.trim()) {
    console.error('❌ Git is not sync, commit your changes first');
    process.exit(1);
  }
}

async function commitChanges(message: string) {
  const gitStatus = await runCmdUnwrap('Check git status', [
    'git',
    'status',
    '--porcelain',
  ]);

  if (gitStatus.trim()) {
    await runCmdUnwrap('Stage all changes', ['git', 'add', '.']);
    await runCmdUnwrap('Commit changes', ['git', 'commit', '-m', message]);
  } else {
    console.log('ℹ️  No changes to commit');
  }
}

async function runFromCli() {
  const packageName = narrowStringToUnion(process.argv[2], availablePackages);
  const version = narrowStringToUnion(process.argv[3], versions);
  const force = process.argv.includes('--force');

  if (!packageName || !version) {
    console.error(
      '❌ Usage: node scripts/publishPackage.ts <packageName> <version> [--force]',
    );
    console.error(`📦 Available packages: ${availablePackages.join(', ')}`);
    console.error(`🔢 Available versions: ${versions.join(', ')}`);
    console.error('🚀 Use --force to publish even if no changes are detected');
    process.exit(1);
  }

  await publishPackage(packageName, version, force);
}

runFromCli();
