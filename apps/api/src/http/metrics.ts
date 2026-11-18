const BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

/**
 * Request counters and latency for Prometheus (text format), kept in memory per process. Labels are the route pattern
 * ("/api/bookings/:id"), never the real URL, so ids cannot blow up the number of series.
 */
export class Metrics {
  private readonly count = new Map<string, number>();
  private readonly buckets = new Map<string, number[]>();
  private readonly sum = new Map<string, number>();
  readonly startedAt = Date.now();

  observe(method: string, route: string, status: number, seconds: number): void {
    const key = `${method}\u0000${route}`;
    const c = `${key}\u0000${status}`;
    this.count.set(c, (this.count.get(c) ?? 0) + 1);
    const b = this.buckets.get(key) ?? new Array<number>(BUCKETS.length + 1).fill(0);
    const i = BUCKETS.findIndex((x) => seconds <= x);
    b[i === -1 ? BUCKETS.length : i]! += 1;
    this.buckets.set(key, b);
    this.sum.set(key, (this.sum.get(key) ?? 0) + seconds);
  }

  render(gauges: Record<string, number> = {}): string {
    const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const out: string[] = ["# TYPE ilmak_http_requests_total counter"];
    for (const [k, n] of [...this.count].sort()) {
      const [method, route, status] = k.split("\u0000");
      out.push(`ilmak_http_requests_total{method="${esc(method!)}",route="${esc(route!)}",status="${status}"} ${n}`);
    }
    out.push("# TYPE ilmak_http_request_duration_seconds histogram");
    for (const [k, b] of [...this.buckets].sort()) {
      const [method, route] = k.split("\u0000");
      const l = `method="${esc(method!)}",route="${esc(route!)}"`;
      let cum = 0;
      BUCKETS.forEach((le, i) => {
        cum += b[i]!;
        out.push(`ilmak_http_request_duration_seconds_bucket{${l},le="${le}"} ${cum}`);
      });
      cum += b[BUCKETS.length]!;
      out.push(`ilmak_http_request_duration_seconds_bucket{${l},le="+Inf"} ${cum}`);
      out.push(`ilmak_http_request_duration_seconds_sum{${l}} ${this.sum.get(k)}`);
      out.push(`ilmak_http_request_duration_seconds_count{${l}} ${cum}`);
    }
    for (const [name, v] of Object.entries({ ilmak_uptime_seconds: Math.round((Date.now() - this.startedAt) / 1000), ...gauges })) {
      out.push(`# TYPE ${name} gauge`, `${name} ${v}`);
    }
    return out.join("\n") + "\n";
  }
}
