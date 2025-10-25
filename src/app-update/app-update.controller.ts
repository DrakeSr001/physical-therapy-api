import {
  Controller,
  Get,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AndroidReleaseResponse {
  android: {
    latestVersion: string;
    minimumVersion: string;
    downloadUrl: string;
    notes?: string;
    checksumSha256?: string;
  };
}

@Controller('app/releases')
export class AppUpdateController {
  constructor(private readonly cfg: ConfigService) {}

  @Get('android')
  getAndroidRelease(): AndroidReleaseResponse {
    const latest = this.cfg.get<string>('ANDROID_LATEST_VERSION')?.trim();
    const minimum =
      this.cfg.get<string>('ANDROID_MIN_VERSION')?.trim() || latest;
    const downloadUrl = this.cfg.get<string>('ANDROID_APK_URL')?.trim();
    const notes = this.cfg.get<string>('ANDROID_RELEASE_NOTES')?.trim();
    const checksum = this.cfg.get<string>('ANDROID_APK_SHA256')?.trim();

    if (!latest || !minimum || !downloadUrl) {
      throw new NotFoundException('android_release_not_configured');
    }

    return {
      android: {
        latestVersion: latest,
        minimumVersion: minimum,
        downloadUrl,
        ...(notes ? { notes } : {}),
        ...(checksum ? { checksumSha256: checksum } : {}),
      },
    };
  }
}

