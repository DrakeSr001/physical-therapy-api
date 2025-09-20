import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Dev: allow all
  // app.enableCors();

  // Prod: restrict to your web origin(s)
  app.enableCors({
    origin: [
      'https://physical-therapy-qr-code.netlify.app', // e.g. https://pt-center.netlify.app
    ],
    credentials: false,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-device-key'],
  });

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
