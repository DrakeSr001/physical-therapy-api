import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { RefreshDto } from './dto/refresh.dto';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  async login(@Body() body: LoginDto) {
    const dto = plainToInstance(LoginDto, body);
    await validateOrReject(dto);
    return this.auth.login(dto.email, dto.password, dto.deviceId, dto.rememberMe ?? false);
  }

  @Post('refresh')
  async refresh(@Body() body: RefreshDto) {
    const dto = plainToInstance(RefreshDto, body);
    await validateOrReject(dto);
    return this.auth.refresh(dto.refreshToken, dto.deviceId);
  }
}

