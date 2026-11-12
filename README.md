# No spare change? Here's how you can help.

A one-page volunteer finder for New Yorkers who want to help homeless neighbors with time, items or skills. The page lists organizations, what each one needs this month, when that was last checked, and a button to the organization's own sign-up page. It collects nothing: no forms, no accounts, no cookies.

This guide gets the site online and shows you how to keep it up to date. You don't need to install anything or use a command line.

**What's in this folder**

| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The page, its look, and its behavior |
| `config.js` | Your settings: sheet link, contact email, and so on |
| `data/orgs.csv` | The starting list, for importing into Google Sheets |
| `data/seed.js` | A saved copy of the list, used if the Google Sheet can't be reached |
| `data/nyc-zips.js` | NYC ZIP code centers, from the Census Bureau, for "Near me" |

To look at the site before it's online, double-click `index.html`. The list works; the map background may stay gray until the site is on the web.

---

## 1. Put the list in a Google Sheet

1. In your browser, go to **sheets.new**. A blank spreadsheet opens.
2. Click **File > Import**. Click the **Upload** tab, then drag in `orgs.csv` from the `data` folder.
3. In the **Import file** box:
   - **Import location**: choose **Replace spreadsheet**.
   - **Separator type**: leave on **Detect automatically**.
   - **Untick** "Convert text to numbers, dates, and formulas". This matters: it stops Google from rewriting the dates.
   - Click **Import data**.
4. Click the title at the top left and give the spreadsheet a name, such as `Volunteer finder`.
5. Look at the tab at the bottom of the screen. It must be named **orgs**. If it isn't, double-click it, type `orgs`, and press Enter.
6. Keep the dates as plain text. Click the letter **S** above the `last_checked` column, then click **Format > Number > Plain text**.
7. Add a dropdown for `category`:
   1. Click the letter **I** above the `category` column.
   2. Click **Data > Data validation**, then **Add rule**.
   3. In **Apply to range**, change the text to `orgs!I2:I1000` (so the header in row 1 is left alone).
   4. Under **Criteria**, choose **Dropdown**. Type these six options, one per box, using **Add another item**: `meals`, `pantry`, `shelter-services`, `community-center`, `outreach`, `other`.
   5. Click **Advanced options** and choose **Reject the input**. Click **Done**.
8. Add a dropdown for `status` the same way: click the letter **T**, use the range `orgs!T2:T1000`, and the options `confirmed`, `unverified`, `hidden`.
9. Optional but handy: click **View > Freeze > 1 row** so the headers stay visible.

**Do not rename, reword or re-capitalize the headers in row 1.** The site finds each column by its header. You may reorder columns or add columns of your own (for example, private notes), and the site will ignore the extras. Remember that anything in this tab is public once you publish it in step 2.

## 2. Publish the orgs tab and copy its link

1. In the sheet, click **File > Share > Publish to web**.
2. On the **Link** tab, click the first dropdown (it says **Entire Document**) and choose **orgs**.
3. Click the second dropdown (it says **Web page**) and choose **Comma-separated values (.csv)**.
4. Click **Publish**, then **OK**.
5. Copy the link that appears. It starts with `https://docs.google.com/spreadsheets/d/e/` and ends with `output=csv`. Keep it somewhere; you'll paste it into `config.js` in step 3.
6. Click **Published content and settings** and check that **Automatically republish when changes are made** is ticked.

From now on, changes you make in the sheet reach the site by themselves, usually within about five minutes.

## 3. Put the site online with GitHub Pages

**A. Make an account and a repository**

1. Go to **github.com** and click **Sign up**. Follow the steps.
2. Once signed in, click the **+** at the top right, then **New repository**.
3. **Repository name**: type a short name with no spaces, such as `no-spare-change`. This becomes part of the site's address.
4. Choose **Public**. (Free GitHub Pages sites need a public repository.)
5. Leave everything else as it is and click **Create repository**.

**B. Upload the files**

1. On the new repository's page, click the link **uploading an existing file**.
2. On your computer, unzip the .zip file and open the folder.
3. Select everything inside it (`index.html`, `styles.css`, `app.js`, `config.js`, `README.md` and the `data` folder) and drag it all onto the GitHub page. Dragging keeps the `data` folder as a folder.
4. Wait for the files to finish loading, then click **Commit changes**.
5. Check: the repository should now show `index.html` in its top-level list, not tucked inside another folder.

**C. Paste in your sheet link and contact email**

