'use strict';

function isMusl() {
  if (process.platform !== 'linux') return false;
  const report = process.report?.getReport();
  if (!report || typeof report === 'string') return false;
  return !report.header.glibcVersionRuntime;
}

function platformSuffix() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
  if (platform === 'win32' && arch === 'x64') return 'win32-x64-msvc';
  if (platform === 'linux' && arch === 'x64') {
    return isMusl() ? 'linux-x64-musl' : 'linux-x64-gnu';
  }
  if (platform === 'linux' && arch === 'arm64') {
    return isMusl() ? 'linux-arm64-musl' : 'linux-arm64-gnu';
  }

  throw new Error(`Unsupported Vindur native platform: ${platform}-${arch}`);
}

const suffix = platformSuffix();
let binding;

try {
  binding = require(`./vindur-native.${suffix}.node`);
} catch (localError) {
  try {
    binding = require(`@vindur-css/native-${suffix}`);
  } catch (packageError) {
    packageError.cause = localError;
    throw packageError;
  }
}

module.exports = binding;
