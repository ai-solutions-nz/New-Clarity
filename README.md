# AI Solutions NZ cold outreach (Google Sheets + Gmail)

A Google Sheet with an **Outreach** menu that sends short, personalised cold emails from your Gmail, with follow-ups, opt-out handling and a full log. Nothing is sent until a human approves a row and Dry run is switched off.

Files: `Code.gs` (all the logic), `appsscript.json` (time zone and permissions). Nothing else is needed.

## What it does

- Sends only rows with Status **Approved**, plus follow-ups that are due for rows already contacted.
- Never sends to rows with no email, or Status Unsubscribed, Bounced, Replied or Won.
- Never sends to Australian rows with a generic address (info@, admin@, hello@, office@, enquiries@ and similar) unless you tick **Allow generic** on that row.
- Daily cap (default 10, maximum 20), weekdays 8:30am to 4pm Pacific/Auckland, random 30 to 90 second gaps between sends, Apps Script quota respected.
- Follow-ups go in the same Gmail thread: day 3, day 7, day 14 after the first email.
- Every email gets a footer: your name, business name, address, and "Reply STOP and I won't email you again." Australian emails also get your ABN.
- Check replies: any reply sets Replied and stops the sequence. Bounces set Bounced. Replies like "stop", "unsubscribe", "remove me", "opt out" set Unsubscribed. The same email is also blocked on every other tab.
- Live sending is refused while the address (and ABN for Australia) in Settings still has `[square brackets]`.

## 1. Put the code into your Sheet

**Option A: copy and paste (easiest)**

1. Open your Google Sheet, then **Extensions > Apps Script**.
2. Delete the contents of the default `Code.gs` and paste in the whole of `Code.gs` from this repo.
3. Click the gear icon (**Project Settings**), tick **Show "appsscript.json" manifest file in editor**.
4. Open `appsscript.json` in the editor and replace its contents with the one from this repo.
5. Click **Save**, then go back to the Sheet and reload the page. An **Outreach** menu appears.

**Option B: clasp**

```bash
npm install -g @google/clasp
clasp login
clasp clone <SCRIPT_ID>        # script ID: Apps Script > Project Settings; run in an empty folder
# copy Code.gs and appsscript.json from this repo over the cloned ones
clasp push
```

For a brand new sheet, `clasp create --type sheets --title "Outreach"` makes the Sheet and a bound script together. `.clasp.json.example` shows the file clasp writes (it is git-ignored).

## 2. Authorise

The first time you use a menu item, Google asks you to authorise. You may see "Google hasn't verified this app": click **Advanced > Go to (project name) (unsafe)** then **Allow**. That warning is normal for your own scripts. The permissions requested are:

| Permission | Why |
| --- | --- |
| Google Sheets | read and write your leads, settings and log |
| Gmail (`mail.google.com`) | send emails, reply in threads, read threads to spot replies and bounces |
| Send email as you | check your remaining daily send quota |
| Triggers | the optional daily/hourly automation |
| Show menus and dialogs | the Outreach menu |
| Your email address | know which messages are yours |

No passwords or API keys are used or stored anywhere.

## 3. Run Setup

**Outreach > Setup.** It is safe to run again any time. It will:

- set the Sheet time zone to Pacific/Auckland
- add any missing columns to your existing lead tabs (your existing columns and data are left as they are; columns are matched by header name, in any order)
- create `Property managers` and `Cleaning` lead tabs only if you have no lead tabs yet
- create **Templates** (8 starter emails), **Settings**, **Log** and **Preview** tabs

Each lead tab is one segment. The tab name must match the Segment in Templates (for example the `Cleaning` tab uses `Cleaning` templates). A template with Segment `Default` is used for any tab without its own.

Extra columns Setup adds: **Allow generic** (tick box) and **First name** (optional). If First name is empty the email says "Hi there,". The first name is never guessed from a plain address like `jsmith@`.

Then fill in **Settings**: Business address, ABN (Australia), and check the sender name. Leave **Dry run ticked**.

Lead columns: Business name, City, Country (New Zealand or Australia), Website, Email, Email type (named/generic), Facebook URL, Instagram URL, Rating, Reviews, Status, Next follow-up date, Step, Last sent, Thread ID, Notes. The script fills in Status, Next follow-up date, Step, Last sent and Thread ID. **Step** is the number of follow-ups already sent (0 to 3).

## 4. Dry run first

1. On a lead tab, select some rows, then **Outreach > Approve selected rows**. Rows that cannot be sent (no email, Australia + generic, no template and so on) are refused with a reason.
2. **Outreach > Preview next batch.** The **Preview** tab shows the exact email, subject and footer for each row, plus every skipped row and why.
3. **Outreach > Send now.** With Dry run on, this only writes `DRYRUN` lines in the **Log** tab. No email is sent and no row changes.
4. **Outreach > Run self-test** runs checks on dummy data only (eligibility rules, templates, footers, opt-out detection). It sends nothing.

Edit the wording any time in the Templates tab. Merge fields: `{{business}}`, `{{city}}`, `{{first_name}}`, `{{sender}}`. If a template uses a field that is empty for a lead, that lead is skipped and the reason shows in Preview. Follow-ups reuse the first email's subject (Gmail adds "Re:"), so the subject cell for steps 2 to 4 is not used.

## 5. Live test to your own address only

1. In Settings, put your own email in **Test recipient** and untick **Dry run**.
2. Approve a row and click **Outreach > Send now**. Every email goes to the test recipient only, subject starts with `[TEST]`, no lead row is changed, and it stops after 3 emails per run.
3. Check the email looks right in your inbox, including the footer. Logged as `TEST` in the Log.
4. If you use a Gmail "Send mail as" alias, put it in **Sender alias email** first and confirm the test arrives from it. It must already be set up in Gmail under Settings > Accounts.

## 6. Go live

1. Clear **Test recipient**. Dry run is still off.
2. Start small: cap of 10 a day. Raise it towards 20 over a few weeks if replies are healthy and nothing bounces.
3. Approve a small batch, Preview, then **Send now** (you get a confirmation box). One run sends roughly 4 to 5 emails because of the 30 to 90 second gaps and the 6 minute Apps Script limit; run again for more.
4. **Outreach > Install daily triggers** for hands-off running: an hourly send run (only inside the send window, up to the cap) and a reply/bounce/opt-out check every 2 hours. Triggers do nothing while Dry run is ticked. **Remove triggers** switches them off.
5. After the first live follow-up, open Gmail Sent and confirm it landed in the same thread addressed to the lead. The script checks the recipient after each follow-up and stops the run if it is wrong.
6. Reply to genuine replies yourself from Gmail. Mark winners as Won by hand.

Every send, dry run, test, error and reply action is in the **Log** tab.

## Good to know

- Status flow: New, Approved (you), Emailed, Followed up, then Replied / Won / Unsubscribed / Bounced. To restart a contact, clear Step, Last sent, Thread ID and Next follow-up date and set Status back to Approved.
- Bounces are detected from mailer-daemon messages in the thread and from separate bounce emails from the last 30 days.
- New Zealand public holidays are not detected. To pause sending (holidays, leave), tick Dry run again or use Remove triggers.
- Compliance: this tool helps you meet the NZ Unsolicited Electronic Messages Act and the Australian Spam Act (sender identity, working opt-out, honouring opt-outs straight away, no generic Australian addresses by default). Targeting relevant business addresses and getting the content right is still your responsibility. This is not legal advice.
- To change the maximum daily cap, edit `MAX_DAILY_CAP` at the top of `Code.gs`.