1. In the repository, click **config.js**, then the pencil icon (**Edit this file**).
2. On the `SHEET_CSV_URL` line, paste your link from step 2 between the two quote marks.
3. On the `CONTACT_EMAIL` line, type an email address between the quote marks. Everyone can see this address, so use one made for this project, not your personal one. If you leave it blank, that footer line is hidden.
4. Keep every quote mark and the comma at the end of each line.
5. Click **Commit changes...**, then **Commit changes**.

**D. Turn on GitHub Pages**

1. Click the **Settings** tab of the repository.
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Under **Branch**, choose **main**, leave the folder on **/ (root)**, and click **Save**.
5. Wait a minute or two and refresh the page. A box at the top says **Your site is live at** followed by the address. It looks like `https://YOUR-USERNAME.github.io/no-spare-change/`.

Open that address on your phone. You should see the list without the note "Showing a saved copy of the list." If that note is there, see "If something breaks" below.

## 4. Check the live site

Run these on the live address. For the tests that need unusual data, add a temporary row to the sheet, wait five minutes, check, and then delete the row.

1. **Saved copy.** Skipped on the live site, because your sheet link is now set. (To try it, double-click `index.html` in the folder on your computer: five organizations and the note "Showing a saved copy of the list.")
2. **Nothing invented.** Every card shows only what is in your sheet. Rows with no needs say "Not yet confirmed."
3. **Freshness.** Add a row with `last_checked` 50 days ago: it shows "May be out of date." Change it to 70 days ago: it disappears. Set any row's status to `hidden`: it disappears.
4. **No pin.** Add a row with blank `lat` and `lng`: it's in the list, with no pin and no "Show on map".
5. **Odd text.** Put `<script>alert(1)</script>` in a needs field: it shows as plain text and nothing pops up. Put `javascript:alert(1)` in `signup_url`: that card has no sign-up button.
6. **ZIP.** Type `10001` and press **Go**: Holy Apostles comes first. Type `90210`, then `abc`: both say "Enter a 5-digit NYC ZIP code."
7. **Location denied.** Press **Use my location** and choose **Block** or **Don't allow**: a friendly note appears and the rest still works.
8. **Keyboard.** On a computer, press Tab again and again. You should reach every button, box and link, always with a visible outline, and Enter or Space should work each one.
9. **Small screens.** On a small phone, nothing scrolls sideways, and "See someone who needs help right now?" is visible without scrolling.
10. **Network and cookies.** In Chrome on a computer: **View > Developer > Developer Tools**, then the **Network** tab, then reload. The requests should go only to your site, `cdnjs.cloudflare.com`, `tile.openstreetmap.org`, Google (the sheet) and, if you set a token, Cloudflare. Then open the **Application** tab and click **Cookies**: there should be none for your site.
11. **Map blocked.** Turn on airplane mode after the page has loaded once, or use an ad blocker that blocks the map: the list still works.
12. **Accessibility score.** In Developer Tools, open the **Lighthouse** tab, tick only **Accessibility**, and click **Analyze page load**. The score should be 95 or higher.

## 5. Optional, later

**Visitor counts with Cloudflare Web Analytics** (no cookies)

1. Sign up at **dash.cloudflare.com**.
2. In the left sidebar, click **Analytics & Logs > Web Analytics**, then **Add a site**.
3. Enter your site's address and follow the steps until Cloudflare shows a snippet of code.
4. In that snippet, find `"token": "` followed by a long string of letters and numbers. Copy only that string.
5. Edit `config.js` on GitHub (as in step 3C) and paste the string between the quote marks on the `CF_ANALYTICS_TOKEN` line.

**Your own web address**

1. Buy a domain name from any registrar.
2. In the repository: **Settings > Pages > Custom domain**. Type the domain and click **Save**.
3. GitHub shows the DNS records to add at your registrar. Add them, wait for the check to pass, then tick **Enforce HTTPS**.

**A different map background**

`config.js` holds the map's address (`TILE_URL`) and its credit line (`TILE_ATTRIBUTION`). If the site becomes busy, OpenStreetMap asks heavy users to move to another provider. Change both lines together, because each provider has its own required credit.

## 6. The monthly routine

Once a month, for each organization:

1. Check with the organization, or re-read its volunteer page.
2. Update `needs_items`, `needs_shifts` and `needs_skills`. Leave a box blank if nothing is confirmed. Never guess.
3. Set `last_checked` to today, typed as `YYYY-MM-DD` (for example `2026-12-01`).
4. Set `status`:
   - `confirmed`: the organization itself confirmed the details.
   - `unverified`: you took the details from its website.
   - `hidden`: take the listing down for now.

