import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { hashDeviceIdentifier } from './device-id.util';

@Injectable()
export class AuthService {
  constructor(private users: UsersService, private jwt: JwtService) {}

  async login(email: string, password: string, deviceId: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const normalizedDeviceId = deviceId?.trim();
    if (!normalizedDeviceId) throw new UnauthorizedException('device_required');

    const incomingHash = hashDeviceIdentifier(normalizedDeviceId);
    if (!user.deviceIdentifierHash) {
      user.deviceIdentifierHash = incomingHash;
      user.deviceBoundAt = new Date();
      await this.users.save(user);
    } else if (user.deviceIdentifierHash !== incomingHash) {
      throw new UnauthorizedException('device_not_registered');
    }

    const payload = { sub: user.id, name: user.fullName, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      user: { id: user.id, name: user.fullName, email: user.email, role: user.role },
    };
  }
}
