import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  LIVE_SYNC_FOLDER_SEARCH_FILE_TYPES,
  LIVE_SYNC_FOLDER_SEARCH_MATCHES,
  LIVE_SYNC_FOLDER_SEARCH_MAX_DEPTH,
  LIVE_SYNC_FOLDER_SEARCH_MAX_LIMIT,
  LIVE_SYNC_FOLDER_SEARCH_ORDERS
} from "@meowbert/shared/live-sync-folder-search";
import {
  ScopedAccessTicketError,
  verifyScopedAccessTicket
} from "../services/auth/scoped-access-tickets.js";
import { workspaceParams } from "./environments/shared.js";

export interface SourceRouteAccessPayload {
  userId: string;
  workspaceId: string | null;
}

export const sourceParams = workspaceParams.extend({
  sourceId: z.string().min(1).max(120)
});

export const sourceSearchQuery = z.object({
  q: z.string().trim().min(1).max(240),
  folderId: z.string().trim().min(1).max(1200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

export const sourcePathQuery = z.object({
  path: z.string().trim().min(1).max(1200),
  folderId: z.string().trim().min(1).max(1200).optional()
});

export const sourceBrowseQuery = z.object({
  folderId: z.string().trim().min(1).max(1200).optional(),
  limit: z.coerce.number().int().min(1).max(400).optional()
});

export const internalLiveSyncTaskParams = z.object({
  taskId: z.string().uuid()
});

export const internalLiveSyncStatusQuery = z.object({
  path: z.string().trim().min(1).max(1200)
});

export const internalLiveSyncMutationBody = z.object({
  path: z.string().trim().min(1).max(1200),
  force: z.boolean().optional()
}).strict();

const isoTimestamp = z.string().trim().max(64).refine((value) => Number.isFinite(Date.parse(value)), "Expected an ISO 8601 timestamp.")
  .transform((value) => new Date(value).toISOString());

export const internalLiveSyncSearchBody = z.object({
  path: z.string().trim().min(1).max(1200),
  subfolder: z.string().max(1200).nullable().default(null),
  depth: z.number().int().min(0).max(LIVE_SYNC_FOLDER_SEARCH_MAX_DEPTH).default(0),
  query: z.string().trim().max(500).nullable().default(null).transform((value) => value || null),
  match: z.enum(LIVE_SYNC_FOLDER_SEARCH_MATCHES).default("full_text"),
  fileTypes: z.array(z.enum(LIVE_SYNC_FOLDER_SEARCH_FILE_TYPES)).max(LIVE_SYNC_FOLDER_SEARCH_FILE_TYPES.length).default([]),
  modifiedAfter: isoTimestamp.nullable().default(null),
  modifiedBefore: isoTimestamp.nullable().default(null),
  extraQuery: z.string().trim().max(1000).nullable().default(null).transform((value) => value || null),
  orderBy: z.enum(LIVE_SYNC_FOLDER_SEARCH_ORDERS).default("relevance"),
  limit: z.number().int().min(1).max(LIVE_SYNC_FOLDER_SEARCH_MAX_LIMIT).default(25)
}).strict();

export function extractBearerToken(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    throw new ScopedAccessTicketError();
  }

  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new ScopedAccessTicketError();
  }

  return match[1];
}

export async function requireSourceProxyAccess(input: {
  fastify: Parameters<FastifyPluginAsync>[0];
  ticket: string;
  sourceId: string;
}): Promise<SourceRouteAccessPayload> {
  return verifyScopedAccessTicket(input.fastify, {
    ticket: input.ticket,
    scope: "source_proxy",
    sourceId: input.sourceId
  });
}

export async function requireLiveSyncProxyAccess(input: {
  fastify: Parameters<FastifyPluginAsync>[0];
  ticket: string;
  taskId: string;
}): Promise<SourceRouteAccessPayload> {
  return verifyScopedAccessTicket(input.fastify, {
    ticket: input.ticket,
    scope: "live_sync_proxy",
    taskId: input.taskId
  });
}
