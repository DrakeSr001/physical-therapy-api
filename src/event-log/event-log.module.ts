import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventLog } from './event-log.entity';
import { EventLogService } from './event-log.service';

@Module({
  imports: [TypeOrmModule.forFeature([EventLog])],
  providers: [EventLogService],
  exports: [EventLogService],
})
export class EventLogModule {}
