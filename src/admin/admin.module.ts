// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { RolesGuard } from '../auth/roles.guard';
import { User } from '../users/user.entity';
import { Device } from '../devices/device.entity';
import { AttendanceLog } from '../attendance/attendance-log.entity';
import { AdminAttendanceController } from './admin-attendance.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, Device, AttendanceLog])],
  controllers: [AdminController, AdminAttendanceController],
  providers: [RolesGuard],
})
export class AdminModule {}
