import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export async function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath, { signal })) hash.update(chunk);
  return hash.digest("hex");
}
