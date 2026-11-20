import "reflect-metadata";
import { RequestMethod, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { applyEnvironment } from "@rdps/config";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  applyEnvironment();
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.setGlobalPrefix("api/v1", {
    exclude: [{ path: "metrics", method: RequestMethod.GET }],
  });
  const allowedOrigins = (process.env.WEB_BASE_URL ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("RDPS API")
    .setDescription("Internal and public release documentation APIs")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
