type Result = {
  css: string
  styleDependencies: string[]
  code: string
}

export function transform({
  fileId,
  source,
}: {
  fileId: string
  source: string
}): Result {
  // todo
}
