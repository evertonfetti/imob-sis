import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { clientInputSchema, type ClientInput } from '@imob/types';
import { ZodPipe } from '../common/zod.pipe';
import { ClientsService } from './clients.service';

@Controller('clients')
export class ClientsController {
  constructor(private readonly svc: ClientsService) {}

  @Get() list() { return this.svc.list(); }

  @Get(':id') detail(@Param('id') id: string) { return this.svc.detail(id); }

  @Post()
  create(@Body(new ZodPipe(clientInputSchema)) body: ClientInput) { return this.svc.create(body); }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(clientInputSchema.partial())) body: Partial<ClientInput>) { return this.svc.update(id, body); }
}
