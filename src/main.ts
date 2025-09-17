import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // so Flutter web/mobile can call it during dev
  await app.listen(process.env.PORT || 3000);
}
bootstrap();