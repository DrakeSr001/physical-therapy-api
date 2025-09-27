import { IsEmail, IsString, MinLength, MaxLength, IsBoolean, IsOptional } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(3)
  @MaxLength(128)
  deviceId: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
