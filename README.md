# MATH BATTLE ARENA

🔵 **BLUE TEAM – NUMBER NINJAS** vs 🟢 **GREEN TEAM – MATH TITANS**

A live multiplayer math game for Grade 5 (Lesson 3-8: Solve Word Problems Using Multiplication).

| Page | Who uses it | Address after deployment |
|---|---|---|
| Student game | Students (the **only** link you share) | `https://USERNAME.github.io/math-battle-arena/` |
| Teacher dashboard | You (password protected) | `https://USERNAME.github.io/math-battle-arena/teacher.html` |
| Arena display | Shared screen in class or online | `https://USERNAME.github.io/math-battle-arena/arena.html` |

**How it works:** the website is hosted free on GitHub Pages. It talks to a Google Apps Script web app, which saves everything in your Google Sheet. Students never see Google, never sign in, and never open an Apps Script link.

---

## STEP 1: Create the database and backend (Google)  ⏱ about 10 minutes

> ⚠️ **Important for school accounts (e.g. @education.sch.sa).**
> Students without Google accounts can only reach the backend if it is deployed with access set to **"Anyone"**.
> Many school Google Workspace accounts hide that option. They only offer "Anyone within [school]".
> If you don't see **"Anyone"** in step 1.6, do STEP 1 with a **personal Gmail account** instead.
> Only your copy of the Sheet lives there. Students still never sign in.

