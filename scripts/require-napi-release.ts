if (process.env.PKG_MANAGER_NAPI_RELEASE !== '1') {
  console.error(
    'This native release requires a pkg-manager version with N-API release support.',
  );
  console.error(
    'Upgrade @ls-stack/pkg-manager before publishing @vindur/native.',
  );
  process.exit(1);
}
