const SANDBOX_API = 'https://api-m.sandbox.paypal.com';

function identifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,127}$/.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function money(value, currency) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(value) || value === '0.00') {
    throw new TypeError('Amount must be a positive decimal string with two decimal places');
  }
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError('Currency must be a three-letter uppercase code');
  }
  return { value, currency_code: currency };
}

function publicAmount(amount) {
  if (!amount || typeof amount !== 'object') return undefined;
  return { value: amount.value, currency_code: amount.currency_code };
}

function publicCapture(capture) {
  if (!capture || typeof capture !== 'object') return undefined;
  return {
    id: capture.id,
    status: capture.status,
    amount: publicAmount(capture.amount),
    final_capture: capture.final_capture,
  };
}

function sandboxApprovalLink(links) {
  for (const link of Array.isArray(links) ? links : []) {
    if (link.rel !== 'payer-action' && link.rel !== 'approve') continue;
    try {
      const url = new URL(link.href);
      if (url.protocol === 'https:' && url.hostname === 'www.sandbox.paypal.com') return url.href;
    } catch {
      continue;
    }
  }
  return undefined;
}

function publicBody(body) {
  if (!body || typeof body !== 'object') return {};
  const captures = Array.isArray(body.purchase_units)
    ? body.purchase_units.flatMap((unit) => (Array.isArray(unit?.payments?.captures) ? unit.payments.captures : [])).map(publicCapture)
    : undefined;
  const details = Array.isArray(body.details)
    ? body.details.map((detail) => ({ issue: detail.issue, description: detail.description }))
    : undefined;
  return {
    id: body.id,
    status: body.status,
    amount: publicAmount(body.amount),
    final_capture: body.final_capture,
    name: body.name,
    message: body.message,
    details,
    captures,
    approvalUrl: sandboxApprovalLink(body.links),
  };
}

export function createPayPalSandbox({ clientId, clientSecret } = {}) {
  if (typeof clientId !== 'string' || !clientId || typeof clientSecret !== 'string' || !clientSecret) {
    throw new Error('PayPal sandbox client ID and secret are required');
  }

  let token;
  let expiresAt = 0;

  async function accessToken() {
    if (token && Date.now() < expiresAt) return token;
    const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch(`${SANDBOX_API}/v1/oauth2/token`, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.access_token !== 'string') {
      throw new Error(`PayPal sandbox authentication failed (HTTP ${response.status})`);
    }
    token = result.access_token;
    expiresAt = Date.now() + Math.max(0, (Number(result.expires_in) || 0) - 60) * 1000;
    return token;
  }

  async function request(method, path, body, requestId) {
    const headers = { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json', Prefer: 'return=representation' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (requestId !== undefined) headers['PayPal-Request-Id'] = identifier(requestId, 'Request ID');
    const response = await fetch(`${SANDBOX_API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body: publicBody(data), debugId: data.debug_id };
  }

  async function readAccount(path, sanitize) {
    const response = await fetch(`${SANDBOX_API}${path}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body: response.ok ? sanitize(data) : {} };
  }

  return {
    async authenticate() { await accessToken(); return true; },
    listAccountTransactions({ startDate, endDate, page = 1 } = {}) {
      const start = Date.parse(startDate), end = Date.parse(endDate);
      if (typeof startDate !== 'string' || typeof endDate !== 'string' || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 31 * 86400000) throw new TypeError('Transaction range must be valid and no longer than 31 days');
      if (!Number.isSafeInteger(page) || page < 1 || page > 100) throw new RangeError('Invalid transaction page');
      const query = new URLSearchParams({ start_date: new Date(start).toISOString(), end_date: new Date(end).toISOString(), fields: 'transaction_info', page_size: '100', page: String(page) });
      return readAccount(`/v1/reporting/transactions?${query}`, (data) => ({
        totalPages: Number.isSafeInteger(data.total_pages) ? data.total_pages : null,
        transactions: Array.isArray(data.transaction_details) ? data.transaction_details.map((row) => {
          const info = row?.transaction_info || {};
          return {
          id: info.transaction_id, referenceId: info.paypal_reference_id, referenceType: info.paypal_reference_id_type,
          eventCode: info.transaction_event_code, status: info.transaction_status, amount: publicAmount(info.transaction_amount), initiatedAt: info.transaction_initiation_date,
        }; }) : null,
      }));
    },
    listAccountDisputes() {
      return readAccount('/v1/customer/disputes?page_size=50', (data) => ({
        disputes: Array.isArray(data.items) ? data.items.map((item) => ({ id: item?.dispute_id, status: item?.status })) : null,
        hasNext: Array.isArray(data.links) ? data.links.some((link) => link?.rel === 'next') : null,
      }));
    },
    getAccountDispute(disputeId) {
      return readAccount(`/v1/customer/disputes/${identifier(disputeId, 'Dispute ID')}`, (data) => ({
        id: data.dispute_id, status: data.status, amount: publicAmount(data.dispute_amount),
        sellerTransactionIds: Array.isArray(data.disputed_transactions) ? data.disputed_transactions.map((item) => item?.seller_transaction_id) : null,
      }));
    },
    createOrder({ amount = '50.00', currency = 'USD', requestId } = {}) {
      identifier(requestId, 'Request ID');
      return request('POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{ amount: money(amount, currency) }],
      }, requestId);
    },
    getOrder(orderId) {
      return request('GET', `/v2/checkout/orders/${identifier(orderId, 'Order ID')}`);
    },
    captureOrder(orderId, { requestId } = {}) {
      identifier(requestId, 'Request ID');
      return request('POST', `/v2/checkout/orders/${identifier(orderId, 'Order ID')}/capture`, {}, requestId);
    },
    getCapture(captureId) {
      return request('GET', `/v2/payments/captures/${identifier(captureId, 'Capture ID')}`);
    },
    refundCapture(captureId, { amount, currency = 'USD', requestId } = {}) {
      identifier(requestId, 'Request ID');
      return request('POST', `/v2/payments/captures/${identifier(captureId, 'Capture ID')}/refund`, {
        amount: money(amount, currency),
      }, requestId);
    },
    getRefund(refundId) {
      return request('GET', `/v2/payments/refunds/${identifier(refundId, 'Refund ID')}`);
    },
  };
}
