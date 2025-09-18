import { Controller, Get, Headers } from '@nestjs/common';
import { KioskService } from './kiosk.service';
import { Throttle } from '@nestjs/throttler';


@Controller('kiosk')
export class KioskController {
  constructor(private kiosk: KioskService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // ✅ 20 reqs per 60 seconds
  @Get('qr')
  async getQr(@Headers('x-device-key') deviceKey: string) {
    // Device key identifies "Markaz Phone"
    return this.kiosk.issueCode(deviceKey);
  }
}
