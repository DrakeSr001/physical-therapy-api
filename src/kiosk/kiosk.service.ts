import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from '../devices/device.entity';
import { KioskCode } from './kiosk-code.entity';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

@Injectable()
export class KioskService {
  constructor(
    @InjectRepository(Device) private devices: Repository<Device>,
    @InjectRepository(KioskCode) private codes: Repository<KioskCode>,
    private cfg: ConfigService,
  ) {}

  async issueCode(deviceApiKey: string) {
    const device = await this.devices.findOne({ where: { apiKey: deviceApiKey, isActive: true } });
    if (!device) throw new UnauthorizedException('Invalid device key');

    const ttl = Number(this.cfg.get('KIOSK_CODE_TTL_SECONDS') ?? 30);
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const code = randomUUID(); // opaque short-lived token
    const kc = this.codes.create({ code, device, expiresAt, isUsed: false });
    await this.codes.save(kc);

    return { code, expiresAt: kc.expiresAt };
  }

  async validateAndConsume(code: string) {
    const kc = await this.codes.findOne({
      where: { code },
      relations: { device: true },
    });
    if (!kc || kc.isUsed) return { ok: false as const, reason: 'invalid' };
    if (kc.expiresAt.getTime() < Date.now()) return { ok: false as const, reason: 'expired' };

    kc.isUsed = true; // one-time use
    await this.codes.save(kc);
    return { ok: true as const, device: kc.device };
  }
}
