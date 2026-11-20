import {
  CallHandler,
  Controller,
  Header,
  Inject,
  Get,
  Injectable,
  Module,
  NestInterceptor,
  ExecutionContext,
} from "@nestjs/common";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Observable, tap } from "rxjs";

const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

interface RequestSeries {
  method: string;
  route: string;
  statusCode: number;
  count: number;
}

interface DurationSeries {
  method: string;
  route: string;
  count: number;
  sum: number;
  buckets: number[];
}

interface RoutedRequest {
  method?: string;
  route?: { path?: string | string[] };
}

interface RoutedResponse {
  statusCode?: number;
}

function escapeLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}

function seriesKey(...values: Array<string | number>): string {
  return JSON.stringify(values);
}

@Injectable()
export class ApiMetricsRegistry {
  private readonly requestSeries = new Map<string, RequestSeries>();
  private readonly durationSeries = new Map<string, DurationSeries>();

  observe(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const normalizedMethod = /^[A-Z]{1,12}$/.test(method) ? method : "OTHER";
    const normalizedRoute = route.startsWith("/") ? route : "unmatched";
    const normalizedStatus = Number.isInteger(statusCode) ? statusCode : 500;
    const requestKey = seriesKey(
      normalizedMethod,
      normalizedRoute,
      normalizedStatus,
    );
    const request = this.requestSeries.get(requestKey) ?? {
      method: normalizedMethod,
      route: normalizedRoute,
      statusCode: normalizedStatus,
      count: 0,
    };
    request.count += 1;
    this.requestSeries.set(requestKey, request);

    const durationKey = seriesKey(normalizedMethod, normalizedRoute);
    const duration = this.durationSeries.get(durationKey) ?? {
      method: normalizedMethod,
      route: normalizedRoute,
      count: 0,
      sum: 0,
      buckets: DURATION_BUCKETS.map(() => 0),
    };
    const safeDuration = Number.isFinite(durationSeconds)
      ? Math.max(0, durationSeconds)
      : 0;
    duration.count += 1;
    duration.sum += safeDuration;
    DURATION_BUCKETS.forEach((bucket, index) => {
      if (safeDuration <= bucket)
        duration.buckets[index] = (duration.buckets[index] ?? 0) + 1;
    });
    this.durationSeries.set(durationKey, duration);
  }

  render(): string {
    const lines = [
      "# HELP rdps_http_requests_total Total HTTP requests served by RDPS API.",
      "# TYPE rdps_http_requests_total counter",
    ];
    for (const item of [...this.requestSeries.values()].sort((left, right) =>
      seriesKey(left.method, left.route, left.statusCode).localeCompare(
        seriesKey(right.method, right.route, right.statusCode),
      ),
    )) {
      lines.push(
        `rdps_http_requests_total{method="${escapeLabel(item.method)}",route="${escapeLabel(item.route)}",status_code="${item.statusCode}"} ${item.count}`,
      );
    }

    lines.push(
      "# HELP rdps_http_request_duration_seconds HTTP request latency in seconds.",
      "# TYPE rdps_http_request_duration_seconds histogram",
    );
    for (const item of [...this.durationSeries.values()].sort((left, right) =>
      seriesKey(left.method, left.route).localeCompare(
        seriesKey(right.method, right.route),
      ),
    )) {
      const labels = `method="${escapeLabel(item.method)}",route="${escapeLabel(item.route)}"`;
      DURATION_BUCKETS.forEach((bucket, index) => {
        lines.push(
          `rdps_http_request_duration_seconds_bucket{${labels},le="${bucket}"} ${item.buckets[index]}`,
        );
      });
      lines.push(
        `rdps_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${item.count}`,
        `rdps_http_request_duration_seconds_sum{${labels}} ${item.sum}`,
        `rdps_http_request_duration_seconds_count{${labels}} ${item.count}`,
      );
    }

    lines.push(
      "# HELP rdps_process_uptime_seconds API process uptime in seconds.",
      "# TYPE rdps_process_uptime_seconds gauge",
      `rdps_process_uptime_seconds ${process.uptime()}`,
      "# HELP rdps_process_resident_memory_bytes API resident memory in bytes.",
      "# TYPE rdps_process_resident_memory_bytes gauge",
      `rdps_process_resident_memory_bytes ${process.memoryUsage().rss}`,
    );
    return `${lines.join("\n")}\n`;
  }
}

@Injectable()
export class ApiMetricsInterceptor implements NestInterceptor {
  constructor(
    @Inject(ApiMetricsRegistry)
    private readonly metrics: ApiMetricsRegistry,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RoutedRequest>();
    const response = http.getResponse<RoutedResponse>();
    const method = request.method ?? "OTHER";
    const routePath = request.route?.path;
    const route = Array.isArray(routePath) ? routePath[0] : routePath;
    const routeTemplate = route ? `/api/v1${route}` : "unmatched";
    const startedAt = process.hrtime.bigint();
    let recorded = false;
    const record = (statusCode: number) => {
      if (recorded) return;
      recorded = true;
      const durationSeconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      this.metrics.observe(method, routeTemplate, statusCode, durationSeconds);
    };

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode ?? 200),
        error: (error: unknown) => {
          const statusCode =
            typeof error === "object" &&
            error !== null &&
            "getStatus" in error &&
            typeof error.getStatus === "function"
              ? Number(error.getStatus())
              : 500;
          record(statusCode);
        },
      }),
    );
  }
}

@Controller("metrics")
class ApiMetricsController {
  constructor(
    @Inject(ApiMetricsRegistry)
    private readonly metrics: ApiMetricsRegistry,
  ) {}

  @Get()
  @ApiExcludeEndpoint()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  getMetrics(): string {
    return this.metrics.render();
  }
}

@Module({
  controllers: [ApiMetricsController],
  providers: [
    ApiMetricsRegistry,
    { provide: APP_INTERCEPTOR, useClass: ApiMetricsInterceptor },
  ],
  exports: [ApiMetricsRegistry],
})
export class ApiMetricsModule {}
