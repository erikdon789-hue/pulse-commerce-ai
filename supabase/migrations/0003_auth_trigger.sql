-- Auto-creates a public.profiles row whenever a new auth.users row appears.
-- Needed because profiles has no INSERT policy (by design — the trusted
-- path is this trigger, not a client-side insert). Also seeds a few free
-- credits so new signups can try a store build without paying first.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, credits_balance)
  values (new.id, new.email, 3)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
