import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './health/health.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import { User } from './users/user.entity';
import { Device } from './devices/device.entity';
import { AttendanceLog } from './attendance/attendance-log.entity';
import { KioskCode } from './kiosk/kiosk-code.entity';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { KioskModule } from './kiosk/kiosk.module';
import { AttendanceModule } from './attendance/attendance.module';
import { ReportsModule } from './reports/reports.module';
import { AdminModule } from './admin/admin.module';
import { RolesGuard } from './auth/roles.guard';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000, // 60 seconds
        limit: 60,   // default 60 req/min per IP
      },
    ]),
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
    ReportsModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule { }
