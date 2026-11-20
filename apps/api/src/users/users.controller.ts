import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { UsersService } from "./users.service";

class UpdateUserInput {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) displayName?: string;
  @IsOptional() @IsIn(["ACTIVE", "SUSPENDED"]) status?: "ACTIVE" | "SUSPENDED";
  @IsOptional() @IsBoolean() isSystemAdmin?: boolean;
}

@ApiTags("internal users")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "status", required: false })
  list(
    @Req() request: AuthenticatedRequest,
    @Query("q") q?: string,
    @Query("status") status?: string,
  ) {
    return this.users.list(request.user, {
      ...(typeof q === "string" ? { q } : {}),
      ...(typeof status === "string" ? { status } : {}),
    });
  }

  @Patch(":userId")
  update(
    @Req() request: AuthenticatedRequest,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() body: UpdateUserInput,
  ) {
    return this.users.update(request.user, userId, body);
  }

  @Post(":userId/password-link")
  issuePasswordLink(
    @Req() request: AuthenticatedRequest,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    return this.users.issuePasswordLink(request.user, userId);
  }
}
