-- =====================================================================
-- PSC MASTER - database setup. Paste ALL of this into Supabase:
-- SQL Editor -> New query -> paste -> Run.  Safe to run more than once.
-- =====================================================================

-- ---------- TABLES ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text not null default '',
  username text unique,
  role text not null default 'learner' check (role in ('admin','learner')),
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists disabled boolean not null default false;
create unique index if not exists profiles_username_unique on public.profiles (lower(username)) where username is not null;

create table if not exists public.questions (
  id bigint generated always as identity primary key,
  subject text not null,
  topic text not null,
  qtext text not null,
  options jsonb not null check (jsonb_typeof(options)='array' and jsonb_array_length(options)=4),
  answer int not null check (answer between 0 and 3),
  difficulty text not null default 'Intermediate',
  explanation text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.exams (
  id bigint generated always as identity primary key,
  title text not null,
  size int not null,
  subjects text[] not null,
  created_at timestamptz not null default now()
);

create table if not exists public.exam_papers (
  exam_id bigint not null references public.exams(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  items jsonb not null,
  primary key (exam_id, learner_id)
);

create table if not exists public.attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('practice','exam')),
  exam_id bigint references public.exams(id) on delete set null,
  exam_title text,
  total int not null,
  correct int not null,
  wrong int not null,
  skipped int not null,
  created_at timestamptz not null default now()
);
create unique index if not exists attempts_one_per_exam on public.attempts(user_id, exam_id) where exam_id is not null;

-- The learner's individual answers live here. The admin can NOT read this table.
create table if not exists public.attempt_details (
  attempt_id bigint primary key references public.attempts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  details jsonb not null
);

create table if not exists public.wrong_answers (
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id bigint not null references public.questions(id) on delete cascade,
  primary key (user_id, question_id)
);

-- ---------- HELPERS ----------
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

-- Every new login automatically gets a profile. The very FIRST account created becomes the admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)),
          case when exists (select 1 from public.profiles where role='admin') then 'learner' else 'admin' end)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for accounts that already exist (earliest account becomes admin if there is no admin yet).
insert into public.profiles (id, email, name, role)
select u.id, u.email, split_part(u.email,'@',1),
       case when row_number() over (order by u.created_at) = 1
             and not exists (select 1 from public.profiles where role='admin') then 'admin' else 'learner' end
from auth.users u
on conflict (id) do nothing;

-- If an admin changes a question's options or correct answer, old "wrong answer" entries are cleared.
create or replace function public.questions_clear_wrong() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.answer <> old.answer or new.options <> old.options then
    delete from public.wrong_answers where question_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists questions_clear_wrong_trg on public.questions;
create trigger questions_clear_wrong_trg after update on public.questions
  for each row execute function public.questions_clear_wrong();

-- ---------- ROW LEVEL SECURITY (who may see what) ----------
alter table public.profiles        enable row level security;
alter table public.questions       enable row level security;
alter table public.exams           enable row level security;
alter table public.exam_papers     enable row level security;
alter table public.attempts        enable row level security;
alter table public.attempt_details enable row level security;
alter table public.wrong_answers   enable row level security;

revoke all on all tables in schema public from anon;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists questions_admin on public.questions;
create policy questions_admin on public.questions for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists exams_admin on public.exams;
create policy exams_admin on public.exams for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists exam_papers_admin on public.exam_papers;
create policy exam_papers_admin on public.exam_papers for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists attempts_select on public.attempts;
create policy attempts_select on public.attempts for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists attempt_details_select on public.attempt_details;
create policy attempt_details_select on public.attempt_details for select to authenticated using (user_id = auth.uid());
drop policy if exists wrong_answers_select on public.wrong_answers;
create policy wrong_answers_select on public.wrong_answers for select to authenticated using (user_id = auth.uid());

-- ---------- LEARNER FUNCTIONS (they never expose a correct answer before submitting) ----------
create or replace function public.get_catalog() returns jsonb
language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('subject',subject,'topic',topic,'n',n) order by subject, topic), '[]'::jsonb)
  from (select subject, topic, count(*)::int as n from public.questions group by subject, topic) c
  where auth.uid() is not null
$$;

