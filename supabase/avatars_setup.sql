-- Profile avatar: column + public storage bucket.
--
-- The server uploads avatars with the Supabase SERVICE-ROLE key, which bypasses
-- Row Level Security, so no storage RLS policy is required here. The bucket is
-- created with public = true so the public URL the server returns renders
-- directly in the client <Image>. Apply this once in the Supabase SQL editor
-- (or via the CLI) before the /v1/avatar endpoint is used.

alter table user_profile add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
