import path from "node:path";

/**
 * Check lexical containment. Callers handling existing files must also validate real paths.
 * @param {string} basePath
 * @param {string} candidatePath
 * @returns {boolean}
 */
export function isWithinPath(basePath, candidatePath) {
  const relative = path.relative(path.resolve(basePath), path.resolve(candidatePath));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
