# New set source documents — blank templates and how to fill them

[한국어](README.md)

A test set is built from three documents. The three files in this folder are their blank templates.

| Template | Name for a new set (e.g. SET 13) |
| --- | --- |
| `NEW TOEFL SET XX.docx` | `NEW TOEFL SET 13.docx` — question document |
| `SET XX SCRIPT.docx` | `SET 13 SCRIPT.docx` — listening and speaking script |
| `SET XX ANSWER KEY.docx` | `SET 13 ANSWER KEY.docx` — answer key |

**The `[brackets]` highlighted in yellow are the parts to replace.** Delete the brackets and write the
content. Leave every other line as it is — section and module headings, `Questions a-b`, and cue lines
such as `Read a passage.` or `Listen to a talk.` are the markers the importer uses to find questions.

Imported as they are, the templates build 120 questions in strict source mode with no stops
(`tests/test_set_template.mjs` checks this on every deploy). Keep the same layout when you fill them
in and the set will import the same way.

The file name only needs `SET <number>` in it. A name containing `SCRIPT` is the script, a name
containing `ANSWER KEY` (the `ANWER KEY` typo is accepted too) is the answer key, and the remaining
one is the question document (`sg2/tools/source_docs.mjs`). If one folder holds two candidates for
the same set number, the tools stop instead of guessing.

---

## Question counts (same layout as SET 12, 120 in total)

| Section | Module | Blocks |
| --- | --- | --- |
| Reading | Module 1 (35) | Fill-in 1-10 · Fill-in 11-20 · Notice 21-22 · Notice 23-25 · Passage 26-30 · Passage 31-35 |
| | Module 2 (15) | Fill-in 1-10 · Passage 11-15 |
| Listening | Module 1 (32) | Short response 1-12 · Conversations 13-14 · 15-16 · 17-18 · Announcements 19-20 · 21-22 · 23-24 · Talks 25-28 · 29-32 |
| | Module 2 (15) | Short response 1-3 · Conversations 4-5 · 6-7 · Talks 8-11 · 12-15 |
| Writing | 12 | Build a Sentence 1-10 · Email · Academic Discussion |
| Speaking | 11 | Task 1 Listen and Repeat 7 · Task 2 Interview 4 |

You may change the layout (add or remove blocks). But **question numbers inside a module must run
from 1 with no gaps**, and must equal the number of lines for that module in the answer key.

---

## Question document — `NEW TOEFL SET XX.docx`

### General
* Section headings, each on its own line: `READING SECTION` · `LISTENING SECTION` · `WRITING SECTION` · `SPEAKING SECTION`.
* Module headings, each on its own line: `MODULE 1` / `MODULE 2`.
* Block headings, each on its own line: `Questions 21-22` (or `Questions 5` for a single question).
* Multiple choice: `21. Question` followed by `A. choice` … `D. choice` on the next lines. Word's automatic list lettering for A–D also works.
* One blank line between questions.

### Reading — fill in the blanks
```
Questions 1-10
Fill in the blanks.
Honeybees live in large colonies. A 1col_ _ _ can 2con_ _ _ _ tens of thousands 3o_ bees, …
```
* The passage is **one paragraph**. Each blank is `number + the letters shown + one _ per missing letter` (e.g. `1col_ _ _` → colony).
* Numbering restarts at 1 in every passage — the passage under `Questions 11-20` is also numbered 1…10.
* The answer-key word must start with the letters shown (`col` → `colony`). If it does not, a warning appears.

### Reading — passage + multiple choice
```
Questions 26-30
Read a passage.
Passage title
Passage paragraph 1
Passage paragraph 2

26. Question
A. …
```
* The cue line starts with `Read a/an/the …`, e.g. `Read a passage.` / `Read a notice.` / `Read an article.`
* The first line after the cue is the **title**; the lines after it are paragraphs (one line = one paragraph).
* Sentence-insertion questions: mark `(A)` `(B)` `(C)` `(D)` in the passage, write the question as
  `Look at the four letters (A, B, C, and D) …`, and put the sentence to insert on the next line.

### Listening — short response
```
Questions 1-12

Listen to the question and select the best response from the choices.

1.
A. response
B. response
C. response
D. response
```
* The question sentence is not in the question document — it is in the script. The question document has only the `number.` line and the four choices.

