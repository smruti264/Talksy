# Talksy

Talksy is a WhatsApp-style multi-user chat web app built for GitHub Pages with:

- HTML + CSS + vanilla JavaScript
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage
- Supabase Realtime
- Responsive laptop/tablet/mobile UI
- Phone number + password login
- No OTP flow — phone number works purely as a login ID
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

## 3. Enable Email provider (required internally — users never see it)

Talksy's screens only ever ask for **phone number + password** — exactly like you asked, with no OTP anywhere. Under the hood, Supabase Auth still needs an email address for every account, so the app automatically builds one from the phone number (e.g. `919876543210@talksy.local`) and uses it invisibly. The user never sees or types this — they only ever use their phone number.

Because of that, you must:

**Authentication → Providers → Email** → make sure Email is **enabled**.

**Authentication → Sign In / Providers → Email** → find the "Confirm email" toggle and turn it **OFF**, then save.
This step is mandatory. The auto-generated email addresses are fake and can never receive a real confirmation link — if "Confirm email" stays ON, every new account will be stuck forever and can never log in, and repeated signups will also hit Supabase's built-in email rate limit.

You do **not** need to touch the Phone provider at all — Talksy no longer uses it, which is exactly what avoids the old SMS-provider error during registration.

Talksy uses `signUp({ email: <derived from phone>, password, options: { data: { display_name, phone } } })` and `signInWithPassword({ email: <derived from phone>, password })` — the phone number itself is what's stored on the profile and what's used for searching/finding other users.

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
Phone: +919876543210
Password: test1234

User B
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
Make sure **Authentication → Providers → Email** is enabled. Talksy stores your phone number as your login ID but authenticates through Supabase's Email provider behind the scenes, so no SMS provider (Twilio, etc.) is required, and the Phone provider does not need to be touched.

### Account created but you can never log in afterwards
This means **"Confirm email" is still ON** in Authentication settings. Since Talksy generates a fake internal email for each phone number, it can never receive a real confirmation link, so the account stays stuck unconfirmed. Turn "Confirm email" OFF in **Authentication → Sign In / Providers → Email**.

### "Email rate limit exceeded" during signup
This happens when Supabase tries (and keeps retrying) to send a confirmation email — which only occurs if "Confirm email" is still ON. Turn it OFF as described above, then wait a few minutes for the rate limit to reset before trying again. Talksy's signup code no longer needs any email to actually be sent.

### "User already registered"
That phone number already has an account. Try logging in instead, or use a different phone number.

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
