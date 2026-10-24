import { imageRepository, type SandboxImageReference } from "./manager";
import { sandboxArchitecture } from "./platform";

interface Manifest {
  manifests?: Array<{ digest: string; platform?: { os?: string; architecture?: string } }>;
  layers?: Array<{ size: number }>;
  config?: { size?: number };
}
const accept = ["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"].join(", ");

// Read only manifest metadata; pulling layers still requires the user's download consent.
export async function sandboxDownloadSize(image: SandboxImageReference, request: typeof fetch = fetch): Promise<number | null> {
  if (!image.digest) return null;
  const parts = imageRepository(image.reference).split("/");
  const explicitRegistry = parts.length > 1 && /[.:]|^localhost$/.test(parts[0]);
  const registry = explicitRegistry ? parts.shift()! : "registry-1.docker.io";
  const repository = parts.length === 1 && !explicitRegistry ? "library/" + parts[0] : parts.join("/");
  const base = "https://" + registry + "/v2/" + repository + "/manifests/";
  const signal = AbortSignal.timeout(10_000);
  let token: string | null = null;
  const read = async (digest: string): Promise<Manifest | null> => {
    const headers: Record<string, string> = { accept };
    if (token) headers.authorization = "Bearer " + token;
    let response = await request(base + encodeURIComponent(digest), { headers, signal });
    if (response.status === 401 && !token) {
      const challenge = response.headers.get("www-authenticate") ?? "";
      if (!/^Bearer /i.test(challenge)) return null;
      const fields = Object.fromEntries([...challenge.matchAll(/(realm|service|scope)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
      if (!fields.realm) return null;
      const auth = new URL(fields.realm);
      if (auth.protocol !== "https:") return null;
      if (fields.service) auth.searchParams.set("service", fields.service);
      auth.searchParams.set("scope", fields.scope ?? "repository:" + repository + ":pull");
      const credentials = await request(auth, { signal });
      if (!credentials.ok) return null;
      const data = await credentials.json() as { token?: string; access_token?: string };
      token = data.token ?? data.access_token ?? null;
      if (!token) return null;
      response = await request(base + encodeURIComponent(digest), { headers: { ...headers, authorization: "Bearer " + token }, signal });
    }
    return response.ok ? await response.json() as Manifest : null;
  };
  try {
    let manifest = await read(image.digest);
    if (manifest?.manifests) {
      const selected = manifest.manifests.find((entry) => entry.platform?.os === "linux" && entry.platform.architecture === sandboxArchitecture());
      if (!selected) return null;
      manifest = await read(selected.digest);
    }
    if (!manifest?.layers?.length || manifest.layers.some((layer) => !Number.isFinite(layer.size) || layer.size < 0)) return null;
    return manifest.layers.reduce((total, layer) => total + layer.size, manifest.config?.size ?? 0);
  } catch { return null; }
}
