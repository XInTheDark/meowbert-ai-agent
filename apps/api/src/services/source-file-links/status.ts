import type {
  SourceFileLink,
  SourceFileLinkLocalSnapshot,
  SourceFileLinkProvider,
  SourceFileLinkRemoteSnapshot,
  SourceFileLinkStatusDetails
} from "./types.js";

function getProviderLabel(provider: SourceFileLinkProvider): string {
  if (provider === "google-drive") {
    return "Google Drive";
  }
  if (provider === "pcloud") {
    return "pCloud";
  }
  if (provider === "rclone") {
    return "rclone";
  }
  return "OneDrive";
}

function getLinkNoun(link: SourceFileLink): string {
  return link.linkKind === "folder" ? "folder" : "file";
}

function hasLocalBaseline(link: SourceFileLink): boolean {
  return Boolean(
    link.lastSyncedLocalHash
      || link.lastSyncedLocalModifiedAt
      || link.lastSyncedLocalSizeBytes !== null
  );
}

function hasRemoteBaseline(link: SourceFileLink): boolean {
  return Boolean(
    link.lastSyncedRemoteEtag
      || link.lastSyncedRemoteCtag
      || link.lastSyncedRemoteModifiedAt
      || link.lastSyncedRemoteSizeBytes !== null
  );
}

function compareNullableString(left: string | null, right: string | null): boolean {
  return (left ?? null) === (right ?? null);
}

function compareNullableNumber(left: number | null, right: number | null): boolean {
  return (left ?? null) === (right ?? null);
}

export function didSourceFileLinkLocalChange(
  link: SourceFileLink,
  local: SourceFileLinkLocalSnapshot
): boolean {
  if (!local.exists) {
    return hasLocalBaseline(link);
  }
  if (local.kind !== link.linkKind) {
    return true;
  }

  if (link.lastSyncedLocalHash && local.hash) {
    return link.lastSyncedLocalHash !== local.hash;
  }

  return !(
    compareNullableNumber(link.lastSyncedLocalSizeBytes, local.sizeBytes)
    && compareNullableString(link.lastSyncedLocalModifiedAt, local.modifiedAt)
  );
}

export function didSourceFileLinkRemoteChange(
  link: SourceFileLink,
  remote: SourceFileLinkRemoteSnapshot | null
): boolean {
  if (!remote) {
    return hasRemoteBaseline(link);
  }
  if (remote.kind !== link.linkKind) {
    return true;
  }

  if (link.lastSyncedRemoteEtag && remote.eTag) {
    return link.lastSyncedRemoteEtag !== remote.eTag;
  }

  if (link.lastSyncedRemoteCtag && remote.cTag) {
    return link.lastSyncedRemoteCtag !== remote.cTag;
  }

  return !(
    compareNullableString(link.lastSyncedRemoteModifiedAt, remote.modifiedAt)
    && compareNullableNumber(link.lastSyncedRemoteSizeBytes, remote.sizeBytes)
  );
}

export function buildSourceFileLinkStatus(input: {
  link: SourceFileLink;
  local: SourceFileLinkLocalSnapshot;
  remote: SourceFileLinkRemoteSnapshot | null;
  remoteFetchError?: string | null;
}): SourceFileLinkStatusDetails {
  const localChanged = didSourceFileLinkLocalChange(input.link, input.local);
  const remoteChanged = didSourceFileLinkRemoteChange(input.link, input.remote);
  const providerLabel = getProviderLabel(input.link.provider);
  const noun = getLinkNoun(input.link);

  if (input.remoteFetchError) {
    return {
      link: input.link,
      status: "error",
      local: input.local,
      remote: input.remote,
      localChanged,
      remoteChanged,
      canPull: false,
      canPush: false,
      supportsForcePull: false,
      supportsForcePush: false,
      message: input.remoteFetchError
    };
  }

  if (!input.local.exists && input.remote === null) {
    return {
      link: input.link,
      status: "error",
      local: input.local,
      remote: null,
      localChanged,
      remoteChanged,
      canPull: false,
      canPush: false,
      supportsForcePull: false,
      supportsForcePush: false,
      message: `Both the local working copy and the remote ${providerLabel} ${noun} are missing.`
    };
  }

  if (!input.local.exists) {
    return {
      link: input.link,
      status: "missing_local",
      local: input.local,
      remote: input.remote,
      localChanged,
      remoteChanged,
      canPull: input.remote !== null,
      canPush: false,
      supportsForcePull: false,
      supportsForcePush: false,
      message: input.remote
        ? `The local working copy is missing. Pull to restore it from ${providerLabel}.`
        : "The local working copy is missing."
    };
  }

  if (input.remote === null) {
    return {
      link: input.link,
      status: "missing_remote",
      local: input.local,
      remote: null,
      localChanged,
      remoteChanged,
      canPull: false,
      canPush: false,
      supportsForcePull: false,
      supportsForcePush: false,
      message: `The remote ${providerLabel} ${noun} no longer exists.`
    };
  }

  if (localChanged && remoteChanged) {
    return {
      link: input.link,
      status: "conflict",
      local: input.local,
      remote: input.remote,
      localChanged,
      remoteChanged,
      canPull: true,
      canPush: true,
      supportsForcePull: true,
      supportsForcePush: true,
      message: `Both the local ${noun} and the ${providerLabel} ${noun} changed since the last sync.`
    };
  }

  if (localChanged) {
    return {
      link: input.link,
      status: "local_modified",
      local: input.local,
      remote: input.remote,
      localChanged,
      remoteChanged,
      canPull: true,
      canPush: true,
      supportsForcePull: true,
      supportsForcePush: false,
      message: `The local working copy changed and can be pushed back to ${providerLabel}.`
    };
  }

  if (remoteChanged) {
    return {
      link: input.link,
      status: "remote_modified",
      local: input.local,
      remote: input.remote,
      localChanged,
      remoteChanged,
      canPull: true,
      canPush: false,
      supportsForcePull: false,
      supportsForcePush: true,
      message: `The ${providerLabel} ${noun} changed and can be pulled into the local working copy.`
    };
  }

  return {
    link: input.link,
    status: "synced",
    local: input.local,
    remote: input.remote,
    localChanged,
    remoteChanged,
    canPull: false,
    canPush: false,
    supportsForcePull: false,
    supportsForcePush: false,
    message: null
  };
}
