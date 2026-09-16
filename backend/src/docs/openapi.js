// OpenAPI 3.1 description of the public API. Served at GET /api/v1/openapi.json
// and rendered by the /developers page. Keep in step with routes/publicApi.js.
const { SCOPES } = require('../services/apiKeyService');
const { EVENTS } = require('../services/webhookService');

const base = (process.env.PUBLIC_API_BASE || process.env.BACKEND_URL || 'https://veori.net').replace(/\/+$/, '');

const err = { $ref: '#/components/responses/Error' };
const idParam = (name) => ({ name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } });
const pageParams = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
];
const list = (ref) => ({
  type: 'object',
  properties: {
    data: { type: 'array', items: { $ref: ref } },
    page: { type: 'integer' }, limit: { type: 'integer' },
    total: { type: ['integer', 'null'] }, has_more: { type: 'boolean' },
  },
});
const one = (ref) => ({ type: 'object', properties: { data: { $ref: ref } } });
const json = (schema) => ({ 'application/json': { schema } });
const scope = (s) => ({ 'x-required-scope': s, security: [{ apiKey: [] }] });

module.exports = {
  openapi: '3.1.0',
  info: {
    title: 'Veori API',
    version: '1.0.0',
    description: [
      'Read and write your Veori leads, deals, buyers and calls, and receive webhooks.',
      '',
      'Authenticate with an API key from Settings > Developers: `Authorization: Bearer vk_live_...`.',
      `Each key has scopes (${SCOPES.join(', ')}) and a per-key limit (default 120 requests/minute).`,
      'Phones are US numbers returned in E.164 (+1XXXXXXXXXX). Errors are `{ "error": { "code", "message" } }`.',
      '',
      'Webhooks are signed: `Veori-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.',
      'Verify v1 over the raw request body and reject timestamps older than 5 minutes. Failed deliveries are retried after 1m, 5m, 30m, 2h, 6h, 12h and 24h.',
    ].join('\n'),
  },
  servers: [{ url: `${base}/api/v1` }],
  components: {
    securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'vk_live_... API key' } },
    responses: {
      Error: { description: 'Error', content: json({ type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } }) },
    },
    schemas: {
      Lead: { type: 'object', properties: {
        id: { type: 'string', format: 'uuid' }, first_name: { type: ['string', 'null'] }, last_name: { type: ['string', 'null'] },
        phone: { type: 'string', example: '+17045550100' }, email: { type: ['string', 'null'] },
        property_address: { type: ['string', 'null'] }, property_city: { type: ['string', 'null'] },
        property_state: { type: ['string', 'null'] }, property_zip: { type: ['string', 'null'] },
        property_type: { type: ['string', 'null'] }, estimated_value: { type: ['number', 'null'] },
        estimated_equity: { type: ['number', 'null'] }, source: { type: ['string', 'null'] },
        status: { type: 'string' }, pipeline_stage: { type: ['string', 'null'] },
        motivation_score: { type: ['integer', 'null'] }, is_on_dnc: { type: 'boolean' },
        consent: { type: ['boolean', 'null'] }, consent_source: { type: ['string', 'null'] }, consent_at: { type: ['string', 'null'], format: 'date-time' },
        primary_tag: { type: ['string', 'null'] }, last_call_date: { type: ['string', 'null'], format: 'date-time' },
        last_call_outcome: { type: ['string', 'null'] }, notes: { type: ['string', 'null'] },
        tags: { type: ['array', 'null'], items: { type: 'string' } },
        created_at: { type: 'string', format: 'date-time' }, updated_at: { type: ['string', 'null'], format: 'date-time' },
      } },
      LeadInput: { type: 'object', required: ['phone'], properties: {
        phone: { type: 'string' }, first_name: { type: 'string' }, last_name: { type: 'string' }, email: { type: 'string' },
        property_address: { type: 'string' }, property_city: { type: 'string' }, property_state: { type: 'string', minLength: 2, maxLength: 2 },
        property_zip: { type: 'string' }, property_type: { type: 'string' }, estimated_value: { type: 'number' },
        estimated_equity: { type: 'number' }, source: { type: 'string' }, notes: { type: 'string' },
        sms_consent: { type: 'boolean', description: 'true only if you hold this person\'s prior express written consent to receive texts' },
      } },
      Deal: { type: 'object', properties: {
        id: { type: 'string', format: 'uuid' }, lead_id: { type: ['string', 'null'], format: 'uuid' },
        status: { type: 'string', enum: ['lead', 'contacted', 'offer_sent', 'negotiating', 'under_contract', 'sent_to_title', 'closing_prep', 'closed', 'lost'] },
        stage_changed_at: { type: ['string', 'null'], format: 'date-time' }, property_address: { type: ['string', 'null'] },
        property_city: { type: ['string', 'null'] }, property_state: { type: ['string', 'null'] }, property_zip: { type: ['string', 'null'] },
        arv: { type: ['number', 'null'] }, repair_estimate: { type: ['number', 'null'] }, mao: { type: ['number', 'null'] },
        offer_price: { type: ['number', 'null'] }, seller_agreed_price: { type: ['number', 'null'] }, buyer_price: { type: ['number', 'null'] },
        assignment_fee: { type: ['number', 'null'] }, buyer_id: { type: ['string', 'null'], format: 'uuid' },
        contract_status: { type: ['string', 'null'] }, closing_date: { type: ['string', 'null'] },
        emd_status: { type: ['string', 'null'] }, emd_amount: { type: ['number', 'null'] }, deal_type: { type: ['string', 'null'] },
        created_at: { type: 'string', format: 'date-time' }, updated_at: { type: ['string', 'null'], format: 'date-time' },
      } },
      Buyer: { type: 'object', properties: {
        id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, phone: { type: ['string', 'null'] }, email: { type: ['string', 'null'] },
        buyer_type: { type: ['string', 'null'] }, buy_box_states: { type: 'array', items: { type: 'string' } },
        buy_box_types: { type: 'array', items: { type: 'string' } }, property_cities: { type: 'array', items: { type: 'string' } },
        buy_box_zips: { type: 'array', items: { type: 'string' } }, min_price: { type: ['number', 'null'] }, max_price: { type: ['number', 'null'] },
        repair_tolerance: { type: ['string', 'null'] }, cash_only: { type: ['boolean', 'null'] }, proof_of_funds: { type: ['boolean', 'null'] },
        is_active: { type: 'boolean' }, notes: { type: ['string', 'null'] }, created_at: { type: 'string', format: 'date-time' },
      } },
      Call: { type: 'object', properties: {
        id: { type: 'string', format: 'uuid' }, lead_id: { type: ['string', 'null'], format: 'uuid' },
        direction: { type: ['string', 'null'] }, status: { type: ['string', 'null'] }, duration_seconds: { type: ['integer', 'null'] },
        outcome: { type: ['string', 'null'] }, motivation_score: { type: ['integer', 'null'] }, ai_summary: { type: ['string', 'null'] },
        key_signals: {}, objections: {}, offer_made: { type: ['number', 'null'] },
        transcript: { type: ['string', 'null'], description: 'Only on GET /calls/{id}' },
        recording_url: { type: ['string', 'null'], description: 'Only on GET /calls/{id}' },
        started_at: { type: ['string', 'null'], format: 'date-time' }, ended_at: { type: ['string', 'null'], format: 'date-time' },
        created_at: { type: 'string', format: 'date-time' },
      } },
      WebhookEndpoint: { type: 'object', properties: {
        id: { type: 'string', format: 'uuid' }, url: { type: 'string' }, description: { type: ['string', 'null'] },
        events: { type: 'array', items: { type: 'string', enum: ['*', ...Object.keys(EVENTS)] } },
        is_active: { type: 'boolean' }, consecutive_failures: { type: 'integer' }, disabled_reason: { type: ['string', 'null'] },
        last_success_at: { type: ['string', 'null'] }, last_failure_at: { type: ['string', 'null'] }, created_at: { type: 'string' },
      } },
      WebhookEvent: { type: 'object', properties: {
        id: { type: 'string', format: 'uuid' }, type: { type: 'string', enum: Object.keys(EVENTS) },
        created_at: { type: 'string', format: 'date-time' }, data: { type: 'object' },
      } },
    },
  },
  'x-webhook-events': EVENTS,
  paths: {
    '/leads': {
      get: { summary: 'List leads', ...scope('leads:read'),
        parameters: [...pageParams,
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'phone', in: 'query', schema: { type: 'string' } },
          { name: 'updated_since', in: 'query', schema: { type: 'string', format: 'date-time' } }],
        responses: { 200: { description: 'Leads', content: json(list('#/components/schemas/Lead')) }, 400: err, 401: err, 403: err, 429: err } },
      post: { summary: 'Create a lead', ...scope('leads:write'),
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/LeadInput' }) },
        responses: { 201: { description: 'Created', content: json(one('#/components/schemas/Lead')) }, 400: err, 409: { description: 'A lead with this phone exists (error.lead_id)' } } },
    },
    '/leads/{id}': {
      get: { summary: 'Get a lead', ...scope('leads:read'), parameters: [idParam('id')], responses: { 200: { description: 'Lead', content: json(one('#/components/schemas/Lead')) }, 404: err } },
      patch: { summary: 'Update a lead', ...scope('leads:write'), parameters: [idParam('id')],
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/LeadInput' }) },
        responses: { 200: { description: 'Updated', content: json(one('#/components/schemas/Lead')) }, 400: err, 404: err, 409: err } },
    },
    '/deals': { get: { summary: 'List deals', ...scope('deals:read'),
      parameters: [...pageParams, { name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'updated_since', in: 'query', schema: { type: 'string', format: 'date-time' } }],
      responses: { 200: { description: 'Deals', content: json(list('#/components/schemas/Deal')) } } } },
    '/deals/{id}': { get: { summary: 'Get a deal', ...scope('deals:read'), parameters: [idParam('id')], responses: { 200: { description: 'Deal', content: json(one('#/components/schemas/Deal')) }, 404: err } } },
    '/deals/{id}/stage': { post: { summary: 'Move a deal to a stage (runs that stage\'s automation)', ...scope('deals:write'), parameters: [idParam('id')],
      requestBody: { required: true, content: json({ type: 'object', required: ['stage'], properties: { stage: { $ref: '#/components/schemas/Deal/properties/status' }, reason: { type: 'string' } } }) },
      responses: { 200: { description: 'Deal after the move; changed=false when already at that stage', content: json({ type: 'object', properties: { data: { $ref: '#/components/schemas/Deal' }, changed: { type: 'boolean' }, from: { type: ['string', 'null'] } } }) }, 400: err, 404: err } } },
    '/buyers': {
      get: { summary: 'List buyers', ...scope('buyers:read'), parameters: [...pageParams, { name: 'state', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Buyers', content: json(list('#/components/schemas/Buyer')) } } },
      post: { summary: 'Create or update a buyer (matched on phone)', ...scope('buyers:write'),
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/Buyer' }) },
        responses: { 201: { description: 'Saved', content: json(one('#/components/schemas/Buyer')) }, 400: err } },
    },
    '/calls': { get: { summary: 'List calls', ...scope('calls:read'), parameters: [...pageParams, { name: 'lead_id', in: 'query', schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Calls', content: json(list('#/components/schemas/Call')) } } } },
    '/calls/{id}': { get: { summary: 'Get a call with transcript', ...scope('calls:read'), parameters: [idParam('id')], responses: { 200: { description: 'Call', content: json(one('#/components/schemas/Call')) }, 404: err } } },
    '/events': { get: { summary: 'List webhook event types', security: [{ apiKey: [] }], responses: { 200: { description: 'Events' } } } },
    '/webhooks': {
      get: { summary: 'List webhook endpoints', ...scope('webhooks:manage'), responses: { 200: { description: 'Endpoints', content: json({ type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/WebhookEndpoint' } } } }) } } },
      post: { summary: 'Create a webhook endpoint (the signing secret is returned once)', ...scope('webhooks:manage'),
        requestBody: { required: true, content: json({ type: 'object', required: ['url', 'events'], properties: { url: { type: 'string', description: 'https only' }, events: { type: 'array', items: { type: 'string' } }, description: { type: 'string' } } }) },
        responses: { 201: { description: 'Created', content: json({ type: 'object', properties: { data: { $ref: '#/components/schemas/WebhookEndpoint' }, secret: { type: 'string' } } }) }, 400: err } },
    },
    '/webhooks/{id}': {
      patch: { summary: 'Update or re-enable an endpoint', ...scope('webhooks:manage'), parameters: [idParam('id')], responses: { 200: { description: 'Updated' }, 404: err } },
      delete: { summary: 'Delete an endpoint', ...scope('webhooks:manage'), parameters: [idParam('id')], responses: { 204: { description: 'Deleted' }, 404: err } },
    },
    '/webhooks/{id}/deliveries': { get: { summary: 'Recent deliveries', ...scope('webhooks:manage'), parameters: [idParam('id')], responses: { 200: { description: 'Deliveries' } } } },
    '/webhooks/{id}/test': { post: { summary: 'Send a test event now', ...scope('webhooks:manage'), parameters: [idParam('id')], responses: { 200: { description: 'Delivery result' } } } },
  },
};
