import { beforeAll, describe, expect, it } from "vitest";
import { Metrics } from "../src/http/metrics.js";
import { makeHarness } from "./helpers/harness.js";

describe("readiness", () => {
  let h: Awaited<ReturnType<typeof makeHarness>>;
  beforeAll(async () => { h = await makeHarness(); });
  const checks = (c: Record<string, () => Promise<void>> | undefined) => { (h.ctx as { checks?: unknown }).checks = c; };

  it("is ready when the database answers, with no extra checks", async () => {
    expect((await h.call("GET", "/api/ready")).body).toEqual({ ok: true });
  });
  it("says which check failed, with 503, and recovers", async () => {
    checks({ redis: async () => { throw new Error("down"); }, other: async () => {} });
    const r = await h.call("GET", "/api/ready");
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ ok: false, failed: ["redis"] });
    checks({ redis: async () => {} });
    expect((await h.call("GET", "/api/ready")).status).toBe(200);
  });
});

describe("metrics", () => {
  it("counts requests by route pattern and status, and buckets latency", () => {
    const m = new Metrics();
    m.observe("GET", "/api/bookings/:id", 200, 0.03);
    m.observe("GET", "/api/bookings/:id", 404, 0.2);
    m.observe("GET", "/api/bookings/:id", 200, 9);
    const t = m.render({ ilmak_websocket_connections: 3 });
    expect(t).toContain('ilmak_http_requests_total{method="GET",route="/api/bookings/:id",status="200"} 2');
    expect(t).toContain('ilmak_http_requests_total{method="GET",route="/api/bookings/:id",status="404"} 1');
    expect(t).toContain('le="0.05"} 1');
    expect(t).toContain('le="0.25"} 2');
    expect(t).toContain('le="+Inf"} 3');
    expect(t).toContain("ilmak_http_request_duration_seconds_count{method=\"GET\",route=\"/api/bookings/:id\"} 3");
    expect(t).toContain("ilmak_websocket_connections 3");
    expect(t).toContain("ilmak_uptime_seconds");
  });

  it("is off without a token, locked with one, and records real traffic under route patterns", async () => {
    const h = await makeHarness();
    expect((await h.call("GET", "/api/metrics")).status).toBe(404);
    await h.app.close();

    const h2 = await makeHarness({ metricsToken: "t".repeat(24) });
    expect(h2.ctx.metrics).toBeDefined();
    const t = await h2.signup("teacher");
    await h2.call("GET", "/api/teacher/me", { token: t.token });
    await h2.call("GET", `/api/bookings/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`, { token: t.token });
    expect((await h2.call("GET", "/api/metrics")).status).toBe(401);
    const bad = await h2.app.inject({ method: "GET", url: "/api/metrics", headers: { authorization: "Bearer " + "x".repeat(24) } });
    expect(bad.statusCode).toBe(401);
    const ok = await h2.app.inject({ method: "GET", url: "/api/metrics", headers: { authorization: "Bearer " + "t".repeat(24) } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toContain("text/plain");
    expect(ok.body).toContain('route="/api/teacher/me"');
    expect(ok.body).toContain('route="/api/bookings/:id"');
    expect(ok.body).not.toContain("00000000-0000");
  });
});
