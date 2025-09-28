import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health.controller';
import { DatabaseKeepAliveService } from './database-keepalive.service';

@Module({
  imports: [ScheduleModule],
  controllers: [HealthController],
  providers: [DatabaseKeepAliveService],
})
export class HealthModule {}