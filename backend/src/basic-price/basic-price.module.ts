import { Module } from '@nestjs/common';
import { BasicPriceService } from './basic-price.service';
import { BasicPriceController } from './basic-price.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BasicPriceController],
  providers: [BasicPriceService],
  exports: [BasicPriceService],
})
export class BasicPriceModule {}
