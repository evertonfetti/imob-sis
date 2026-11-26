import { PlacePage, placeMetadata } from '@/components/PlaceListing';

type P = { params: Promise<{ cidade: string; bairro: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export const generateMetadata = ({ params, searchParams }: P) => placeMetadata('ALL', params, searchParams);
export default function Page({ params, searchParams }: P) { return <PlacePage kind="ALL" params={params} searchParams={searchParams} />; }
