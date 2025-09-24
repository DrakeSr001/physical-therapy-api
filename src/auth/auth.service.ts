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

    if (!deviceId?.trim()) throw new UnauthorizedException('device_required');
    if (!user.deviceIdentifierHash) throw new UnauthorizedException('device_not_registered');

    const deviceHash = hashDeviceIdentifier(deviceId);
    if (user.deviceIdentifierHash !== deviceHash) throw new UnauthorizedException('device_not_registered');

    const payload = { sub: user.id, name: user.fullName, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      user: { id: user.id, name: user.fullName, email: user.email, role: user.role },
    };
  }
}