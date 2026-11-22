import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status })

const fail = (message: string, status = 400) => json({ error: message }, status)

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : 'Unexpected error.'
}

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

  return { user, service }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

export async function GET() {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const [listed, profilesResult] = await Promise.all([
      auth.service.auth.admin.listUsers({ perPage: 1000, page: 1 }),
      auth.service.from('profiles').select('id,email,name,username,role,created_at,disabled').order('created_at', { ascending: true })
    ])
    if (listed.error) return fail(listed.error.message, 500)
    if (profilesResult.error) return fail(profilesResult.error.message, 500)

    const byId = new Map((profilesResult.data || []).map(p => [p.id, p]))
    const users = (listed.data.users || []).map(u => {
      const p = byId.get(u.id)
      return {
        id: u.id,
        email: u.email || p?.email || '',
        name: p?.name || (u.user_metadata && u.user_metadata.name) || '',
        username: p?.username || (u.user_metadata && u.user_metadata.username) || null,
        role: p?.role || 'learner',
        disabled: Boolean(p?.disabled ?? u.user_metadata?.disabled),
        created_at: u.created_at || p?.created_at || null
      }
    })
    return json({ users })
  } catch (err) {
    return fail(messageOf(err), 500)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const body = await request.json().catch(() => ({}))
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const name = String(body.name || '').trim() || email.split('@')[0]
    const role = body.role === 'admin' ? 'admin' : 'learner'

    if (!/^\S+@\S+\.\S+$/.test(email)) return fail('Enter a valid email address.')
    if (password.length < 6) return fail('Password must be at least 6 characters.')

    const { data, error } = await auth.service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    })
    if (error) return fail(error.message, 400)
    if (!data.user) return fail('User could not be created.', 500)

    const { error: profileError } = await auth.service
      .from('profiles')
      .update({ role, name, email })
      .eq('id', data.user.id)
    if (profileError) return fail(profileError.message, 500)

    return json({ id: data.user.id, email, name, role })
  } catch (err) {
    return fail(messageOf(err), 500)
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const body = await request.json().catch(() => ({}))
    const id = String(body.id || '')
    if (!id) return fail('Missing user id.')

    const isAdmin = (await auth.service.from('profiles').select('role').eq('id', auth.user.id).maybeSingle()).data?.role === 'admin'
    // allow user to update own name/username
    if (!isAdmin && id !== auth.user.id) return fail('Administrator access required.', 403)

    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = String(body.name).trim()
    if (body.username !== undefined) patch.username = String(body.username).trim().toLowerCase() || null
    if (isAdmin && body.email !== undefined) patch.email = String(body.email).trim().toLowerCase()
    if (isAdmin && body.role !== undefined) {
      if (!['admin', 'learner'].includes(body.role)) return fail('Invalid role.')
      patch.role = body.role
    }
    if (isAdmin && body.disabled !== undefined) patch.disabled = Boolean(body.disabled)

    if (isAdmin && patch.role === 'learner') {
      const { data: target } = await auth.service.from('profiles').select('role').eq('id', id).maybeSingle()
      if (target?.role === 'admin') {
        const { data: admins } = await auth.service.from('profiles').select('id').eq('role', 'admin')
        if ((admins || []).length <= 1) return fail('At least one admin must remain.')
      }
    }

    if (Object.keys(patch).length) {
      const { error } = await auth.service.from('profiles').update(patch).eq('id', id)
      if (error) return fail(error.message, 500)
      // also sync auth metadata for convenience
      const meta: Record<string, unknown> = {}
      if (patch.name !== undefined) meta.name = patch.name
      if (patch.username !== undefined) meta.username = patch.username
      if (patch.disabled !== undefined) meta.disabled = patch.disabled
      if (Object.keys(meta).length) await auth.service.auth.admin.updateUserById(id, { user_metadata: meta })
    }
    return json({ ok: true })
  } catch (err) {
    return fail(messageOf(err), 500)
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const body = await request.json().catch(() => ({}))
    const id = String(body.id || '')
    if (!id) return fail('Missing user id.')
    if (id === auth.user.id) return fail('You cannot delete your own account.')

    const { data: target } = await auth.service.from('profiles').select('role').eq('id', id).maybeSingle()
    if (target?.role === 'admin') {
      const { data: admins } = await auth.service.from('profiles').select('id').eq('role', 'admin')
      if ((admins || []).length <= 1) return fail('At least one admin must remain.')
    }

    const { error } = await auth.service.auth.admin.deleteUser(id)
    if (error) return fail(error.message, 500)
    return json({ ok: true })
  } catch (err) {
    return fail(messageOf(err), 500)
  }
}
