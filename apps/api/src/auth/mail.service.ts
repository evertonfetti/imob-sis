import { Injectable, Logger } from '@nestjs/common';

/** Stub: em V1 apenas registra o e-mail no log. Trocar por SMTP/Resend quando necessário. */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  async send(to: string, subject: string, body: string) {
    this.logger.log(`Para: ${to} | ${subject}\n${body}`);
  }
}
