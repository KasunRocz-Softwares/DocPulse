import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IntegrationOperationsService } from "./integration-operations.service";

@ApiTags("internal integration operations")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/projects/:projectId/integration-operations")
export class IntegrationOperationsController {
  constructor(private readonly operations: IntegrationOperationsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
  ) {
    return this.operations.list(request.user, projectId);
  }

  @Post("events/:eventId/retry")
  retry(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("eventId", new ParseUUIDPipe()) eventId: string,
  ) {
    return this.operations.retry(request.user, projectId, eventId);
  }
}
