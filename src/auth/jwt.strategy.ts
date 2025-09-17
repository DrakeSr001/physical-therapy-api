import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(cfg: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: cfg.get<string>('JWT_SECRET'),
      ignoreExpiration: false,
    });
    console.log('JWT_SECRET present?', !!cfg.get<string>('JWT_SECRET'));
  }
  async validate(payload: any) {
    console.log('JWT payload:', payload); // should print sub/name/role
    return { userId: payload.sub, name: payload.name, role: payload.role };
  }
}
