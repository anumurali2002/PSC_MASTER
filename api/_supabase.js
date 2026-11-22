const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kcjnpwpgymdbiznfkejp.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || 'sb_publishable_ououjfn3gwX9-k-onSd0Kw_i4MHYIN7';

async function request(path, options = {}) {
  const { method = 'GET', body, apiKey = SERVICE_KEY, token } = options;
  if (!apiKey) {
    const err = new Error('Server is missing Supabase credentials.');
    err.status = 500;
    throw err;
  }
  const headers = { apikey: apiKey, 'Content-Type': 'application/json' };
  headers.Authorization = `Bearer ${token || apiKey}`;
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const message = data && (data.msg || data.message || data.error_description || data.error) || response.statusText;
    const err = new Error(typeof message === 'string' ? message : JSON.stringify(message));
    err.status = response.status;
    throw err;
  }
  return data;
}

async function requireAdmin(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    const err = new Error('Please sign in again.');
    err.status = 401;
    throw err;
  }
  const user = await request('/auth/v1/user', { apiKey: ANON_KEY, token });
  const profiles = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`);
  if (!profiles.length || profiles[0].role !== 'admin') {
    const err = new Error('Administrator access required.');
    err.status = 403;
    throw err;
  }
  return user;
}

function respond(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

module.exports = { request, requireAdmin, respond, SERVICE_KEY, ANON_KEY };
