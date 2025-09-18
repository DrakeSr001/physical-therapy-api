import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString() @MinLength(2)
  fullName: string;

  @IsEmail()
  email: string;

  @IsString() @MinLength(6)
  password: string;

  @IsIn(['doctor', 'admin'])
  role: 'doctor' | 'admin' = 'doctor';
}
