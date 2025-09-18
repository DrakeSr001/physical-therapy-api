import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { User } from '../users/user.entity';
import { Device } from '../devices/device.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Device])],
  controllers: [AdminController],
})
export class AdminModule {}
