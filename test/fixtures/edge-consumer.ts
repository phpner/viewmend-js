import { ViewMend } from '../../dist/index.js';

export async function runEdgeSmoke(): Promise<string> {
  const sdk = new ViewMend({
    apiToken: 'edge-test-value',
    retry: false,
    fetch: async () =>
      new Response(
        JSON.stringify({
          delivery_id: 'edge-delivery',
          ok: true,
          event_id: 'edge-event',
          duplicate: false,
          affected_pages: 1,
          ignored_urls: 0,
          checks_queued: 0,
          queue_status: 'recorded',
          scheduled_for: null,
        }),
        {
          status: 202,
          headers: { 'X-ViewMend-Delivery': 'edge-delivery' },
        },
      ),
  });

  const result = await sdk
    .siteTracker('edge-integration')
    .events.custom({ id: 'edge-stable-id', title: 'Edge bundle smoke' });
  return result.deliveryId;
}
