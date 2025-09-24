import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  async login(@Body() body: LoginDto) {
    // Manual validation to keep it minimal (no global pipes required)
    const dto = plainToInstance(LoginDto, body);
    await validateOrReject(dto);
    return this.auth.login(dto.email, dto.password, dto.deviceId);
  }
}
