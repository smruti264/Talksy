# Talksy

Talksy is a WhatsApp-style multi-user chat web app built for GitHub Pages with:

- HTML + CSS + vanilla JavaScript
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage
- Supabase Realtime
- Responsive laptop/tablet/mobile UI
- Email + password login
- Phone number used as a public ID only (not for login, not OTP-verified)
- DP/profile picture upload
- Search users by phone number
- Saved contact names
- 1-to-1 chats
- Image/video/audio/document sharing
- All / Read / Unread chat filters
- Archive, clear, delete
- Block / unblock and block list
- Day / night mode

## 1. Files

```text
Talksy/
├── index.html
├── style.css
├── app.js
├── config.js
├── supabase.sql
└── README.md
```

## 2. Create Supabase project

Create a project at Supabase.

Then open:

**SQL Editor → New query**

Paste the entire `supabase.sql` file and run it.

The SQL creates:

- profiles
- contacts
- conversations
- chat_members
- messages
- chat_reads
- blocks
- RLS policies
- avatar/media storage bucket
- profile creation trigger
- Realtime configuration

If you already ran an older version of this SQL that used phone-based auth, it is safe to run the updated file again — table creation uses `if not exists` and the trigger function is replaced with `create or replace function`.

## 3. Enable email + password authentication (no OTP)

Talksy authenticates with **email + password**. Phone number is only stored as a public ID field on the profile, so other users can find you by phone — it is not used to sign in and is never OTP-verified.

In Supabase:

**Authentication → Providers → Email**

Make sure Email is enabled.

**Authentication → Settings** (or **Providers → Email** depending on your Supabase version): if you want instant login right after signup (no confirmation email step), turn OFF "Confirm email". If you leave it ON, users must click the link sent to their inbox before they can log in.

Talksy uses `signUp({ email, password, options: { data: { display_name, phone } } })` and `signInWithPassword({ email, password })`.

This avoids the common registration failure caused by Supabase's Phone provider requiring a configured SMS provider (e.g. Twilio) even when phone verification is disabled.

## 4. Add Supabase credentials

Open `config.js`:

```js
window.TALKSY_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-SUPABASE-ANON-KEY"
};
```

Get both values from your Supabase project's API settings.

Only use the public `anon` key in this browser project.

**Never put the Supabase `service_role` key in GitHub.**

## 5. Test locally

Because this app is a static frontend, you can use VS Code Live Server.

Open the Talksy folder and run `index.html` with Live Server.

Create two different test accounts on two browsers/devices.

Example:

```text
User A
Email: usera@example.com
Phone: +919876543210
Password: test1234

User B
Email: userb@example.com
Phone: +919876543211
Password: test1234
```

Search User B's phone from User A, open the chat, then send a message/media.

## 6. Deploy to GitHub Pages

Create a GitHub repository, for example:

```text
talksy
```

Upload:

```text
index.html
style.css
app.js
config.js
supabase.sql
README.md
```

Then:

**GitHub repository → Settings → Pages**

Set:

```text
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

Save.

Your website will be available at your GitHub Pages address.

## 7. Very important GitHub security note

The Supabase URL and browser `anon` key are designed to be used in client applications.

The real protection is Supabase RLS.

Do not upload:

- service_role key
- database password
- secret API keys
- private server credentials

The included SQL enables RLS for the application tables.

## 8. Media storage

The app uses the `talksy-media` bucket.

Users upload files under their own user ID:

```text
user-id/conversation-id/file
```

The SQL policies allow users to upload/update/delete only inside their own top-level folder.

This version uses a public storage bucket so GitHub Pages can display shared media using `getPublicUrl()`.

If you later want truly private media, change the bucket to private and update the JavaScript to generate signed URLs.

## 9. Saved names

The frontend currently searches registered users by phone.

To save/edit a custom contact name, open a chat and **double-click the contact avatar** in the conversation header.

The custom name is stored in the `contacts` table for the current user only.

## 10. What is intentionally not included

This beginner-friendly version does not implement:

- voice/video calls
- end-to-end encryption
- disappearing messages
- message reactions
- group chats
- status/stories
- push notifications
- message forwarding
- message editing UI

Those can be added later.

## 11. Recommended next upgrades

For a production-grade Talksy, add:

1. Private Storage + signed URLs
2. Edge Functions for secure media processing
3. Push notifications
4. Message reactions
5. Reply/forward
6. Group chats
7. Voice/video calls
8. End-to-end encryption
9. Rate limiting / abuse prevention
10. Image compression and thumbnails
11. Pagination/infinite scroll for messages
12. Better unread-count tracking
13. Phone number ownership verification (SMS OTP) if you need it later

## 12. Troubleshooting

### "Invalid API key"
Check `config.js`.

### "relation does not exist"
Run the complete `supabase.sql` in Supabase SQL Editor.

### Register fails / "Signups not allowed" / phone provider errors
Make sure **Authentication → Providers → Email** is enabled. Talksy no longer uses the Phone provider, so no SMS provider (Twilio, etc.) is required.

### Users can sign up but cannot log in right away
Check **Authentication → Settings** — if "Confirm email" is ON, the user must click the confirmation link in their inbox first. Turn it OFF for instant login during testing.

### Messages do not appear live
Make sure `messages` is enabled in Supabase Realtime. The SQL includes:

```sql
alter publication supabase_realtime add table public.messages;
```

If Supabase says the table is already in the publication, that is okay.

### Media upload fails
Check:

- `talksy-media` bucket exists
- storage policies from `supabase.sql` were created
- the user is logged in
- the browser has selected a file

## License

You can modify this project for learning and personal projects.
