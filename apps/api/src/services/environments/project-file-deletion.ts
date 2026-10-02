import { deleteSelectedPaths, type DeletedFilesResult } from "../files/delete-files.js";
import { resolveSelectedPathsWithinRoot } from "../files/selected-paths.js";
import {
  unlinkSourceFileLinksAtMissingEnvironmentPaths,
  unlinkSourceFileLinksUnderEnvironmentPaths
} from "../source-file-links/service.js";

// Deletes project files and their live-sync links. A selected path that is already gone but
// still has a link counts as deleted once the link is removed.
export async function deleteProjectFiles(input: {
  environmentId: string;
  rootPath: string;
  requestedPaths: string[];
}): Promise<DeletedFilesResult> {
  const unlinkedMissingPaths = await unlinkSourceFileLinksAtMissingEnvironmentPaths({
    environmentId: input.environmentId,
    environmentRootPath: input.rootPath,
    requestedPaths: input.requestedPaths
  });
  const targets = await resolveSelectedPathsWithinRoot({
    rootPath: input.rootPath,
    requestedPaths: input.requestedPaths.filter((requestedPath) => !unlinkedMissingPaths.includes(requestedPath)),
    rootLabel: "environment",
    action: "delete"
  });
  await unlinkSourceFileLinksUnderEnvironmentPaths({
    environmentId: input.environmentId,
    localRelativePaths: targets.map((target) => target.relativePath)
  });
  const deleted = await deleteSelectedPaths(targets);

  return {
    deletedCount: deleted.deletedCount + unlinkedMissingPaths.length,
    deletedPaths: [...deleted.deletedPaths, ...unlinkedMissingPaths]
  };
}
