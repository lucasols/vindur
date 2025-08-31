import { runCmdUnwrap } from '@ls-stack/node-utils/runShellCmd';

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

async function publishPackage(packageName: PackageName, version: Version) {
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

  // build vite plugin to run e2e tests
  await runCmdUnwrap('Build vite plugin', [
    'pnpm',
    '--filter',
    'vite-plugin',
    'build',
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

  console.log(`🎉 Successfully published ${fullPackageName}`);
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

  if (!packageName || !version) {
    console.error(
      '❌ Usage: node scripts/publishPackage.ts <packageName> <version>',
    );
    console.error(`📦 Available packages: ${availablePackages.join(', ')}`);
    console.error(`🔢 Available versions: ${versions.join(', ')}`);
    process.exit(1);
  }

  await publishPackage(packageName, version);
}

runFromCli();
