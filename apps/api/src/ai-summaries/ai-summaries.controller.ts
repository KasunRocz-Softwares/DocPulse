import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AiSummariesService } from "./ai-summaries.service";

@ApiTags("internal AI summaries")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/releases/:releaseId/ai-summary-suggestions")
export class AiSummariesController {
  constructor(private readonly summaries: AiSummariesService) {}

  @Post()
  suggest(
    @Req() request: AuthenticatedRequest,
    @Param("releaseId", new ParseUUIDPipe()) releaseId: string,
  ) {
    return this.summaries.suggest(request.user, releaseId);
  }
}
