import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { firstValueFrom, from, map, Observable } from "rxjs";
import {
  PublicCacheScope,
  PublicResponseCache,
} from "./public-response-cache.service";

type PublicRequest = {
  method: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
};

type PublicResponse = {
  setHeader(name: string, value: string): void;
};

const SHARED_CACHE_CONTROL = "public, max-age=0, s-maxage=5, must-revalidate";

@Injectable()
export class PublicResponseCacheInterceptor implements NestInterceptor {
  constructor(private readonly cache: PublicResponseCache) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<PublicRequest>();
    const response = http.getResponse<PublicResponse>();
    const scope = this.scopeFor(request);
    const keyMaterial = this.keyMaterial(request);

    if (!scope || !keyMaterial || this.hasCredentials(request)) {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-RDPS-Cache", "BYPASS");
      return next.handle();
    }

    return from(
      this.cache.getOrLoad(scope, keyMaterial, () =>
        firstValueFrom(next.handle()),
      ),
    ).pipe(
      map(({ value, state }) => {
        response.setHeader(
          "Cache-Control",
          state === "BYPASS" ? "no-store" : SHARED_CACHE_CONTROL,
        );
        response.setHeader("X-RDPS-Cache", state);
        return value;
      }),
    );
  }

  private scopeFor(request: PublicRequest): PublicCacheScope | undefined {
    if (request.method.toUpperCase() !== "GET") return undefined;
    const path = (request.originalUrl ?? request.url ?? "").split("?", 1)[0]!;
    if (!path.startsWith("/api/v1/public/") || path.includes("/attachments/"))
      return undefined;
    const projectMatch = /^\/api\/v1\/public\/projects\/([^/]+)(?:\/|$)/.exec(
      path,
    );
    if (!projectMatch)
      return path === "/api/v1/public/projects"
        ? { kind: "directory" }
        : undefined;
    try {
      return { kind: "project", slug: decodeURIComponent(projectMatch[1]!) };
    } catch {
      return undefined;
    }
  }

  private keyMaterial(request: PublicRequest): string | undefined {
    const url = request.originalUrl ?? request.url;
    const host = request.headers.host;
    if (!url || typeof host !== "string" || !host.trim()) return undefined;
    return `${host.trim().toLowerCase()}\n${url}`;
  }

  private hasCredentials(request: PublicRequest): boolean {
    return Boolean(request.headers.authorization || request.headers.cookie);
  }
}
