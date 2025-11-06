import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Device } from '../devices/device.entity';
import { KioskCode } from './kiosk-code.entity';

type OfflineCodeParts = { deviceId: string; otp: string };

@Injectable()
export class KioskService {
  private readonly codeIntervalSeconds: number;
  private readonly codeDigits: number;
  private readonly allowedDriftSteps: number;

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(KioskCode) private readonly codes: Repository<KioskCode>,
    private readonly cfg: ConfigService,
  ) {
    const interval = Number(this.cfg.get('KIOSK_CODE_INTERVAL_SECONDS') ?? 12);
    this.codeIntervalSeconds = Number.isFinite(interval) && interval >= 5 ? interval : 12;

    const digits = Number(this.cfg.get('KIOSK_CODE_DIGITS') ?? 8);
    this.codeDigits = Number.isFinite(digits) && digits >= 6 && digits <= 8 ? digits : 8;

    const drift = Number(this.cfg.get('KIOSK_CODE_DRIFT_STEPS') ?? 1);
    this.allowedDriftSteps = Number.isFinite(drift) && drift >= 0 && drift <= 3 ? drift : 1;
  }

  async issueCode(deviceApiKey: string) {
    const device = await this.devices.findOne({ where: { apiKey: deviceApiKey, isActive: true } });
    if (!device) throw new UnauthorizedException('Invalid device key');

    const secret = await this.ensureOfflineSecret(device);
    const nowMs = Date.now();
    const currentOtp = this.generateOtp(secret, this.counterForTimestamp(nowMs));
    const code = this.composeOfflineCode(device.id, currentOtp);
    const expiresAt = new Date(this.nextStepTimestamp(nowMs));

    return {
      mode: 'offline',
      code,
      expiresAt,
      intervalSeconds: this.codeIntervalSeconds,
      digits: this.codeDigits,
      serverTime: new Date(nowMs).toISOString(),
      deviceId: device.id,
    };
  }

  async bootstrap(deviceApiKey: string) {
    const device = await this.devices.findOne({ where: { apiKey: deviceApiKey, isActive: true } });
    if (!device) throw new UnauthorizedException('Invalid device key');

    const secret = await this.ensureOfflineSecret(device);
    return {
      deviceId: device.id,
      secret,
      intervalSeconds: this.codeIntervalSeconds,
      digits: this.codeDigits,
      algorithm: 'HMAC-SHA1',
      driftAllowance: this.allowedDriftSteps,
      serverTime: new Date().toISOString(),
      mode: 'offline',
    };
  }

  async validateAndConsume(code: string) {
    if (this.isOfflineCode(code)) {
      return this.validateOfflineCode(code);
    }
    return this.validateLegacyCode(code);
  }

  private async validateOfflineCode(code: string) {
    const parsed = this.parseOfflineCode(code);
    if (!parsed) return { ok: false as const, reason: 'invalid' };

    const device = await this.devices.findOne({
      where: { id: parsed.deviceId, isActive: true },
    });
    if (!device || !device.offlineSecret) {
      return { ok: false as const, reason: 'invalid' };
    }

    const nowMs = Date.now();
    const isValid = this.verifyOtp(device.offlineSecret, parsed.otp, nowMs);
    if (!isValid) {
      return { ok: false as const, reason: 'invalid' };
    }

    return { ok: true as const, device };
  }

  private async validateLegacyCode(code: string) {
    const kc = await this.codes.findOne({
      where: { code },
      relations: { device: true },
    });
    if (!kc || kc.isUsed) return { ok: false as const, reason: 'invalid' };
    if (kc.expiresAt.getTime() < Date.now()) return { ok: false as const, reason: 'expired' };

    kc.isUsed = true;
    kc.usedAt = new Date();
    await this.codes.save(kc);
    return { ok: true as const, device: kc.device };
  }

  private async ensureOfflineSecret(device: Device) {
    if (device.offlineSecret && device.offlineSecret.length >= 16) {
      return device.offlineSecret;
    }
    const secret = randomBytes(32).toString('base64url');
    device.offlineSecret = secret;
    await this.devices.save(device);
    return secret;
  }

  private isOfflineCode(code: string) {
    return typeof code === 'string' && code.startsWith('O1.');
  }

  private composeOfflineCode(deviceId: string, otp: string) {
    return `O1.${deviceId}.${otp}`;
  }

  private parseOfflineCode(code: string): OfflineCodeParts | null {
    const parts = code.split('.');
    if (parts.length !== 3 || parts[0] !== 'O1') return null;
    const deviceId = parts[1]?.trim();
    const otp = parts[2]?.trim();
    if (!deviceId || !otp || otp.length < this.codeDigits) return null;
    return { deviceId, otp };
  }

  private counterForTimestamp(timestampMs: number) {
    const step = Math.floor(timestampMs / 1000 / this.codeIntervalSeconds);
    return BigInt(step);
  }

  private nextStepTimestamp(timestampMs: number) {
    const currentStep = Math.floor(timestampMs / 1000 / this.codeIntervalSeconds);
    const nextStep = (currentStep + 1) * this.codeIntervalSeconds * 1000;
    return nextStep;
  }

  private generateOtp(secret: string, counter: bigint) {
    const key = this.decodeSecret(secret);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(counter);

    const digest = createHmac('sha1', key).update(counterBuffer).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);

    const modulus = 10 ** this.codeDigits;
    const otp = (binary % modulus).toString();
    return otp.padStart(this.codeDigits, '0');
  }

  private verifyOtp(secret: string, candidate: string, timestampMs: number) {
    if (!/^\d+$/.test(candidate)) {
      return false;
    }

    const centerCounter = this.counterForTimestamp(timestampMs);
    for (let drift = -this.allowedDriftSteps; drift <= this.allowedDriftSteps; drift++) {
      const counter = centerCounter + BigInt(drift);
      if (counter < BigInt(0)) continue;
      const expected = this.generateOtp(secret, counter);
      if (expected === candidate) {
        return true;
      }
    }
    return false;
  }

  private decodeSecret(secret: string) {
    let normalized = secret.replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4 !== 0) {
      normalized += '=';
    }
    return Buffer.from(normalized, 'base64');
  }
}
