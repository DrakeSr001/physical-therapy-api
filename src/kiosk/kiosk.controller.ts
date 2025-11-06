import { Controller, Get, Headers } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { KioskService } from './kiosk.service';

@Controller('kiosk')
export class KioskController {
  constructor(private readonly kiosk: KioskService) {}

  @Get('bootstrap')
  async bootstrap(@Headers('x-device-key') deviceKey: string) {
    return this.kiosk.bootstrap(deviceKey);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('qr')
  async getQr(@Headers('x-device-key') deviceKey: string) {
    return this.kiosk.issueCode(deviceKey);
  }
}

