import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';
import { Device } from '../devices/device.entity';
import { KioskCode } from './kiosk-code.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Device, KioskCode])],
  controllers: [KioskController],
  providers: [KioskService],
  exports: [KioskService],
})
export class KioskModule {}
