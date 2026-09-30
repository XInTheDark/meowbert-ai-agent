import type { FastifyPluginAsync } from "fastify";
import {
  getSkillCatalogGroup,
  isSkillEnabledByConfig,
  isVisibleSkillManifest,
  loadSkillManifestEntries,
  type SkillCatalogGroup
} from "@meowbert/shared";
import { config } from "../lib/config.js";
import { isSuperAdmin } from "../services/admin/admin-settings.js";

interface SkillSummary {
  id: string;
  name: string;
  description: string;
  catalogGroup?: SkillCatalogGroup;
}

function loadAvailableSkills(actorIsSuperAdmin: boolean): SkillSummary[] {
  const rootDir = config.skills?.rootDir;
  if (!rootDir) {
    return [];
  }

  const skills = loadSkillManifestEntries(rootDir);
  return Array.from(skills.values())
    .map((entry) => entry.manifest)
    .filter((manifest) => isVisibleSkillManifest(manifest))
    .filter((manifest) => isSkillEnabledByConfig(config, manifest.id))
    .filter((manifest) => actorIsSuperAdmin || manifest.requiresSuperAdmin !== true)
    .map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      catalogGroup: getSkillCatalogGroup(manifest)
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export const skillRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/skills", { preHandler: fastify.authenticate }, async (request, reply) => {
    const actorIsSuperAdmin = await isSuperAdmin(request.user.id);
    reply.header("Cache-Control", "private, max-age=300");
    return { skills: loadAvailableSkills(actorIsSuperAdmin) };
  });
};
