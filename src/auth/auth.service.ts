import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { hashDeviceIdentifier } from './device-id.util';
import { RefreshTokenService } from './refresh-token.service';
import { EventLogService } from '../event-log/event-log.service';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
    private refreshTokens: RefreshTokenService,
    private events: EventLogService,
    private cfg: ConfigService,
  ) {}

  private getStandardRefreshTtlSeconds() {
    const raw = this.cfg.get('JWT_REFRESH_TTL_SECONDS');
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return 60 * 60 * 24 * 30; // 30 days fallback
  }

  async login(email: string, password: string, deviceId: string, rememberMe: boolean) {
    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive) {
      await this.events.record({
        user: user ?? undefined,
        action: 'auth.login',
        status: 'error',
        message: 'invalid credentials',
        details: { email },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await this.events.record({
        user,
        action: 'auth.login',
        status: 'error',
        message: 'invalid credentials',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const normalizedDeviceId = deviceId?.trim();
    if (!normalizedDeviceId) {
      await this.events.record({
        user,
        action: 'auth.login',
        status: 'error',
        message: 'device_required',
      });
      throw new UnauthorizedException('device_required');
    }

    const incomingHash = hashDeviceIdentifier(normalizedDeviceId);
    if (user.deviceIdentifierHash !== incomingHash) {
      user.deviceIdentifierHash = incomingHash;
      user.deviceBoundAt = new Date();
      await this.users.save(user);
    }

    const payload = { sub: user.id, name: user.fullName, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);

    let refreshToken: string | null = null;
    let refreshExpiresAt: string | null = null;

    if (rememberMe) {
      const refresh = await this.refreshTokens.issue(user, incomingHash, {
        persistent: true,
      });
      refreshToken = refresh.token;
      refreshExpiresAt = refresh.expiresAt ? refresh.expiresAt.toISOString() : null;
    } else {
      await this.refreshTokens.revokeForDevice(user.id, incomingHash);
    }

    const result = {
      accessToken,
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt,
      rememberMe,
      user: { id: user.id, name: user.fullName, email: user.email, role: user.role },
    };
    await this.events.record({
      user,
      action: 'auth.login',
      status: 'success',
    });
    return result;
  }

  async refresh(refreshToken: string, deviceId: string) {
    const normalizedDeviceId = deviceId?.trim();
    if (!normalizedDeviceId) {
      throw new UnauthorizedException('device_required');
    }
    if (!refreshToken || refreshToken.trim().length < 10) {
      throw new UnauthorizedException('invalid_refresh_token');
    }

    const deviceHash = hashDeviceIdentifier(normalizedDeviceId);
    const rotation = await this.refreshTokens.rotate(
      refreshToken.trim(),
      deviceHash,
      { ttlSeconds: this.getStandardRefreshTtlSeconds() },
    );

    const user = rotation.user;
    if (!user.isActive) {
      throw new UnauthorizedException('user_inactive');
    }

    const payload = { sub: user.id, name: user.fullName, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);

    const result = {
      accessToken,
      refreshToken: rotation.token,
      refreshTokenExpiresAt: rotation.expiresAt ? rotation.expiresAt.toISOString() : null,
      rememberMe: rotation.persistent,
      user: { id: user.id, name: user.fullName, email: user.email, role: user.role },
    };
    await this.events.record({
      user,
      action: 'auth.refresh',
      status: 'success',
    });
    return result;
  }
}