create or replace function public.get_practice_questions(p_subject text, p_topic text default null) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'subject',subject,'topic',topic,'qtext',qtext,'options',options,'difficulty',difficulty)), '[]'::jsonb)
  from (select * from public.questions
        where auth.uid() is not null and subject = p_subject and (p_topic is null or topic = p_topic)
        order by random()) s
$$;

create or replace function public._grade(items jsonb, ans_in jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare e jsonb; c int := 0; w int := 0; s int := 0; rev jsonb := '[]'::jsonb; v text; ch int;
        ans jsonb := coalesce(ans_in, '{}'::jsonb);
begin
  for e in select value from jsonb_array_elements(items) loop
    v := ans ->> (e->>'id');
    ch := case when v ~ '^[0-3]$' then v::int else null end;
    if ch is null then s := s + 1;
    elsif ch = (e->>'answer')::int then c := c + 1;
    else w := w + 1; end if;
    rev := rev || jsonb_build_array(jsonb_build_object(
      'id', e->'id', 'qtext', e->'qtext', 'options', e->'options',
      'chosen', ch, 'answer', e->'answer', 'explanation', coalesce(e->>'explanation','')));
  end loop;
  return jsonb_build_object('total', c+w+s, 'correct', c, 'wrong', w, 'skipped', s, 'review', rev);
end $$;

create or replace function public._record(uid uuid, p_kind text, p_exam_id bigint, p_title text, g jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare aid bigint;
begin
  insert into public.attempts (user_id, kind, exam_id, exam_title, total, correct, wrong, skipped)
  values (uid, p_kind, p_exam_id, p_title, (g->>'total')::int, (g->>'correct')::int, (g->>'wrong')::int, (g->>'skipped')::int)
  returning id into aid;
  insert into public.attempt_details (attempt_id, user_id, details) values (aid, uid, g->'review');
  delete from public.wrong_answers
   where user_id = uid and question_id in (
     select (x->>'id')::bigint from jsonb_array_elements(g->'review') x
     where x->>'chosen' is not null and (x->>'chosen')::int = (x->>'answer')::int);
  insert into public.wrong_answers (user_id, question_id)
  select uid, (x->>'id')::bigint from jsonb_array_elements(g->'review') x
   where x->>'chosen' is not null and (x->>'chosen')::int <> (x->>'answer')::int
     and exists (select 1 from public.questions q where q.id = (x->>'id')::bigint)
  on conflict do nothing;
  return aid;
end $$;

create or replace function public.submit_practice(p_qids bigint[], p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); items jsonb; g jsonb; aid bigint;
begin
  if uid is null then raise exception 'Please sign in again.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'qtext',q.qtext,'options',q.options,'answer',q.answer,'explanation',q.explanation) order by t.ord), '[]'::jsonb)
    into items
    from unnest(p_qids) with ordinality as t(id, ord) join public.questions q on q.id = t.id;
  g := public._grade(items, p_answers);
  if (g->>'total')::int = 0 then raise exception 'No questions to grade.'; end if;
  aid := public._record(uid, 'practice', null, null, g);
  return g || jsonb_build_object('attempt_id', aid);
end $$;

create or replace function public.get_my_exams() returns jsonb
language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'title', e.title, 'created_at', e.created_at, 'size', jsonb_array_length(p.items),
           'subjects', e.subjects, 'attempt_id', a.id, 'correct', a.correct, 'total', a.total)
         order by e.created_at desc), '[]'::jsonb)
  from public.exam_papers p
  join public.exams e on e.id = p.exam_id
  left join public.attempts a on a.exam_id = e.id and a.user_id = p.learner_id
  where p.learner_id = auth.uid()
$$;

create or replace function public.get_my_paper(p_exam_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); it jsonb;
begin
  select items into it from public.exam_papers where exam_id = p_exam_id and learner_id = uid;
  if not found then raise exception 'This exam is not assigned to you.'; end if;
  if exists (select 1 from public.attempts where exam_id = p_exam_id and user_id = uid) then
    raise exception 'You have already completed this exam.';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',x.e->'id','subject',x.e->'subject','topic',x.e->'topic',
                    'qtext',x.e->'qtext','options',x.e->'options','difficulty',x.e->'difficulty') order by x.ord), '[]'::jsonb)
          from jsonb_array_elements(it) with ordinality as x(e, ord));
end $$;