### Listening — conversations, announcements, talks
```
Questions 13-14
Listen to a conversation.

13. Question
A. …
```
* Cue lines: `Listen to a conversation.` / `Listen to an announcement.` / `Listen to a talk.`

### Writing
* `Build a sentence` → `Questions 1-10` → `Make an appropriate sentence.`, then **three lines** per question:
  1. Context line — `1. Did you finish the report?`
  2. Blank line — two or more underscores make one blank. Fixed words may be mixed in: `Yes, ______ ______ ______ ______.`
  3. Tile line — separate tiles with **Tab** (or two or more spaces): `I sent it⇥to⇥the manager⇥this morning⇥sending`
  * The tiles must build the answer-key sentence **with nothing left over in the sentence**. Tiles beyond the number of blanks become trap tiles.
  * Without a tile line, strict mode stops the import (tiles are never derived from the answer).
* `WRITE AN EMAIL` → `To: …` → `Subject: …` → `SITUATION` → one situation paragraph → `YOUR EMAIL SHOULD` → one requirement per line.
* `WRITE for an ACADEMIC DISCUSSION` →
  `Professor – Subject` (with a dash, under 70 characters) → the professor's question (**over 80 characters**) →
  student name (short, no period) → that student's post → next student name → post.
  Face pictures do not come from the document; they are attached by name from `config/set<N>-writing-images.json`.

### Speaking
* `Task 1` → `Listen and Repeat` → a picture + `1.` for each sentence (7 in the template).
* `Task 2` → `Answer the interviewer’s questions.` → one picture (shared by all four questions).
* The grey pictures in the template are placeholders. In Word, right-click the picture → **Change Picture**.
* The number of questions comes from **the number of sentences in the script**, not from the pictures.

---

## Script — `SET XX SCRIPT.docx`

```
Listening
Module 1
QUESTIONS 1-12
Where is the guest lecture going to take place?      ← short response: one line per question, in order
…
QUESTIONS 13-14
M: You mentioned you tried that new Thai restaurant…   ← conversation: M: / W: mark the speaker
W: Yeah, we went to the one on Baker Street…
Questions 19-20
Class, one quick thing before we start…                ← announcement / talk: one line = one paragraph
Module 2
…
SPEAKING
Listen and Repeat
You are training to use the student portal. Listen to the officer and repeat what she says.   ← one situation line
Here is how we navigate the student portal.            ← sentences to repeat, one per line
…
INTERVIEW
You have volunteered for a research study … Please answer the interviewer’s questions.       ← one situation line
1. Thank you for joining today. …                      ← questions (the number is dropped from the audio)
```
* Each `QUESTIONS a-b` in the script must **overlap the numbers** of a block in the question document. For short response, number of lines = number of questions.
* If the first line of a block is **under 20 characters and does not end with a period or question mark**, it is read as a heading and dropped from the dialogue.
  End a short first line (`M: Hi.`) with punctuation.
* The audio is generated from this document as written (`sh tools/make_set_audio.sh <N>`) — it is read exactly as typed.

---

## Answer key — `SET XX ANSWER KEY.docx`

```
READING
Module 1
colony          ← fill-in: the whole word
…
A               ← multiple choice: a single letter
…
Module 2
…
LISTENING
Module 1
…
WRITING
Yes, I sent it to the manager this morning.   ← Build a Sentence answers, from question 1
```
* **Do not write numbers — line order is the question number.** If one line is missing, every answer after it shifts by one
  (so a module whose line count differs from its question count cannot be saved).
* Blank lines are not counted. Section headings are `READING` · `LISTENING` · `WRITING`.

---

## After filling them in

1. Put the three files in the repository root (`smeag-TOFEL 자료/`) or in `kenneth-brain/smeag-TOFEL 자료/`.
2. Upload the three files on `admin-set-import.html`; the check lines appear immediately — any `stop` locks the Save button.
   **Fix the document the message points to and upload again** (never edit the pack by hand).
3. From there, follow the five gates in `docs/set-build.md` (audio, answer cross-check, save verification, completeness).

To change the templates, do not edit the docx files by hand. Edit `tools/make_set_template.mjs` and rebuild with
`node studyground/tools/make_set_template.mjs`.
