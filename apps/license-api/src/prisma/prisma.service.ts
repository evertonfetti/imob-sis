import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DbClient } from '@imob/license-database';
import { ENV, Env } from '../config/env';

@Injectable()
export class PrismaService extends DbClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super(env.LICENSE_DATABASE_URL);
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
