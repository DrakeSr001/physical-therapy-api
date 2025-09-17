import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceLog } from './attendance-log.entity';
import { User } from '../users/user.entity';
import { Device } from '../devices/device.entity';
import { KioskCode } from '../kiosk/kiosk-code.entity';
import { KioskModule } from '../kiosk/kiosk.module';

@Module({
  imports: [TypeOrmModule.forFeature([AttendanceLog, User, Device, KioskCode]), KioskModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
