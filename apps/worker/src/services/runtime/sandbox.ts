import { DockerSandboxManager } from "@meowbert/shared/docker-sandbox";
import { config } from "../../lib/config.js";

export const workerSandboxManager = new DockerSandboxManager(config.runtime.sandbox);
