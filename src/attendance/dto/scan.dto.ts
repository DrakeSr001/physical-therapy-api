import { IsString, Length } from 'class-validator';
export class ScanDto {
  @IsString()
  @Length(10, 100)
  code: string;
}
