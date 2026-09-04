-- ============================================================
-- TALKsy database setup for Supabase
-- Run this entire file in Supabase SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

-- Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text unique not null,
  display_name text not null default 'Talksy User',
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Contacts: each user can save a custom name for another user.
create table if not exists public.contacts (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.profiles(id) on delete cascade,
  saved_name text not null,
  created_at timestamptz not null default now(),
  primary key(owner_id,contact_id),
  check(owner_id <> contact_id)
);

-- One conversation per pair.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user1 uuid not null references public.profiles(id) on delete cascade,
  user2 uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check(user1 <> user2),
  unique(user1,user2)
);

-- One membership row for each participant.
create table if not exists public.chat_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  other_user_id uuid not null references public.profiles(id) on delete cascade,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  primary key(conversation_id,user_id),
  check(user_id <> other_user_id)
);

create index if not exists chat_members_user_idx on public.chat_members(user_id);

-- Messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  media_url text,
  media_type text,
  file_name text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at);

-- Last-read marker per participant.
create table if not exists public.chat_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key(user_id,conversation_id)
);

-- Block list
create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(blocker_id,blocked_id),
  check(blocker_id <> blocked_id)
);

-- ------------------------------------------------------------
-- Contact-aware profile view:
-- When a user reads another profile, expose their saved name
-- to that user when one exists.
-- ------------------------------------------------------------
create or replace view public.my_visible_profiles
with (security_invoker = true) as
select
  p.id,p.phone,
  coalesce(c.saved_name,p.display_name) as display_name,
  p.avatar_url,p.created_at
from public.profiles p
left join public.contacts c
  on c.contact_id=p.id and c.owner_id=auth.uid();

