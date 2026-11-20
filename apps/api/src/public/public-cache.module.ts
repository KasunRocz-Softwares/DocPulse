import { Module } from "@nestjs/common";
import {
  PublicCacheRedisConnection,
  PublicResponseCache,
} from "./public-response-cache.service";

@Module({
  providers: [PublicCacheRedisConnection, PublicResponseCache],
  exports: [PublicResponseCache],
})
export class PublicCacheModule {}
