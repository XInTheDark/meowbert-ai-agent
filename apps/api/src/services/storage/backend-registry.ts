import { StorageBackendRuntimeRegistry } from "@meowbert/shared/storage-backend-runtime";
import { config } from "../../lib/config.js";

export const storageBackendRegistry = new StorageBackendRuntimeRegistry(config.storage, {
  logger: {
    info: (message) => console.info(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message)
  }
});
