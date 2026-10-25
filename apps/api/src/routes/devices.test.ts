import Fastify from "fastify";
import { expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("../lib/db.js", () => ({ query, withTransaction: vi.fn() }));
vi.mock("../lib/config.js", () => ({ config: {
  localExecution: { enabled: true }, runApi: { url: "http://worker" }, storage: { backends: [] },
  runtime: { sandbox: { image: "api-default-image:main" }, shell: "/bin/bash" }, skills: {}
} }));
vi.mock("../services/workspaces/workspace-access.js", () => ({ assertEnvironmentMember: vi.fn() }));
import { deviceRoutes } from "./devices.js";
it("returns the worker's recorded repository and digest for desktop pulls", async () => {
  query.mockResolvedValue({ rows: [{ sandbox_image_reference: "registry.example/worker-image:main", sandbox_image_digest: "sha256:worker" }] });
  const app = Fastify(); app.decorate("authenticate", async (request: any) => { request.user = { id: "user-1" }; });
  await app.register(deviceRoutes);
  try {
    const response = await app.inject({ method: "GET", url: "/api/local-execution/config" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ enabled: true, sandboxImage: { reference: "registry.example/worker-image:main", digest: "sha256:worker" } });
  } finally { await app.close(); }
});
it("renews presence only for the authenticated owner and current stream, rejecting stale acknowledgements", async () => {
  const app=Fastify();app.decorate("authenticate",async(request:any)=>{request.user={id:"owner"};});await app.register(deviceRoutes);
  const deviceId="11111111-1111-4111-8111-111111111111";const connectionId="22222222-2222-4222-8222-222222222222";
  try {
    query.mockResolvedValueOnce({rowCount:1,rows:[{id:deviceId}]});
    const response=await app.inject({method:"POST",url:"/api/devices/"+deviceId+"/presence",payload:{connectionId}});
    expect(response.statusCode).toBe(200);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("AND stream_connection_id = $3 AND revoked_at IS NULL"),[deviceId,"owner",connectionId]);
    query.mockResolvedValueOnce({rowCount:0,rows:[]});
    expect((await app.inject({method:"POST",url:"/api/devices/"+deviceId+"/presence",payload:{connectionId}})).statusCode).toBe(409);
  }finally{await app.close();}
});
