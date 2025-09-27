import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHash } from 'crypto';
import { RefreshToken } from './refresh-token.entity';
import { User } from '../users/user.entity';

type IssueOptions = {
  ttlSeconds?: number;
  persistent?: boolean;
};
type RotateOptions = {
  ttlSeconds?: number;
};

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken) private readonly tokens: Repository<RefreshToken>,
  ) {}

  private static hashToken(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }

  private static generateTokenString() {
    return randomBytes(48).toString('base64url');
  }

  async issue(user: User, deviceIdentifierHash: string, options: IssueOptions = {}) {
    const persistent = options.persistent ?? false;
    const ttlSeconds = options.ttlSeconds ?? 0;
    const expiresAt = persistent
      ? null
      : new Date(Date.now() + Math.max(1, ttlSeconds) * 1000);

    const token = RefreshTokenService.generateTokenString();
    const tokenHash = RefreshTokenService.hashToken(token);

    let record = await this.tokens.findOne({
      where: { user: { id: user.id }, deviceIdentifierHash },
      relations: { user: true },
    });

    if (!record) {
      record = this.tokens.create({
        user,
        deviceIdentifierHash,
        tokenHash,
        expiresAt,
        isPersistent: persistent,
        revokedAt: null,
      });
    } else {
      record.tokenHash = tokenHash;
      record.expiresAt = expiresAt;
      record.isPersistent = persistent;
      record.revokedAt = null;
    }

    await this.tokens.save(record);

    return { token, expiresAt, persistent };
  }

  async rotate(existingToken: string, deviceIdentifierHash: string, options: RotateOptions = {}) {
    if (!existingToken) {
      throw new UnauthorizedException('invalid_refresh_token');
    }
    const tokenHash = RefreshTokenService.hashToken(existingToken);
    const record = await this.tokens.findOne({
      where: { tokenHash },
      relations: { user: true },
    });

    if (!record || record.revokedAt || record.deviceIdentifierHash !== deviceIdentifierHash) {
      throw new UnauthorizedException('invalid_refresh_token');
    }

    const now = Date.now();
    if (!record.isPersistent) {
      if (!record.expiresAt || record.expiresAt.getTime() < now) {
        throw new UnauthorizedException('refresh_token_expired');
      }
      let ttlSeconds = options.ttlSeconds ?? 0;
      if (ttlSeconds <= 0) {
        ttlSeconds = Math.max(60, Math.round((record.expiresAt.getTime() - now) / 1000));
      }
      record.expiresAt = new Date(now + ttlSeconds * 1000);
    } else {
      record.expiresAt = null;
    }

    const newToken = RefreshTokenService.generateTokenString();
    record.tokenHash = RefreshTokenService.hashToken(newToken);
    record.revokedAt = null;

    await this.tokens.save(record);

    return {
      token: newToken,
      expiresAt: record.expiresAt ?? null,
      persistent: record.isPersistent,
      user: record.user,
    };
  }

  async revokeForDevice(userId: string, deviceIdentifierHash: string) {
    await this.tokens
      .createQueryBuilder()
      .delete()
      .where('"userId" = :userId', { userId })
      .andWhere('deviceIdentifierHash = :hash', { hash: deviceIdentifierHash })
      .execute();
  }
}

