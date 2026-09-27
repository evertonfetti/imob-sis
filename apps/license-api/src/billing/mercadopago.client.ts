import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { verifyMpSignature } from './signature';

export interface MpPreference { id: string; checkoutUrl: string }
export interface MpPayment { id: string; status: string; externalReference: string | null; amountCents: number }

/**
 * Cliente HTTP direto (fetch), sem SDK — mesmo padrão do resto do projeto (meta.client, providers de IA).
 * Endpoints e formatos confirmados na documentação oficial via ctx7 (Checkout Pro / notificações webhook).
 */
@Injectable()
export class MercadoPagoClient {
  private readonly log = new Logger(MercadoPagoClient.name);
  constructor(@Inject(ENV) private readonly env: Env) {}

  get configured() {
    return !!this.env.MP_ACCESS_TOKEN;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.env.MP_API_URL}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.env.MP_ACCESS_TOKEN}`, 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.log.warn(`Mercado Pago recusou ${path}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
      throw new Error(`Mercado Pago: HTTP ${res.status}`);
    }
    return body as T;
  }

  /** Checkout Pro: uma preferência aceita Pix, boleto e cartão no mesmo link (init_point). */
  async createPreference(p: { title: string; amountCents: number; externalReference: string; notificationUrl: string; successUrl: string }): Promise<MpPreference> {
    const body = await this.call<{ id: string; init_point: string }>('/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ id: p.externalReference, title: p.title, quantity: 1, currency_id: 'BRL', unit_price: Math.round(p.amountCents) / 100 }],
        external_reference: p.externalReference,
        notification_url: p.notificationUrl,
        back_urls: { success: p.successUrl, pending: p.successUrl, failure: p.successUrl },
        auto_return: 'approved',
      }),
    });
    return { id: body.id, checkoutUrl: body.init_point };
  }

  async getPayment(id: string): Promise<MpPayment> {
    const body = await this.call<{ id: number; status: string; external_reference: string | null; transaction_amount: number }>(`/v1/payments/${encodeURIComponent(id)}`);
    return { id: String(body.id), status: body.status, externalReference: body.external_reference, amountCents: Math.round(body.transaction_amount * 100) };
  }

  verifySignature(headers: { xSignature?: string; xRequestId?: string }, dataId: string): boolean {
    if (!this.env.MP_WEBHOOK_SECRET) {
      this.log.warn('MP_WEBHOOK_SECRET não definido: recusando webhook (configure o segredo na integração da sua conta Mercado Pago).');
      return false;
    }
    return verifyMpSignature({ xSignature: headers.xSignature, xRequestId: headers.xRequestId, dataId, secret: this.env.MP_WEBHOOK_SECRET });
  }
}