1. Go to **https://sheets.new**. A new blank Google Sheet opens. Rename it **Math Battle Arena DB**.
2. In the menu choose **Extensions → Apps Script**.
3. Delete everything in the editor. Open `backend/Code.gs` from this project, copy **all** of it, and paste it in. Press **💾 Save**.
4. At the top, pick the function **`setup`** in the dropdown next to "Debug", then press **▶ Run**.
   - Google asks for permission: **Review permissions** → choose your account → **Advanced** → **Go to Untitled project (unsafe)** → **Allow**.
     (It says "unsafe" only because you wrote the script yourself and Google hasn't reviewed it.)
   - The log shows *Execution completed*. Back in your Sheet you will now see the tabs
     **Students, Teams, Rooms, Players, Questions, Submissions, Scores, GameSettings**. The 6 questions are already in **Questions**.
5. Click **Deploy → New deployment**. Click the ⚙️ gear next to "Select type" and choose **Web app**.
6. Fill in:
   - Description: `Math Battle Arena`
   - Execute as: **Me**
   - Who has access: **Anyone**   ← must be exactly "Anyone"
7. Press **Deploy**, then copy the **Web app URL**. It looks like
   `https://script.google.com/macros/s/AKfy…long…/exec`
8. **Check it:** paste that URL into a **private/incognito** browser window. You should see something like
   `{"ok":true,"service":"Math Battle Arena",...}`.
   If you see a Google sign-in page instead, the access is not "Anyone" (see the warning above).

**Teacher password:** it is `Aa1234`, stored on the Google side in **Project Settings (⚙️) → Script Properties → `TEACHER_PASSWORD`**.
You can change it there at any time. It is never in the website code.

**If you change Code.gs later:** **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The URL stays the same.

---

## STEP 2: Put the website on GitHub Pages  ⏱ about 10 minutes

1. Go to **https://github.com** and sign up or log in. Your username will appear in the final link.
2. Click **+ (top right) → New repository**.
   - Repository name: **`math-battle-arena`**
   - Select **Public**
   - Press **Create repository**.
3. On the new empty repository page, click **"uploading an existing file"**.
4. Unzip `math-battle-arena.zip`. Open the unzipped folder, select **everything inside it**
   (`index.html`, `teacher.html`, `arena.html`, the `assets` folder, and the other files) and drag it into the GitHub page.
   Wait for the upload to finish, then press **Commit changes**.
   (Make sure `index.html` sits at the top level of the repository, not inside another folder.)
5. Connect the website to your backend: in the repository open **assets → js → config.js**, click the ✏️ pencil (Edit), and replace
   `PASTE_YOUR_API_URL_HERE` with your Web app URL from step 1.7. Keep the quotes:
   ```js
   API_URL: "https://script.google.com/macros/s/AKfy…/exec"
   ```
   Press **Commit changes**.
6. Turn on hosting: **Settings → Pages** (left menu). Under **Build and deployment → Source** choose **Deploy from a branch**.
   Branch: **main**, folder: **/ (root)**. Press **Save**.
7. Wait 1–2 minutes and refresh the Pages settings page. It shows
   **"Your site is live at https://USERNAME.github.io/math-battle-arena/"**. That is your student link.

---

## STEP 3: Get ready for class

1. Open `https://USERNAME.github.io/math-battle-arena/teacher.html` and log in with your password.
2. **👥 Students tab:** type a **Class name** (e.g. `Class 1`), then upload that class's Excel or CSV file. Column 1 = full name, column 2 = team (`Blue`/`Green`, or `أزرق`/`أخضر`).
   Repeat for each class. Every class keeps its own list, and the dropdown above the student list filters by class.
   The team column is optional: you can choose teams from the dropdowns, or press **Auto-assign** to split students evenly.
   Duplicate names are skipped automatically. See `sample-students.csv` for an example.
3. **🎮 Game tab:** under **Which class is playing?** choose the class, then press **Create new room**. You get a 5-letter code.
   Only that class's names appear when students search, and only they can join.
4. Press **📋 Copy room link** and send it to the students. The code is already filled in, so they only type the first letters of their first name.
5. Open **📺 Arena screen** and share that browser tab in Zoom, Teams or Meet, or show it on the classroom projector.
6. When everyone has joined, press **▶ Start game**.

### During the game
- Each question gives students 60 seconds. The whole game lasts 7 minutes. Press **Next ▶** to move on. Pause, Resume and Next are always at the top of the dashboard.
- **✅ Answer review tab:** each answer shows the student, team, chosen answer and seconds taken. Press **✓ Correct** or **✗ Incorrect** for each one,
  or use the button that marks every pending answer using the answer key. **↺ Undo** puts an answer back to pending. **Set** gives custom points.
- Points are given only when you confirm an answer:

  | Time | 0–10 s | 11–20 s | 21–30 s | 31–45 s | 46–60 s | Incorrect |
  |---|---|---|---|---|---|---|
  | Points | 100 | 80 | 60 | 40 | 20 | 0 |

- Team totals update on every phone and on the arena screen within about 2–3 seconds.
- **🏁 End game** shows the winning team celebration. **↺ Reset game** clears the answers so you can play again in the same room.

### Common situations
| Situation | What to do |
|---|---|
| A student's name says "already joined" | They joined on another device. In the **Students** tab press **Release** next to their name, then they can join again. |
| A student refreshed or closed the page | Nothing is lost. They open the same link and are put straight back into the game. |
| "Your teacher has not given you a team yet" | Choose a team for that student in the Students tab. |
| A student can't find their name | Check the spelling in the Students tab, or add them with **Add one student**. |
| Phones show "Reconnecting…" | The internet connection dropped. The page retries on its own. |

---

## Optional: Cloudflare Worker proxy

You do **not** need this for the game to work: GitHub Pages talks to Apps Script directly. Use it if you want to:
- hide the Google Apps Script URL from the website code, or
- run large classes (40+ students), because the Worker caches the shared game state for 1 second and takes load off Google.

1. Create a free account at **https://dash.cloudflare.com** → **Workers & Pages → Create → Create Worker** → name it `math-battle-api` → **Deploy**.
2. Click **Edit code**, replace everything with `worker/worker.js` from this project, and press **Deploy**.
3. Go to the Worker's **Settings → Variables and Secrets → Add**: name `APPS_SCRIPT_URL`, value = your `/exec` URL → **Deploy**.
4. Put the Worker address (`https://math-battle-api.YOURNAME.workers.dev`) into `assets/js/config.js` instead of the Google URL.

---

## Technical notes

- **CORS / redirects:** Apps Script answers every request with a 302 redirect to `script.googleusercontent.com`, and it cannot answer CORS "preflight" (OPTIONS) requests.
  The website therefore uses only simple requests: `GET` for polling, and `POST` with `Content-Type: text/plain` for actions. These never trigger a preflight.
  The browser follows the redirect, and the final response allows any origin. The local test server reproduces this 302 behaviour.
- **Security:** the teacher password is checked only in Apps Script (Script Properties). Login returns a random session token that expires after 6 hours,
  and every teacher action is rejected without a valid token. Students cannot read the answer key: it is never sent to student or arena screens.
  The Apps Script URL in `config.js` is a public address, not a credential. Use the Worker if you prefer to hide it.
- **Fairness:** answer time is measured on the server from when the question started, and pauses are excluded. A script lock stops any student from submitting twice.
  Each student is tied to one device ID, so one device can't join as several names. Reviewing sets the points rather than adding them, so they can never be counted twice.
- **Real-time:** students poll every 2.5 s, the arena every 1.5 s and the dashboard every 2 s, with random jitter and back-off. Timers count down smoothly between polls.
  The public game state is cached in Apps Script `CacheService`, so most polls never touch the Sheet.

## Running the tests locally (optional, for developers)

Requires Node.js 18+ and Playwright.
```bash
node tests/backend.test.js      # 26 rule tests against backend/Code.gs
node tests/server.js &          # fake Apps Script (with 302 redirects) on :8787 + website on :8080
node tests/e2e.js               # 31 browser checks: teacher + arena + 4 students
```
