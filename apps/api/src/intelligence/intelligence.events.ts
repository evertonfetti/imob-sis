export const PropertyEvents = { Published: 'property.published' } as const;
export interface PropertyPublishedEvent { companyId: string; propertyId: string; userId: string | null }
