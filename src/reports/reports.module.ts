import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsController } from './reports.controller';
import { AttendanceLog } from '../attendance/attendance-log.entity';
import { User } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AttendanceLog, User])],
  controllers: [ReportsController],
})
export class ReportsModule {}