create or replace function public.submit_exam(p_exam_id bigint, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); it jsonb; ttl text; g jsonb; aid bigint;
begin
  if uid is null then raise exception 'Please sign in again.'; end if;
  select items into it from public.exam_papers where exam_id = p_exam_id and learner_id = uid;
  if not found then raise exception 'This exam is not assigned to you.'; end if;
  if exists (select 1 from public.attempts where exam_id = p_exam_id and user_id = uid) then
    raise exception 'You have already completed this exam.';
  end if;
  select title into ttl from public.exams where id = p_exam_id;
  g := public._grade(it, p_answers);
  aid := public._record(uid, 'exam', p_exam_id, ttl, g);
  return g || jsonb_build_object('attempt_id', aid);
end $$;

create or replace function public.get_my_revision() returns jsonb
language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'subject',q.subject,'topic',q.topic,'qtext',q.qtext,
         'options',q.options,'answer',q.answer,'explanation',q.explanation) order by q.id), '[]'::jsonb)
  from public.wrong_answers w join public.questions q on q.id = w.question_id
  where w.user_id = auth.uid()
$$;

-- ---------- PERMISSIONS ON FUNCTIONS ----------
revoke all on function public._grade(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._record(uuid, text, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.get_catalog() from public, anon;
revoke all on function public.get_practice_questions(text, text) from public, anon;
revoke all on function public.submit_practice(bigint[], jsonb) from public, anon;
revoke all on function public.get_my_exams() from public, anon;
revoke all on function public.get_my_paper(bigint) from public, anon;
revoke all on function public.submit_exam(bigint, jsonb) from public, anon;
revoke all on function public.get_my_revision() from public, anon;
grant execute on function public.get_catalog() to authenticated;
grant execute on function public.get_practice_questions(text, text) to authenticated;
grant execute on function public.submit_practice(bigint[], jsonb) to authenticated;
grant execute on function public.get_my_exams() to authenticated;
grant execute on function public.get_my_paper(bigint) to authenticated;
grant execute on function public.submit_exam(bigint, jsonb) to authenticated;
grant execute on function public.get_my_revision() to authenticated;


-- ---------- PROFILE / HISTORY / ANALYTICS ----------
create or replace function public.get_my_attempts() returns jsonb
language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'exam_id', a.exam_id, 'exam_title', coalesce(a.exam_title, case when a.kind='exam' then 'Exam' else 'Practice Test' end),
    'kind', a.kind, 'total', a.total, 'correct', a.correct, 'wrong', a.wrong, 'skipped', a.skipped, 'created_at', a.created_at
  ) order by a.created_at desc), '[]'::jsonb)
  from public.attempts a where a.user_id = auth.uid();
$$;

create or replace function public.get_my_attempt_detail(p_attempt_id bigint) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare uid uuid := auth.uid(); rec jsonb;
begin
  if uid is null then raise exception 'Please sign in again.'; end if;
  select jsonb_build_object(
    'id', a.id, 'exam_id', a.exam_id, 'exam_title', coalesce(a.exam_title, case when a.kind='exam' then 'Exam' else 'Practice Test' end),
    'kind', a.kind, 'total', a.total, 'correct', a.correct, 'wrong', a.wrong, 'skipped', a.skipped, 'created_at', a.created_at,
    'review', d.details
  ) into rec
  from public.attempts a join public.attempt_details d on d.attempt_id = a.id
  where a.id = p_attempt_id and a.user_id = uid;
  if rec is null then raise exception 'Attempt not found.'; end if;
  return rec;
end $$;

create or replace function public.get_my_profile_stats() returns jsonb
language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'attempts', count(*),
    'total', coalesce(sum(total),0),
    'correct', coalesce(sum(correct),0),
    'wrong', coalesce(sum(wrong),0),
    'skipped', coalesce(sum(skipped),0),
    'best', coalesce(max(case when total>0 then round(correct::numeric*100/total) else 0 end),0),
    'avg', coalesce(round(avg(case when total>0 then correct::numeric*100/total else 0 end)),0)
  ) from public.attempts where user_id = auth.uid();
$$;

revoke all on function public.get_my_attempts() from public, anon;
revoke all on function public.get_my_attempt_detail(bigint) from public, anon;
revoke all on function public.get_my_profile_stats() from public, anon;
grant execute on function public.get_my_attempts() to authenticated;
grant execute on function public.get_my_attempt_detail(bigint) to authenticated;
grant execute on function public.get_my_profile_stats() to authenticated;
