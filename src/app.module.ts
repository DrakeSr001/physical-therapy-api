import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './health/health.module';

import { User } from './users/user.entity';
import { Device } from './devices/device.entity';
import { AttendanceLog } from './attendance/attendance-log.entity';
import { KioskCode } from './kiosk/kiosk-code.entity';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { KioskModule } from './kiosk/kiosk.module';
import { AttendanceModule } from './attendance/attendance.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['config.env', '.env'] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.get<string>('NEON_DATABASE_URL'),
        entities: [User, Device, AttendanceLog, KioskCode],
        synchronize: true, // DEV ONLY
        ssl: { rejectUnauthorized: false },
      }),
    }),
    HealthModule,
    UsersModule,
    AuthModule,
    KioskModule,
    AttendanceModule,
  ],
})
export class AppModule {}