Then refresh the saved copy, so the backup doesn't go stale:

1. In the sheet, click **File > Download > Comma-separated values (.csv)**.
2. Open the downloaded file in a plain text editor (Notepad on Windows, TextEdit on Mac) and copy all of it.
3. On GitHub, open `data/seed.js`, click the pencil icon, and replace everything between the two backtick marks (`` ` ``) with what you copied. Click **Commit changes**.

If you skip this, the saved copy empties itself 60 days after its dates, and a visitor whose phone can't reach Google sees "No current listings. Check back soon."

**When you add a row**

- `id`: a short unique name, lowercase with hyphens.
- `signup_url` and `source_url` must start with `https://` or `mailto:`. Anything else is left off the card.
- `lat` and `lng`: in Google Maps, right-click the building and click the two numbers at the top of the menu to copy them. The first is `lat`, the second is `lng`. If you're unsure, leave both blank; the row is listed without a pin.
- Only ever enter an organization's public address. Never enter the location of a shelter that keeps its address private, a domestic violence program, an encampment, or a person.

**What the labels on the site mean**

| Label | Meaning |
| --- | --- |
| Confirmed with the organization on [date] | Status is `confirmed`. |
| From their website, [date] · Not yet confirmed | Status is `unverified`. |
| Not yet confirmed (under "This month") | All three needs boxes are blank. |
| May be out of date | More than 45 days since `last_checked`. |
| (listing not shown) | More than 60 days since `last_checked`, or status is `hidden`. |
| Showing a saved copy of the list. | The site couldn't read your Google Sheet and is using `data/seed.js`. |

The 45 and 60 are `STALE_DAYS` and `HIDE_DAYS` in `config.js`.

---

## If something breaks

| What you see on the site | Likely cause | Fix |
| --- | --- | --- |
| "Showing a saved copy of the list." and your recent changes are missing | The sheet isn't published, or the link in `config.js` is wrong | Redo step 2, and paste the link again in step 3C. The link must end in `output=csv`. |
| Same note, and the link looks right | The wrong tab was published, so the site can't find the headers | In **File > Share > Publish to web**, choose **orgs**, not **Entire Document** or another tab. |
| Same note, right after you edited row 1 | The `name`, `last_checked` or `status` header was renamed | Change the header back to exactly that spelling, in lowercase. |
| One kind of detail is missing from every card (no needs, no sign-up buttons, or no pins) | A different header was renamed, for example `needs_items`, `signup_url`, or `lat` | Change the header back. The exact headers are listed in row 1 of `data/orgs.csv`. |
| One organization has disappeared | Its date is mistyped (for example `2026-1-5` or `Dec 1`), is more than 60 days old, or is in the future; or its status is misspelled; or its name is blank | Fix the `last_checked` box (`YYYY-MM-DD`) or the `status` box. |
| Every organization has disappeared: "No current listings. Check back soon." | Google reformatted the date column (dates look like `11/10/2026`), or every date is more than 60 days old | Click the letter above `last_checked`, then **Format > Number > Plain text**, and retype the dates as `YYYY-MM-DD`. |
| A card has no sign-up button or no "Source" link | The link doesn't start with `https://` or `mailto:` | Fix the link in the sheet. |
| An organization is listed but has no pin | `lat` or `lng` is blank or isn't a number | Add both numbers, or leave it; the listing still works. |
| "The map couldn't load. Every organization is in the list." | The visitor is offline, or something is blocking the map library | Nothing to fix; the list is complete without the map. |
| The map is gray but the pins show | The map background was refused. This is normal when you open `index.html` straight from your computer | Check the live site instead. |
| A valid ZIP code says "Enter a 5-digit NYC ZIP code." | A few ZIPs are only PO boxes or single buildings and aren't in the Census file | Try a neighboring ZIP. |
| You changed the sheet and the site hasn't changed | Google takes up to about five minutes to republish | Wait, then reload the page. |
| The footer email, or your settings, stopped working after you edited `config.js` | A quote mark or comma was deleted | Compare each line with the original: `NAME: "value",` |
| The saved copy shows nothing after you edited `data/seed.js` | A backtick mark was deleted, or the pasted text contains one | Make sure the list sits between exactly two backticks. |
