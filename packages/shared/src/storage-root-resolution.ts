import fsPromises from "node:fs/promises";
import path from "node:path";

export async function canonicalizeStorageRoot(rootPath: string): Promise<string> {
  const resolvedRoot = path.resolve(rootPath);
  await fsPromises.mkdir(resolvedRoot, { recursive: true });
  return await fsPromises.realpath(resolvedRoot).catch(() => resolvedRoot);
}

export async function resolveCanonicalStorageRoot(input: {
  configuredRoot: string;
  managedRoot: string;
  persistRoot: (rootPath: string) => Promise<void>;
}): Promise<string> {
  const canonicalManagedRoot = await canonicalizeStorageRoot(input.managedRoot);
  const trimmedConfiguredRoot = input.configuredRoot.trim();

  if (trimmedConfiguredRoot.length === 0) {
    await input.persistRoot(canonicalManagedRoot);
    return canonicalManagedRoot;
  }

  const canonicalConfiguredRoot = await canonicalizeStorageRoot(trimmedConfiguredRoot);
  if (canonicalConfiguredRoot !== input.configuredRoot) {
    await input.persistRoot(canonicalConfiguredRoot);
  }

  return canonicalConfiguredRoot;
}
