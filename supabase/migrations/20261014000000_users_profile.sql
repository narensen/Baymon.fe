-- Run once in the Supabase SQL editor (or via `supabase db push`).
-- Assumes public.users already exists with the schema the app was built against.

-- 1. Create the profile row automatically when an auth user signs up.
--    The app passes `username` and `display_name` as signup metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (user_id, username, display_name)
  values (
    new.id,
    lower(coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      'user_' || substr(replace(new.id::text, '-', ''), 1, 8)
    )),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Row level security: each user can only see and change their own row.
alter table public.users enable row level security;

drop policy if exists "Users can read their own profile" on public.users;
create policy "Users can read their own profile"
  on public.users for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own profile" on public.users;
create policy "Users can create their own profile"
  on public.users for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own profile" on public.users;
create policy "Users can update their own profile"
  on public.users for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- NOTE: the policy above lets users change their own `role` (Settings exposes it).
-- If `role` ever grants privileges, lock it down instead:
--   revoke update on public.users from authenticated;
--   grant update (username, display_name) on public.users to authenticated;

-- 3. Username availability check used during signup and in Settings.
--    Security definer so it works before sign-in without exposing other users' rows.
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.users where username = lower(p_username));
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
