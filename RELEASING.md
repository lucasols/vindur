# Releasing Vindur

Use pkg-manager for every npm release. The native loader and its seven platform
packages are one release unit; do not bump or publish the generated platform
packages manually.

## Native compiler

Before publishing, place the release binaries produced for every target in
`native/artifacts`. The native package's `pre-publish` script tests the local
binding, regenerates `native/npm`, and collects those artifacts. pkg-manager
then synchronizes all platform versions, validates the complete artifact set,
updates the root optional dependencies, and publishes the platform packages
before `@vindur/native`.

Preview the release without changing files or publishing:

```bash
pnpm publish:native --type patch --dry-run
```

Publish it:

```bash
pnpm publish:native --type patch
```

Use the same version type for prereleases. pkg-manager applies the prerelease
dist-tag to both the platform packages and the root loader.

## Package order

Publish only the affected layers, in this order:

1. `@vindur/native` when Rust compiler output changed.
2. `vindur` when the public compiler package changed or needs the new native version.
3. `@vindur-css/vite-plugin` and `@vindur-css/eslint-plugin` after `vindur` when their dependency must move forward.

The generated `native/npm/*/package.json` files are committed so release diffs
remain reviewable. Their versions and the root optional dependencies are updated
automatically during the native release.