-- ------------------------------------------------------------
-- Trigger: create profile automatically after Auth signup.
-- Talksy now authenticates with EMAIL + PASSWORD.
-- The phone number is only a public ID (not verified, not used
-- for login) and is passed in at signUp() time inside
-- options.data.phone (raw_user_meta_data).
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id,phone,display_name)
  values(
    new.id,
    coalesce(new.raw_user_meta_data->>'phone',new.phone,''),
    coalesce(new.raw_user_meta_data->>'display_name','Talksy User')
  )
  on conflict (id) do update
  set phone=coalesce(nullif(public.profiles.phone,''),excluded.phone),
      display_name=coalesce(nullif(public.profiles.display_name,''),excluded.display_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.chat_reads enable row level security;
alter table public.blocks enable row level security;

-- Profiles: logged-in users can search profiles.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles for select to authenticated using (true);

drop policy if exists "profile_update_own" on public.profiles;
create policy "profile_update_own"
on public.profiles for update to authenticated
using (id=auth.uid()) with check (id=auth.uid());

-- Contacts
drop policy if exists "contacts_own_select" on public.contacts;
create policy "contacts_own_select"
on public.contacts for select to authenticated using (owner_id=auth.uid());
drop policy if exists "contacts_own_insert" on public.contacts;
create policy "contacts_own_insert"
on public.contacts for insert to authenticated with check (owner_id=auth.uid());
drop policy if exists "contacts_own_update" on public.contacts;
create policy "contacts_own_update"
on public.contacts for update to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
drop policy if exists "contacts_own_delete" on public.contacts;
create policy "contacts_own_delete"
on public.contacts for delete to authenticated using (owner_id=auth.uid());

-- Conversations: participants can access their conversations.
drop policy if exists "conversation_participant_select" on public.conversations;
create policy "conversation_participant_select"
on public.conversations for select to authenticated
using (user1=auth.uid() or user2=auth.uid());
drop policy if exists "conversation_participant_insert" on public.conversations;
create policy "conversation_participant_insert"
on public.conversations for insert to authenticated
with check (user1=auth.uid() or user2=auth.uid());
drop policy if exists "conversation_participant_update" on public.conversations;
create policy "conversation_participant_update"
on public.conversations for update to authenticated
using (user1=auth.uid() or user2=auth.uid())
with check (user1=auth.uid() or user2=auth.uid());

-- Chat members
drop policy if exists "chat_members_own_select" on public.chat_members;
create policy "chat_members_own_select"
on public.chat_members for select to authenticated using (user_id=auth.uid());
drop policy if exists "chat_members_own_insert" on public.chat_members;
create policy "chat_members_own_insert"
on public.chat_members for insert to authenticated
with check (user_id=auth.uid());
drop policy if exists "chat_members_own_update" on public.chat_members;
create policy "chat_members_own_update"
on public.chat_members for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists "chat_members_own_delete" on public.chat_members;
create policy "chat_members_own_delete"
on public.chat_members for delete to authenticated using (user_id=auth.uid());

-- Messages: participants can read; sender can insert/update/delete.
drop policy if exists "messages_participant_select" on public.messages;
create policy "messages_participant_select"
on public.messages for select to authenticated
using (
  exists (
    select 1 from public.chat_members cm
    where cm.conversation_id=messages.conversation_id
      and cm.user_id=auth.uid()
  )
);
drop policy if exists "messages_participant_insert" on public.messages;
create policy "messages_participant_insert"
on public.messages for insert to authenticated
with check (
  sender_id=auth.uid()
  and exists (
    select 1 from public.chat_members cm
    where cm.conversation_id=messages.conversation_id
      and cm.user_id=auth.uid()
  )
);
drop policy if exists "messages_sender_update" on public.messages;
create policy "messages_sender_update"
on public.messages for update to authenticated
using (sender_id=auth.uid()) with check (sender_id=auth.uid());
drop policy if exists "messages_sender_delete" on public.messages;
create policy "messages_sender_delete"
on public.messages for delete to authenticated
using (sender_id=auth.uid());

-- Reads
drop policy if exists "chat_reads_own" on public.chat_reads;
create policy "chat_reads_own"
on public.chat_reads for select to authenticated using (user_id=auth.uid());
drop policy if exists "chat_reads_insert" on public.chat_reads;
create policy "chat_reads_insert"
on public.chat_reads for insert to authenticated with check (user_id=auth.uid());
drop policy if exists "chat_reads_update" on public.chat_reads;
create policy "chat_reads_update"
on public.chat_reads for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

-- Blocks
drop policy if exists "blocks_own_select" on public.blocks;
create policy "blocks_own_select"
on public.blocks for select to authenticated using (blocker_id=auth.uid());
drop policy if exists "blocks_own_insert" on public.blocks;
create policy "blocks_own_insert"
on public.blocks for insert to authenticated with check (blocker_id=auth.uid());
drop policy if exists "blocks_own_delete" on public.blocks;
create policy "blocks_own_delete"
on public.blocks for delete to authenticated using (blocker_id=auth.uid());

-- ------------------------------------------------------------
-- Storage
-- Create a public bucket for simple GitHub Pages deployment.
-- For highly private production media, use a private bucket + signed URLs.
-- ------------------------------------------------------------
insert into storage.buckets(id,name,public)
values('talksy-media','talksy-media',true)
on conflict(id) do update set public=true;

drop policy if exists "talksy_media_upload_own_folder" on storage.objects;
create policy "talksy_media_upload_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id='talksy-media'
  and (storage.foldername(name))[1]=auth.uid()::text
);

drop policy if exists "talksy_media_update_own_folder" on storage.objects;
create policy "talksy_media_update_own_folder"
on storage.objects for update to authenticated
using (
  bucket_id='talksy-media'
  and (storage.foldername(name))[1]=auth.uid()::text
)
with check (
  bucket_id='talksy-media'
  and (storage.foldername(name))[1]=auth.uid()::text
);

drop policy if exists "talksy_media_delete_own_folder" on storage.objects;
create policy "talksy_media_delete_own_folder"
on storage.objects for delete to authenticated
using (
  bucket_id='talksy-media'
  and (storage.foldername(name))[1]=auth.uid()::text
);

-- Public read is needed because the frontend uses getPublicUrl().
drop policy if exists "talksy_media_public_read" on storage.objects;
create policy "talksy_media_public_read"
on storage.objects for select to public
using (bucket_id='talksy-media');

-- ------------------------------------------------------------
-- Realtime
-- Add messages to the realtime publication (only if not already added).
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
