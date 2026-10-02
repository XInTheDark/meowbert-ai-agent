import { z } from "zod";
import { FILE_UPLOAD_LIMIT_BYTES } from "../../services/files/save-uploaded-file.js";

// Request shapes shared by the workspace and project file browsers.

const booleanQuerySchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

export const fileQuery = z.object({
  path: z.string().max(1200).optional()
});

export const requiredFileQuery = z.object({
  path: z.string().min(1).max(1200)
});

export const batchFileDownloadQuery = z.object({
  path: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .transform((paths) => paths.map((value) => value.trim()).filter((value) => value.length > 0))
    .refine((paths) => paths.length > 0, { message: "At least one file path is required" })
    .refine((paths) => paths.length <= 200, { message: "A maximum of 200 paths can be downloaded at once" }),
  cwd: z.string().max(1200).optional().default("")
});

export const fileUploadQuery = z.object({
  path: z.string().max(1200).optional(),
  createDirectories: booleanQuerySchema.optional().default(false)
});

export const createTextFileBody = z.object({
  name: z.string().trim().min(1).max(255),
  content: z.string().max(FILE_UPLOAD_LIMIT_BYTES)
}).strict();

export const deleteFilesBody = z.object({
  paths: z.array(z.string().min(1).max(1200)).min(1).max(200)
});
