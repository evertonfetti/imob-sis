import { PlacePage, placeMetadata } from '@/components/PlaceListing';

type P = { params: Promise<{ cidade: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export const generateMetadata = ({ params, searchParams }: P) => placeMetadata('SALE', params, searchParams);
export default function Page({ params, searchParams }: P) { return <PlacePage kind="SALE" params={params} searchParams={searchParams} />; }
