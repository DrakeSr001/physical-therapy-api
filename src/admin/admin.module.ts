// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { RolesGuard } from '../auth/roles.guard';
import { User } from '../users/user.entity';
import { Device } from '../devices/device.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Device])],
  controllers: [AdminController],
  providers: [RolesGuard],
})
export class AdminModule {}
