import { IsString, MinLength, MaxLength } from 'class-validator';

export class RefreshDto {
  @IsString()
  @MinLength(10)
  refreshToken!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(128)
  deviceId!: string;
}
