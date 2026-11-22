const { put } = require('@vercel/blob');
const { requireAdmin, respond } = require('./_supabase');

function firstFile(req) {
  const files = req.files || {};
  const value = files.file || files[Object.keys(files)[0]];
  return Array.isArray(value) ? value[0] : value;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    respond(res, 405, { error: 'Method not allowed.' });
    return;
  }
  try {
    await requireAdmin(req);
    const file = firstFile(req);
    const name = file && file.name;
    const data = file && (file.data || file.file);
    if (!name || !data) {
      respond(res, 400, { error: 'Choose a file to upload.' });
      return;
    }
    const safeName = String(name).replace(/\\/g, '/').split('/').pop().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'upload';
    const path = `uploads/${Date.now()}-${safeName}`;
    const options = { access: 'public' };
    if (process.env.BLOB_READ_WRITE_TOKEN) options.token = process.env.BLOB_READ_WRITE_TOKEN;
    const { url } = await put(path, data, options);
    respond(res, 200, { url, path });
  } catch (err) {
    respond(res, err.status || 500, { error: err.message || 'Upload failed.' });
  }
};
