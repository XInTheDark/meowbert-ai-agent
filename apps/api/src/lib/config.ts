import { assertEnabledBundledSkillManifestsPresent, loadConfig } from "@meowbert/shared";

export const config = loadConfig();
assertEnabledBundledSkillManifestsPresent(config);

export const secrets = {
  jwtSecret: config.security.jwtSecret
};
