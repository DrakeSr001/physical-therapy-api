import { Controller, Get, Headers } from '@nestjs/common';
import { KioskService } from './kiosk.service';

@Controller('kiosk')
export class KioskController {
  constructor(private kiosk: KioskService) {}

  @Get('qr')
  async getQr(@Headers('x-device-key') deviceKey: string) {
    // Device key identifies "Markaz Phone"
    return this.kiosk.issueCode(deviceKey);
  }
}
