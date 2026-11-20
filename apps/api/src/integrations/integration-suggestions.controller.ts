import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsUUID } from "class-validator";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IntegrationSuggestionsService } from "./integration-suggestions.service";

class AcceptSuggestionInput {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  releaseId!: string;
}

@ApiTags("internal integrations")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/projects/:projectId/integration-suggestions")
export class IntegrationSuggestionsController {
  constructor(private readonly suggestions: IntegrationSuggestionsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Query("limit") limit?: string,
  ) {
    const parsed = limit === undefined ? 100 : Number(limit);
    return this.suggestions.list(
      request.user,
      projectId,
      Number.isSafeInteger(parsed) ? parsed : Number.NaN,
    );
  }

  @Patch(":suggestionId/accept")
  @ApiBody({ type: AcceptSuggestionInput })
  accept(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("suggestionId", new ParseUUIDPipe()) suggestionId: string,
    @Body() body: AcceptSuggestionInput,
  ) {
    return this.suggestions.accept(
      request.user,
      projectId,
      suggestionId,
      body.releaseId,
    );
  }

  @Patch(":suggestionId/dismiss")
  dismiss(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("suggestionId", new ParseUUIDPipe()) suggestionId: string,
  ) {
    return this.suggestions.dismiss(request.user, projectId, suggestionId);
  }
}
