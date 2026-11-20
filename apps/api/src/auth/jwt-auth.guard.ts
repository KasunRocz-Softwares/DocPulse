import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
export type AuthenticatedRequest = {
  headers: Record<string, string | string[] | undefined>;
  user: { id: string; sessionId: string; isSystemAdmin: boolean };
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers["authorization"];
    const token =
      typeof authorization === "string"
        ? authorization.match(/^Bearer\s+(.+)$/i)?.[1]
        : undefined;
    if (!token) throw new UnauthorizedException();
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; sid: string }>(
        token,
      );
      if (!claims.sub || !claims.sid) throw new UnauthorizedException();
      const session = await this.prisma.userSession.findFirst({
        where: {
          id: claims.sid,
          userId: claims.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (!session) throw new UnauthorizedException();
      const user = await this.prisma.user.findUnique({
        where: { id: claims.sub },
        select: { id: true, isSystemAdmin: true, status: true },
      });
      if (!user || user.status !== "ACTIVE") throw new UnauthorizedException();
      request.user = {
        id: user.id,
        sessionId: session.id,
        isSystemAdmin: user.isSystemAdmin,
      };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
