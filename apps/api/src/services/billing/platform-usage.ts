import { createPlatformUsageRecorder } from "@meowbert/shared";
import { query } from "../../lib/db.js";

export const platformUsageRecorder = createPlatformUsageRecorder(query);
