import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { randomBytes } from 'crypto';

import { User } from '../users/user.entity';
import { Device } from '../devices/device.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateDeviceDto } from './dto/create-device.dto';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
  ) {}

  @Post('users')
  async createUser(@Body() body: CreateUserDto) {
    const dto = plainToInstance(CreateUserDto, body);
    await validateOrReject(dto);

    const exists = await this.users.findOne({ where: { email: dto.email } });
    if (exists) throw new BadRequestException('email_taken');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const u = this.users.create({
      fullName: dto.fullName,
      email: dto.email,
      passwordHash,
      role: dto.role,
      isActive: true,
    });
    await this.users.save(u);
    return { id: u.id, fullName: u.fullName, email: u.email, role: u.role };
  }

  

  @Post('devices')
  async createDevice(@Body() body: CreateDeviceDto) {
    const dto = plainToInstance(CreateDeviceDto, body);
    await validateOrReject(dto);

    const apiKey = 'dev_' + randomBytes(24).toString('base64url'); // 32+ chars
    const d = this.devices.create({
      name: dto.name,
      location: dto.location,
      apiKey,
      isActive: true,
    });
    await this.devices.save(d);
    return { id: d.id, name: d.name, location: d.location, apiKey: d.apiKey };
  }
}
