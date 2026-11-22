const { request, requireAdmin, respond } = require('./_supabase');

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  try {
    const admin = await requireAdmin(req);
    if (req.method === 'GET') {
      const [auth, profiles] = await Promise.all([
        request('/auth/v1/users?perPage=1000&page=1'),
        request('/rest/v1/profiles?select=id,email,name,role,created_at&order=created_at.asc')
      ]);
      const byId = new Map(profiles.map(p => [p.id, p]));
      const users = (auth.users || []).map(u => {
        const p = byId.get(u.id) || {};
        return {
          id: u.id,
          email: u.email || p.email || '',
          name: p.name || (u.user_metadata && u.user_metadata.name) || '',
          role: p.role || 'learner',
          created_at: u.created_at || p.created_at || null
        };
      });
      respond(res, 200, { users });
      return;
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (req.method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const name = String(body.name || '').trim();
      const role = body.role === 'admin' ? 'admin' : 'learner';
      if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Enter a valid email address.');
      if (password.length < 6) throw bad('Password must be at least 6 characters.');
      const created = await request('/auth/v1/users', {
        method: 'POST',
        body: { email, password, email_confirm: true, user_metadata: { name: name || email.split('@')[0] } }
      });
      const user = created.user || created;
      await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: { role, name: name || email.split('@')[0], email }
      });
      respond(res, 200, { id: user.id, email, name: name || email.split('@')[0], role });
      return;
    }
    if (req.method === 'PATCH') {
      const id = String(body.id || '');
      if (!id) throw bad('Missing user id.');
      const patch = {};
      if (body.name !== undefined) patch.name = String(body.name).trim();
      if (body.role !== undefined) {
        if (!['admin', 'learner'].includes(body.role)) throw bad('Invalid role.');
        patch.role = body.role;
      }
      if (body.email !== undefined) patch.email = String(body.email).trim().toLowerCase();
      if (Object.keys(patch).length) {
        await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
      }
      respond(res, 200, { ok: true });
      return;
    }
    if (req.method === 'DELETE') {
      const id = String(body.id || req.query.id || '');
      if (!id) throw bad('Missing user id.');
      if (id === admin.id) throw bad('You cannot delete your own account.');
      const profiles = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=role`);
      if (profiles[0] && profiles[0].role === 'admin') {
        const admins = await request('/rest/v1/profiles?select=id&role=eq.admin');
        if (admins.length <= 1) throw bad('At least one admin must remain.');
      }
      await request(`/auth/v1/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
      respond(res, 200, { ok: true });
      return;
    }
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE, OPTIONS');
    respond(res, 405, { error: 'Method not allowed.' });
  } catch (err) {
    respond(res, err.status || 500, { error: err.message || 'Unexpected error.' });
  }
};
