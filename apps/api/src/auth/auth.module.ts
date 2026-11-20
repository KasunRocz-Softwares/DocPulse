import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import {
  LocalPasswordIdentityProvider,
  PASSWORD_IDENTITY_PROVIDER,
} from "./identity-provider";
import { OidcService } from "./oidc.service";
import { OIDC_PROTOCOL, OpenIdClientProtocol } from "./oidc.protocol";

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>("JWT_ACCESS_SECRET");
        if (!secret || secret.length < 32)
          throw new Error(
            "JWT_ACCESS_SECRET must contain at least 32 characters",
          );
        return { secret, signOptions: { expiresIn: "15m" } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    OidcService,
    { provide: OIDC_PROTOCOL, useClass: OpenIdClientProtocol },
    {
      provide: PASSWORD_IDENTITY_PROVIDER,
      useClass: LocalPasswordIdentityProvider,
    },
  ],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
