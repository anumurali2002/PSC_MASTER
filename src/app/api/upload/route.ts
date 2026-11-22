import { put } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status })
const fail = (message: string, status = 400) => json({ error: message }, status)

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: fail('Please sign in again.', 401) }

  const service = createServiceClient()
  const { data: profile, error } = await service
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (error) return { error: fail(error.message, 500) }
  if (profile?.role !== 'admin') return { error: fail('Administrator access required.', 403) }

  return { user }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return fail('Choose a file to upload.')

    const safeName = file.name.replace(/\\/g, '/').split('/').pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'upload'
    const path = `uploads/${Date.now()}-${safeName}`
    const options: { access: 'public'; token?: string } = { access: 'public' }
    if (process.env.BLOB_READ_WRITE_TOKEN) options.token = process.env.BLOB_READ_WRITE_TOKEN

    const { url } = await put(path, file, options)
    return json({ url, path })
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Upload failed.', 500)
  }
}
