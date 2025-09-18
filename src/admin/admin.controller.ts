import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { validateOrReject, IsEmail, IsIn, IsOptional, IsString, MinLength, IsBoolean } from 'class-validator';
import { randomBytes } from 'crypto';

import { User } from '../users/user.entity';
import { Device } from '../devices/device.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateDeviceDto } from './dto/create-device.dto';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';


class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsIn(['doctor','admin']) role?: 'doctor'|'admin';
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class ResetPasswordDto {
  @IsString() @MinLength(6) password!: string;
}

class UpdateDeviceDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}


@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
  ) {}

  // ---- Existing: create user/device, list users (role filter) ----
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

    const apiKey = 'dev_' + randomBytes(24).toString('base64url');
    const d = this.devices.create({
      name: dto.name,
      location: dto.location,
      apiKey,
      isActive: true,
    });
    await this.devices.save(d);
    return { id: d.id, name: d.name, location: d.location, apiKey: d.apiKey };
  }

  @Get('users')
  async listUsers(@Query('role') role?: 'doctor'|'admin') {
    const where = role ? { role } : {};
    const list = await this.users.find({ where, order: { fullName: 'ASC' } });
    return list.map(u => ({ id: u.id, name: u.fullName, email: u.email, role: u.role, isActive: u.isActive }));
  }

  @Get('whoami')
  whoami(@Req() req: any) { return req.user; }

  @Get('devices')
  async listDevices() {
    const list = await this.devices.find({ order: { name: 'ASC' } });
    return list.map(d => ({ id: d.id, name: d.name, location: d.location ?? '', apiKey: d.apiKey, isActive: d.isActive }));
  }

  // ---- Users: update, reset password, delete ----
  @Patch('users/:id')
  async updateUser(@Param('id') id: string, @Body() body: UpdateUserDto) {
    const dto = plainToInstance(UpdateUserDto, body);
    await validateOrReject(dto);
    const u = await this.users.findOne({ where: { id } });
    if (!u) throw new BadRequestException('user_not_found');
    if (dto.fullName !== undefined) u.fullName = dto.fullName;
    if (dto.role !== undefined) u.role = dto.role;
    if (dto.isActive !== undefined) u.isActive = dto.isActive;
    await this.users.save(u);
    return { ok: true };
  }

  @Patch('users/:id/password')
  async resetPassword(@Param('id') id: string, @Body() body: ResetPasswordDto) {
    const dto = plainToInstance(ResetPasswordDto, body);
    await validateOrReject(dto);
    const u = await this.users.findOne({ where: { id } });
    if (!u) throw new BadRequestException('user_not_found');
    u.passwordHash = await bcrypt.hash(dto.password, 10);
    await this.users.save(u);
    return { ok: true };
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    const u = await this.users.findOne({ where: { id } });
    if (!u) throw new BadRequestException('user_not_found');
    await this.users.remove(u);
    return { ok: true };
  }

  // ---- Devices: update, delete ----
  @Patch('devices/:id')
  async updateDevice(@Param('id') id: string, @Body() body: UpdateDeviceDto) {
    const dto = plainToInstance(UpdateDeviceDto, body);
    await validateOrReject(dto);
    const d = await this.devices.findOne({ where: { id } });
    if (!d) throw new BadRequestException('device_not_found');
    if (dto.name !== undefined) d.name = dto.name;
    if (dto.location !== undefined) d.location = dto.location;
    if (dto.isActive !== undefined) d.isActive = dto.isActive;
    await this.devices.save(d);
    return { ok: true };
  }

  @Delete('devices/:id')
  async deleteDevice(@Param('id') id: string) {
    const d = await this.devices.findOne({ where: { id } });
    if (!d) throw new BadRequestException('device_not_found');
    await this.devices.remove(d);
    return { ok: true };
  }
}
