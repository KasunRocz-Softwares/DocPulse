import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectsController } from "./projects.controller";
import { CustomDomainsController } from "./custom-domains.controller";
import {
  CustomDomainsService,
  DOMAIN_TXT_RESOLVER,
} from "./custom-domains.service";
import { resolveTxt } from "node:dns/promises";
import { ProjectsService } from "./projects.service";

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController, CustomDomainsController],
  providers: [
    ProjectsService,
    CustomDomainsService,
    { provide: DOMAIN_TXT_RESOLVER, useValue: resolveTxt },
  ],
})
export class ProjectsModule {}
