import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const artifactsDirectory = resolve(repositoryRoot, 'native/artifacts');
const targets = [
  { name: 'aarch64-apple-darwin', crossCompile: false },
  { name: 'x86_64-apple-darwin', crossCompile: false },
  { name: 'x86_64-pc-windows-msvc', crossCompile: true },
  { name: 'x86_64-unknown-linux-gnu', crossCompile: true },
  { name: 'x86_64-unknown-linux-musl', crossCompile: true },
  { name: 'aarch64-unknown-linux-gnu', crossCompile: true },
  { name: 'aarch64-unknown-linux-musl', crossCompile: true },
] as const;

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function listNativeArtifacts(directory: string): string[] {
  const artifacts: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      artifacts.push(...listNativeArtifacts(entryPath));
    } else if (entry.name.endsWith('.node')) {
      artifacts.push(entryPath);
    }
  }

  return artifacts;
}

function main(): void {
  if (process.platform !== 'darwin') {
    throw new Error('The local native release build currently requires macOS.');
  }

  const zigCheck = spawnSync('zig', ['version'], { encoding: 'utf-8' });

  if (zigCheck.status !== 0) {
    throw new Error(
      'Zig is required for cross-compilation. Install it with `brew install zig`.',
    );
  }

  rmSync(artifactsDirectory, { recursive: true, force: true });
  mkdirSync(artifactsDirectory, { recursive: true });

  for (const target of targets) {
    console.log(`\nBuilding ${target.name}...`);
    run('rustup', ['target', 'add', target.name]);

    const buildArgs = [
      '--filter',
      '@vindur-css/native',
      'exec',
      'napi',
      'build',
      '--release',
      '--platform',
      '--target',
      target.name,
      '--manifest-path',
      '../crates/vindur_node/Cargo.toml',
      '--output-dir',
      `artifacts/${target.name}`,
      '--no-js',
      '--no-dts-header',
    ];

    if (target.crossCompile) buildArgs.push('--cross-compile');

    run('pnpm', buildArgs);
  }

  const artifacts = listNativeArtifacts(artifactsDirectory);

  if (artifacts.length !== targets.length) {
    throw new Error(
      `Expected ${targets.length} native artifacts, received ${artifacts.length}.`,
    );
  }

  console.log(`Built ${artifacts.length} native platform artifacts locally.`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to prepare native artifacts: ${message}`);
  process.exit(1);
}
