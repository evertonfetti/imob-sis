import { Body, Controller, Get, Patch } from '@nestjs/common';
import { billingSettingsInputSchema, type BillingSettingsInput } from '@imob/types';
import { CurrentStaff } from '../common/request-context';
import type { AuthedStaff } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { BillingService } from './billing.service';

@Controller('billing/settings')
export class BillingSettingsController {
  constructor(private readonly billing: BillingService) {}

  @Get() get() { return this.billing.getSettings(); }

  @Patch()
  update(@Body(new ZodPipe(billingSettingsInputSchema)) body: BillingSettingsInput, @CurrentStaff() staff: AuthedStaff) {
    return this.billing.updateSettings(body, staff);
  }
}
