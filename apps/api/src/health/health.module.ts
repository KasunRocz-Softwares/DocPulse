import {
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import IORedis from "ioredis";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";

const PROBE_TIMEOUT_MS = 2_500;

type ProbeState = "ok" | "error";

interface ReadinessResponse {
  status: "ok";
  service: "rdps-api";
  checks: { database: ProbeState; redis: ProbeState };
  timestamp: string;
}

@Injectable()
export class HealthRedisConnection implements OnModuleDestroy {
  private readonly connection: IORedis;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is required for API readiness checks");
    this.connection = new IORedis(url, {
      connectTimeout: PROBE_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  ping(): Promise<string> {
    return this.connection.ping();
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.quit();
  }
}

@Injectable()
class ApiReadinessService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(HealthRedisConnection)
    private readonly redis: HealthRedisConnection,
  ) {}

  async check(): Promise<ReadinessResponse> {
    const [database, redis] = await Promise.all([
      this.probe(() => this.prisma.$queryRaw`SELECT 1`),
      this.probe(() => this.redis.ping()),
    ]);
    const checks = { database, redis };
    const timestamp = new Date().toISOString();

    if (database === "error" || redis === "error")
      throw new ServiceUnavailableException({
        status: "error",
        service: "rdps-api",
        checks,
        timestamp,
      });

    return { status: "ok", service: "rdps-api", checks, timestamp };
  }

  private async probe(operation: () => Promise<unknown>): Promise<ProbeState> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("readiness probe timed out")),
            PROBE_TIMEOUT_MS,
          );
        }),
      ]);
      return "ok";
    } catch {
      return "error";
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

@ApiTags("health")
@Controller("health")
class HealthController {
  constructor(
    @Inject(ApiReadinessService)
    private readonly readiness: ApiReadinessService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Check API process health" })
  getHealth(): { status: string; service: string; timestamp: string } {
    return {
      status: "ok",
      service: "rdps-api",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  @ApiOperation({ summary: "Check API database and Redis readiness" })
  getReadiness(): Promise<ReadinessResponse> {
    return this.readiness.check();
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [HealthRedisConnection, ApiReadinessService],
})
export class HealthModule {}
