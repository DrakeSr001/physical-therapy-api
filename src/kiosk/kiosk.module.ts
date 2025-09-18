import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';
import { KioskCode } from './kiosk-code.entity';
import { Device } from '../devices/device.entity';
import { KioskCleanup } from './kiosk.cleanup';

@Module({
  imports: [TypeOrmModule.forFeature([Device, KioskCode])],
  controllers: [KioskController],
  providers: [KioskService, KioskCleanup],
  exports: [KioskService],
})
export class KioskModule {}
