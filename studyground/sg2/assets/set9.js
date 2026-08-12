/* =============================================================
 * SMEAG TOEFL — NEW TOEFL SET 9 문제 데이터
 * 원본: NEW TOEFL MOCK TEST SET  9.docx
 *       SET 9 SCRIPT.docx
 *       SET 9 ANSWER KEY.docx
 * 생성: tools/build_set9.py  ← 손으로 고치지 말고 이 스크립트를 고쳐서 재생성할 것.
 * 검산: tests/test_compile_set9.js
 *
 * ES module 아님 — <script src> 로 로드되어 window.SMEAG_SET9 를 정의한다.
 * 화살표함수/const/let/템플릿리터럴 없음(빌드 없는 ES5).
 * ============================================================= */
(function () {
  'use strict';

  var reading = {
  "id": "reading",
  "label": "Reading",
  "labelKo": "리딩",
  "timeLimitSec": 2100,
  "modules": [
    {
      "id": "R1",
      "label": "Reading Module 1",
      "blocks": [
        {
          "kind": "cloze",
          "heading": "Questions 1-10",
          "instruction": "Fill in the blank.",
          "template": "Immigration has reshaped communities around the world throughout modern history. Immigrant {{1}} have {{2}} {{3}} {{4}} {{5}} {{6}} challenges {{7}} require balancing new {{8}} realities {{9}} preserving cultural {{10}}. These adjustments often span multiple generations before full integration occurs. Researchers continue studying how such processes unfold across different regions.",
          "questions": [
            {
              "id": "R1-1",
              "kind": "blank",
              "no": 1,
              "hint": "popul",
              "answer": "populations"
            },
            {
              "id": "R1-2",
              "kind": "blank",
              "no": 2,
              "hint": "exper",
              "answer": "experienced"
            },
            {
              "id": "R1-3",
              "kind": "blank",
              "no": 3,
              "hint": "com",
              "answer": "complex"
            },
            {
              "id": "R1-4",
              "kind": "blank",
              "no": 4,
              "hint": "soc",
              "answer": "social"
            },
            {
              "id": "R1-5",
              "kind": "blank",
              "no": 5,
              "hint": "a",
              "answer": "and"
            },
            {
              "id": "R1-6",
              "kind": "blank",
              "no": 6,
              "hint": "econ",
              "answer": "economic"
            },
            {
              "id": "R1-7",
              "kind": "blank",
              "no": 7,
              "hint": "th",
              "answer": "that",
              "answerKeyRaw": "correct"
            },
            {
              "id": "R1-8",
              "kind": "blank",
              "no": 8,
              "hint": "poli",
              "answer": "political"
            },
            {
              "id": "R1-9",
              "kind": "blank",
              "no": 9,
              "hint": "wi",
              "answer": "with"
            },
            {
              "id": "R1-10",
              "kind": "blank",
              "no": 10,
              "hint": "tradi",
              "answer": "traditions"
            }
          ]
        },
        {
          "kind": "cloze",
          "heading": "Questions 11-20",
          "instruction": "Fill in the blank.",
          "template": "Lions are social animals that live in groups called prides on African grasslands. A {{11}} lion typically {{12}} a {{13}} {{14}} {{15}} many miles {{16}} {{17}} patrols its boundaries. {{18}} dominant cat must {{19}} for intruders across hundreds of {{20}} kilometers to protect his pride. These patrols help ensure that rival males do not challenge his position or threaten the cubs. Successful territorial defense is essential for a male lion’s reproductive success.",
          "questions": [
            {
              "id": "R1-11",
              "kind": "blank",
              "no": 11,
              "hint": "ma",
              "answer": "male"
            },
            {
              "id": "R1-12",
              "kind": "blank",
              "no": 12,
              "hint": "estab",
              "answer": "establishes"
            },
            {
              "id": "R1-13",
              "kind": "blank",
              "no": 13,
              "hint": "la",
              "answer": "large"
            },
            {
              "id": "R1-14",
              "kind": "blank",
              "no": 14,
              "hint": "terr",
              "answer": "territory"
            },
            {
              "id": "R1-15",
              "kind": "blank",
              "no": 15,
              "hint": "span",
              "answer": "spanning"
            },
            {
              "id": "R1-16",
              "kind": "blank",
              "no": 16,
              "hint": "a",
              "answer": "and"
            },
            {
              "id": "R1-17",
              "kind": "blank",
              "no": 17,
              "hint": "regu",
              "answer": "regularly"
            },
            {
              "id": "R1-18",
              "kind": "blank",
              "no": 18,
              "hint": "T",
              "answer": "The"
            },
            {
              "id": "R1-19",
              "kind": "blank",
              "no": 19,
              "hint": "lo",
              "answer": "look"
            },
            {
              "id": "R1-20",
              "kind": "blank",
              "no": 20,
              "hint": "squ",
              "answer": "square"
            }
          ]
        },
        {
          "kind": "passage",
          "heading": "Questions 21-22",
          "instruction": "Read a webpage.",
          "title": "Westbrook University Morrison Library – Hours & Services",
          "paragraphs": [
            "www.westbrook.edu/library/hours",
            "The Morrison Library is the main research facility on campus, housing over 2 million print volumes and providing access to 300+ online databases.",
            "House of Operation:",
            "Monday-Thursday: 7 A.M. – 11 P.M.",
            "Friday: 7 A.M. – 6 P.M.",
            "Saturday-Sunday: 10 A.M. – 5 P.M.",
            "Extended Hours During Finals: The library remains open 24 hours from the last week of classes through the final examination period. All students must present a valid university ID to enter after 9 P.M. Visitors may use reading rooms during regular daytime hours but cannot borrow materials."
          ],
          "questions": [
            {
              "id": "R1-21",
              "kind": "mcq",
              "no": 21,
              "prompt": "When does the library close on Fridays?",
              "choices": [
                "At 7 A.M.",
                "At 6 P.M.",
                "At 9 P.M.",
                "At 11 P.M."
              ],
              "answer": 1
            },
            {
              "id": "R1-22",
              "kind": "mcq",
              "no": 22,
              "prompt": "What are visitors allowed to do at the library?",
              "choices": [
                "Borrow books for up to one week",
                "Access online databases remotely",
                "Use reading rooms during the day",
                "Enter the building after 9 P.M."
              ],
              "answer": 2
            }
          ]
        },
        {
          "kind": "passage",
          "heading": "Questions 23-24",
          "instruction": "Read an email.",
          "title": "Subject: Resume Review Request – Career Fair Candidates",
          "paragraphs": [
            "To: Team",
            "From: Daniel Reyes, Team Leader",
            "Dear Team,",
            "I attended the Greenfield University career fair on Monday and collected 12 resumes from promising candidates. Please review the attached files and submit your feedback through the evaluation portal by Friday at 5:00 P.M. Your assessments will help us select applicants for first-round interviews next Wednesday.",
            "Best regards,",
            "Daniel Reyes",
            "Team Leader"
          ],
          "questions": [
            {
              "id": "R1-23",
              "kind": "mcq",
              "no": 23,
              "prompt": "What does Mr. Reyes require his team members to do?",
              "choices": [
                "Attend a university career fair",
                "Schedule interviews with applicants",
                "Evaluate candidate materials",
                "Update the hiring portal"
              ],
              "answer": 2
            },
            {
              "id": "R1-24",
              "kind": "mcq",
              "no": 24,
              "prompt": "When will the first-round interviews be held?",
              "choices": [
                "On Monday",
                "On Wednesday",
                "On Friday",
                "On Saturday"
              ],
              "answer": 1
            }
          ]
        },
        {
          "kind": "passage",
          "heading": "Questions 25-27",
          "instruction": "Read a notice.",
          "title": "Data Science Program – Fall Course Guide",
          "paragraphs": [
            "The Center for Data Analytics is pleased to offer a range of courses for the upcoming fall semester. Please review the following information to determine which class best suits your background and goals.",
            "Beginner Level",
            "Prerequisites: None",
            "This course provides an introduction to core data science concepts, including data collection, basic analysis, and interpretation. Classes A, B, and C cover identical content but are offered at different times and formats to accommodate various schedules.",
            "Class | Schedule | Time | Format",
            "Class A | Mon/Wed | 10:00 A.M. | In-person only",
            "Class B | Tue/Thu | 2:00 P.M. | Online only",
            "Class C | Wed/Fri | 4:00 P.M. | In-person only",
            "Intermediate Level",
            "Prerequisites: Basic statistics or prior data science coursework",
            "This course covers machine learning fundamentals, predictive modeling, and algorithm design. Students will gain hands-on experience with industry-standard tools and techniques.",
            "Class | Schedule | Time",
            "Class D | Mon/Wed | 1:00 P.M.",
            "Class E | Tue/Thu | 10:00 A.M.",
            "Advanced Level",
            "Prerequisites: Completion of Class D or E",
            "This research seminar is designed for students conducting independent projects. It is required for all thesis candidates in the data science program.",
            "Class F: Friday, 9:00 A.M.",
            "Special Course",
            "Prerequisites: None",
            "This course focuses on creating compelling infographics and presenting data findings to diverse audiences. Students will learn effective techniques for communicating complex information visually.",
            "Class G: Thursday, 6:00 P.M.",
            "Registration opens September 1st. For questions, contact datascience@westfield.edu."
          ],
          "questions": [
            {
              "id": "R1-25",
              "kind": "mcq",
              "no": 25,
              "prompt": "Michael has no data science background, is unavailable on Mondays and Thursdays, and does not have reliable internet access at home. Which class would be most appropriate for him?",
              "choices": [
                "Class A",
                "Class B",
                "Class C",
                "Class D"
              ],
              "answer": 2
            },
            {
              "id": "R1-26",
              "kind": "mcq",
              "no": 26,
              "prompt": "Alex has completed an introductory statistics course along with some intermediate data science courses. He intends to write a thesis. Which class should Alex take?",
              "choices": [
                "Class C",
                "Class D",
                "Class F",
                "Class G"
              ],
              "answer": 2
            },
            {
              "id": "R1-27",
              "kind": "mcq",
              "no": 27,
              "prompt": "Who is most likely to be interested in class G?",
              "choices": [
                "A marketing manager who presents reports to clients",
                "A software developer interested in machine learning",
                "A doctoral candidate preparing a research project",
                "A high school teacher new to data science"
              ],
              "answer": 0
            }
          ]
        },
        {
          "kind": "passage",
          "heading": "Questions 28-30",
          "instruction": "Read a notice.",
          "title": "Greenwood University Literature Club – Fall Semester Recruitment",
          "paragraphs": [
            "The Greenwood University Literature Club is now accepting applications for new members for the fall semester. We welcome students from all majors who share a passion for reading and discussing literary works.",
            "About the Club",
            "The Literature Club was founded in 2015 and currently has over 60 active members.",
            "We meet every Tuesday evening from 6:00 P.M. to 8:00 P.M. in Humanities Hall, Room 204.",
            "Each month, members vote on a book to read and discuss together.",
            "Past selections have included classic novels, contemporary fiction, and poetry collections.",
            "Membership Benefits",
            "Members receive priority registration for guest author lectures and literary workshops hosted by the English Department.",
            "Additionally, members are eligible to submit their own creative writing to the club's annual publication, The Greenwood Review.",
            "How to Join",
            "Interested students should complete an application form available at the Student Activities Office or online at greenwood.edu/litclub.",
            "Applications must be submitted by Friday, September 15th.",
            "There is no membership fee for the fall semester.",
            "For questions, contact the club president, Rachel Kim, at litclub@greenwood.edu."
          ],
          "questions": [
            {
              "id": "R1-28",
              "kind": "mcq",
              "no": 28,
              "prompt": "What is the main topic of the notice?",
              "choices": [
                "An announcement of upcoming guest author lectures",
                "A call for submissions to a literary publication",
                "An invitation to join a student organization",
                "A schedule change for club meetings"
              ],
              "answer": 2
            },
            {
              "id": "R1-29",
              "kind": "mcq",
              "no": 29,
              "prompt": "According to the notice, what is one benefit of joining the club?",
              "choices": [
                "Free access to all English Department courses",
                "Early registration for certain campus events",
                "A discount on books selected for discussion",
                "Automatic publication of creative writing submissions"
              ],
              "answer": 1
            },
            {
              "id": "R1-30",
              "kind": "mcq",
              "no": 30,
              "prompt": "What is indicated about the membership fee?",
              "choices": [
                "It varies depending on the student’s major.",
                "It will increase starting next semester.",
                "It is waived for first-time applicants.",
                "It is not required for the current term."
              ],
              "answer": 3
            }
          ]
        },
        {
          "kind": "passage",
          "heading": "Questions 31-35",
          "instruction": "Read a passage.",
          "title": "Augmented Reality in Employee Training",
          "paragraphs": [
            "Augmented reality technology is revolutionizing how companies train employees for complex and potentially hazardous tasks. By overlaying digital information onto the physical environment, AR systems enable workers to practice dangerous procedures without real-world risks. This approach proves especially valuable in industries where mistakes can result in serious injury or equipment damage.",
            "AR training environments allow learners to repeat difficult tasks as many times as needed while receiving immediate feedback on their performance. Studies have shown that this iterative practice significantly improves both learning speed and long-term retention. Medical students who practiced surgical techniques through AR simulations, for instance, demonstrated proficiency scores thirty percent higher than peers trained with traditional methods. At automotive plants, workers reduced assembly errors by nearly half after completing AR-guided modules, suggesting that virtual practice translates effectively to actual job performance.",
            "However, widespread adoption of AR training faces significant obstacles. The initial investment for hardware, specialized software, and system maintenance remains prohibitively expensive for many small and medium-sized businesses. Organizations also struggle to find personnel qualified to design effective AR curricula. Despite these challenges, costs continue to decline as the technology matures, and growing demand is expanding the pool of skilled developers."
          ],
          "questions": [
            {
              "id": "R1-31",
              "kind": "mcq",
              "no": 31,
              "prompt": "The word “revolutionizing” in paragraph 1 is closest in meaning to",
              "choices": [
                "challenging",
                "opposing",
                "analyzing",
                "transforming"
              ],
              "answer": 3
            },
            {
              "id": "R1-32",
              "kind": "mcq",
              "no": 32,
              "prompt": "The passage states that medical students who used AR simulations",
              "choices": [
                "completed their training in half the time required by traditional programs",
                "achieved significantly higher scores on proficiency assessments",
                "expressed a strong preference for virtual learning environments",
                "were permitted to perform procedures without direct supervisions"
              ],
              "answer": 1
            },
            {
              "id": "R1-33",
              "kind": "mcq",
              "no": 33,
              "prompt": "What can be inferred from the passage about the relationship between AR training and workplace tasks?",
              "choices": [
                "Competencies acquired through virtual practice can apply to real work situations",
                "AR training benefits only those in medical professions",
                "Conventional instructional approaches have become obsolete",
                "Factory employees need more extensive AR instruction than healthcare workers"
              ],
              "answer": 0
            },
            {
              "id": "R1-34",
              "kind": "mcq",
              "no": 34,
              "prompt": "Why does the author mention studies about AR training?",
              "choices": [
                "To explain the technical mechanisms underlying AR systems",
                "To contrast various AR platforms used across industries",
                "To provide evidence that AR training yields measurable improvements",
                "To trace the historical evolution of AR in educational contexts"
              ],
              "answer": 2
            },
            {
              "id": "R1-35",
              "kind": "mcq",
              "no": 35,
              "prompt": "According to paragraph 3, what represents a barrier to the broad implementation of AR-based employee training?",
              "choices": [
                "The technological complexity exceeds the capabilities of most workers",
                "Virtual environments cannot adequately replicate hazardous workplace conditions",
                "Empirical research has demonstrated superior outcomes with conventional instructional approaches",
                "The financial resources required for acquisition and upkeep exceed what numerous enterprises can afford"
              ],
              "answer": 3
            }
          ]
        }
      ]
    },
    {
      "id": "R2",
      "label": "Reading Module 2",
      "blocks": [
        {
          "kind": "cloze",
          "heading": "Questions 1-10",
          "instruction": "Fill in the blank.",
          "template": "Cosmology is the scientific study of the universe's origin, structure, and ultimate fate. This field {{1}} distant {{2}} and {{3}} through mathematical {{4}} {{5}} help explain cosmic {{6}}. It {{7}} {{8}} that are {{9}} accepted based on careful {{10}} of celestial phenomena. Advanced telescopes and space probes have revolutionized our understanding of deep space. These technological advances continue to shape modern astrophysical research in profound ways.",
          "questions": [
            {
              "id": "R2-1",
              "kind": "blank",
              "no": 1,
              "hint": "exam",
              "answer": "examines"
            },
            {
              "id": "R2-2",
              "kind": "blank",
              "no": 2,
              "hint": "gala",
              "answer": "galaxies"
            },
            {
              "id": "R2-3",
              "kind": "blank",
              "no": 3,
              "hint": "pla",
              "answer": "planets"
            },
            {
              "id": "R2-4",
              "kind": "blank",
              "no": 4,
              "hint": "mod",
              "answer": "models"
            },
            {
              "id": "R2-5",
              "kind": "blank",
              "no": 5,
              "hint": "wh",
              "answer": "which"
            },
            {
              "id": "R2-6",
              "kind": "blank",
              "no": 6,
              "hint": "eve",
              "answer": "events"
            },
            {
              "id": "R2-7",
              "kind": "blank",
              "no": 7,
              "hint": "desc",
              "answer": "describes"
            },
            {
              "id": "R2-8",
              "kind": "blank",
              "no": 8,
              "hint": "id",
              "answer": "ideas"
            },
            {
              "id": "R2-9",
              "kind": "blank",
              "no": 9,
              "hint": "wid",
              "answer": "widely"
            },
            {
              "id": "R2-10",
              "kind": "blank",
              "no": 10,
              "hint": "observ",
              "answer": "observations"
            }
          ]
        },
        {
          "kind": "passage",
          "heading": "Questions 11-15",
          "instruction": "Read a passage.",
          "title": "Benefits of Green Roofs",
          "paragraphs": [
            "Green roofs, which feature layers of vegetation planted on building rooftops, have gained increasing popularity in urban planning as a strategy for addressing environmental challenges. These living systems offer multiple benefits that extend well beyond simple aesthetics.",
            "One significant advantage is increased energy efficiency. The layer of soil and plants provides natural insulation, substantially reducing heat transfer through the roof structure. During summer months, green roofs can lower indoor temperatures by several degrees, diminishing the need for air conditioning and reducing energy consumption.",
            "Green roofs also help combat the urban heat island effect, a phenomenon where cities become significantly warmer than surrounding rural areas due to heat- absorbing surfaces like asphalt and concrete. By replacing these dark surfaces with vegetation, green roofs reflect more sunlight and release moisture through evapotranspiration, effectively cooling the surrounding air.",
            "Additionally, rooftop gardens enhance ecological diversity by providing habitat for insects, birds, and other wildlife in otherwise barren urban environments. {{A}} Some cities have also begun using green roofs for urban food production, growing vegetables and herbs that supply local restaurants and community markets. {{B}}",
            "However, green roofs require substantial initial investment and ongoing maintenance costs. {{C}} The added weight of soil and vegetation also demands reinforced structural support, which can limit installation options for older buildings. {{D}}"
          ],
          "questions": [
            {
              "id": "R2-11",
              "kind": "mcq",
              "no": 11,
              "prompt": "The word “diminishing” in paragraph 2 is closest in meaning to",
              "choices": [
                "eliminating",
                "addressing",
                "lessening",
                "stabilizing"
              ],
              "answer": 2
            },
            {
              "id": "R2-12",
              "kind": "mcq",
              "no": 12,
              "prompt": "According to the passage, how does the vegetation layer on green roofs contribute to energy efficiency?",
              "choices": [
                "It completely prevents heat from entering buildings during all seasons",
                "It functions as insulation that decreases the transfer of heat",
                "It generates electricity through photosynthetic processes in plants",
                "It absorbs excess moisture that would otherwise damage roof materials"
              ],
              "answer": 1
            },
            {
              "id": "R2-13",
              "kind": "mcq",
              "no": 13,
              "prompt": "What can be inferred from the passage about conventional urban surfaces such as asphalt and concrete?",
              "choices": [
                "They retain less thermal energy than vegetated surfaces during daylight hours",
                "They contribute to elevated temperatures in metropolitan areas",
                "They have been largely replaced by green infrastructure in most cities",
                "They are more cost-effective than green roofs for urban development"
              ],
              "answer": 1
            },
            {
              "id": "R2-14",
              "kind": "mcq",
              "no": 14,
              "prompt": "Why does the author mention \"vegetation\" in the discussion of the urban heat island effect?",
              "choices": [
                "To contrast plant biology with the physical properties of synthetic materials",
                "To explain the mechanism by which green roofs counteract urban warming",
                "To argue that all urban areas should mandate vegetated roof installations",
                "To describe the aesthetic improvements green roofs provide to cityscapes"
              ],
              "answer": 1
            },
            {
              "id": "R2-15",
              "kind": "insert",
              "no": 15,
              "prompt": "Look at the four letters (A, B, C, and D) in the passage that indicate where the following sentence could be added. Where would the sentence best fit?",
              "choices": [
                "Position A",
                "Position B",
                "Position C",
                "Position D"
              ],
              "answer": 3,
              "sentence": "These factors must be carefully weighed against the environmental and economic benefits described above."
            }
          ],
          "markerOrigin": "authored",
          "markerNote": "원본 NEW TOEFL MOCK TEST SET  9.docx 의 이 지문에는 A/B/C/D 표식이 아예 없다. 이 지문은 본문 문단이 아니라 텍스트박스(w:txbxContent) 안에 있고 mc:Choice/mc:Fallback 으로 두 번 기술되는데, 텍스트박스 내부 w:t 까지 전수 추출해 확인해도 마커도 w:sym 도 없다. 마커가 없으면 렌더러가 삽입 지점 버튼을 하나도 만들지 못해 문항이 성립하지 않으므로, 정답 D(answer:3) 제약과 지시어 \"These factors\"/\"benefits described above\" 의 선행사 요건에 맞춰 네 자리를 tools/build_set9.py 에서 집필했다. D = 단점 문단이 끝난 자리(모든 factor 열거 후), A·B·C 는 문법적으로는 붙을 만한 오답 자리. 원본에서 실제 마커 위치가 확보되면 build_set9.py 의 INSERT_MARKERS 표를 교체하고 이 필드를 지울 것."
        }
      ]
    }
  ]
};

  var listening = {
  "id": "listening",
  "label": "Listening",
  "labelKo": "리스닝",
  "timeLimitSec": null,
  "modules": [
    {
      "id": "L1",
      "label": "Listening Module 1",
      "timeLimitSec": null,
      "blocks": [
        {
          "kind": "audio-set",
          "heading": "Questions 1-12",
          "instruction": "Listen to the question and select the best response from the choices.",
          "questions": [
            {
              "id": "L1-1",
              "kind": "mcq",
              "no": 1,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "I usually study in the library.",
                "It’s on the second floor, near the elevators.",
                "The building was innovated last year.",
                "It’s open until midnight during finals."
              ],
              "answer": 1,
              "layout": "short-response",
              "audio": "media/audio/set9/l1-q01.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-b.webp"
            },
            {
              "id": "L1-2",
              "kind": "mcq",
              "no": 2,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "At ten o’clock, I believe.",
                "The topic is really interesting.",
                "I think it’s in Hall B this week.",
                "The professor is new this semester."
              ],
              "answer": 0,
              "layout": "short-response",
              "audio": "media/audio/set9/l1-q02.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-a.webp"
            },
            {
              "id": "L1-3",
              "kind": "mcq",
              "no": 3,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "I joined the team last month.",
                "We’re meeting in the usual room, right?",
                "Well, we can always start with whoever shows up.",
                "Sarah said she might bring snacks."
              ],
              "answer": 2,
              "layout": "short-response",
              "audio": "media/audio/set9/l1-q03.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-d.webp"
            },
            {
              "id": "L1-4",
              "kind": "mcq",
              "no": 4,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "I saw him at the cafeteria earlier.",
                "He’s always forgetting things.",
                "The office supply store closes at six.",
                "There’s a supply closest down the hall."
              ],
              "answer": 3,
              "layout": "short-response",
              "audio": "media/audio/set9/l1-q04.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-c.webp"
            },
            {
              "id": "L1-5",
              "kind": "mcq",
              "no": 5,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "The classroom is on the third floor.",
                "The bulb might need replacing.",
                "I prefer natural lighting.",
                "The switch is right by the door."
              ],
              "answer": 1,
              "layout": "short-response",
              "audio": "media/audio/set9/l1-q05.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-d.webp"
            },
            {
              "id": "L1-6",
              "kind": "mcq",
              "no": 6,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "There’s a kiosk by the main entrance.",
                "The train departs at six.",
                "I usually drive to work.",
                "A round trip is about forty dollars."
              ],
              "answer": 0,
              "layout": "short-response",
              "audio": "media/audio/set9/l1-q06.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-c.webp"
            },
            {
              "id": "L1-7",
              "kind": "mcq",
              "no": 7,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "My phone battery is almost dead too.",
                "Did you check the circuit breaker?",
                "That would explain why the streetlights are off too.",
                "I was in the middle of watching something."
              ],
              "answer": 2,
              "layout": "short-response",
              "audio": "media/audio/set9/l1-q07.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-b.webp"
            },
            {
              "id": "L1-8",
              "kind": "mcq",
              "no": 8,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "The class is in room 201.",
                "I enjoy the lectures.",
                "Did I miss anything important?",
                "I overslept."
              ],
              "answer": 3,
              "layout": "short-response",
              "audio": "media/audio/set9/l1-q08.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-a.webp"
            },
            {
              "id": "L1-9",
              "kind": "mcq",
              "no": 9,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "The presentation went really well.",
                "I think Group B is scheduled first.",
                "The schedule should be posted online.",
                "The conference room is upstairs."
              ],
              "answer": 1,
              "layout": "short-response",
              "audio": "media/audio/set9/l1-q09.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-f.webp"
            },
            {
              "id": "L1-10",
              "kind": "mcq",
              "no": 10,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "I’m still working on the conclusion.",
                "the seminar was very informative.",
                "It’s supposed to be at least ten pages.",
                "The topic is on climate change."
              ],
              "answer": 0,
              "layout": "short-response",
              "audio": "media/audio/set9/l1-q10.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-e.webp"
            },
            {
              "id": "L1-11",
              "kind": "mcq",
              "no": 11,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "I think the game is almost over.",
                "The show starts at eight.",
                "Sure, no problem.",
                "What channel is this on?"
              ],
              "answer": 2,
              "layout": "short-response",
              "audio": "media/audio/set9/l1-q11.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-b.webp"
            },
            {
              "id": "L1-12",
              "kind": "mcq",
              "no": 12,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "The group project is due Friday.",
                "Everyone’s been so busy with midterms.",
                "The library closes at nine.",
                "How about next Tuesday instead?"
              ],
              "answer": 3,
              "layout": "short-response",
              "audio": "media/audio/set9/l1-q12.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-e.webp"
            }
          ],
          "perQuestionAudio": true
        },
        {
          "kind": "audio-set",
          "heading": "Questions 13-14",
          "instruction": "Listen to a conversation.",
          "questions": [
            {
              "id": "L1-13",
              "kind": "mcq",
              "no": 13,
              "prompt": "What are the speakers mainly discussing?",
              "choices": [
                "The woman’s academic project progress",
                "A request for a deadline extension",
                "A professor’s grading policies",
                "Research methodology problems"
              ],
              "answer": 0
            },
            {
              "id": "L1-14",
              "kind": "mcq",
              "no": 14,
              "prompt": "When will the man be available to help the woman?",
              "choices": [
                "This weekend",
                "In three weeks",
                "After the final presentation",
                "Next week"
              ],
              "answer": 3
            }
          ],
          "audio": "media/audio/set9/l1-q13-14.mp3",
          "image": "media/pictures/set9/l2-q4-5-conversation.webp"
        },
        {
          "kind": "audio-set",
          "heading": "Questions 15-16",
          "instruction": "Listen to a conversation.",
          "questions": [
            {
              "id": "L1-15",
              "kind": "mcq",
              "no": 15,
              "prompt": "What problem does the man have?",
              "choices": [
                "He forgot to make a reservation.",
                "His equipment reservation was not recorded.",
                "The microscope he needs is broken.",
                "He missed his biology lab session."
              ],
              "answer": 1
            },
            {
              "id": "L1-16",
              "kind": "mcq",
              "no": 16,
              "prompt": "What will the woman probably do next?",
              "choices": [
                "Contact the biology department",
                "Reserve a different microscope",
                "Postpone the man's experiment",
                "Look up the man's booking information"
              ],
              "answer": 3
            }
          ],
          "audio": "media/audio/set9/l1-q15-16.mp3",
          "image": "media/pictures/set9/l2-q6-7-conversation.webp"
        },
        {
          "kind": "audio-set",
          "heading": "Questions 17-18",
          "instruction": "Listen to a conversation.",
          "questions": [
            {
              "id": "L1-17",
              "kind": "mcq",
              "no": 17,
              "prompt": "Why does the man want to participate in the garage sale?",
              "choices": [
                "He wants to help the woman move.",
                "He needs money for new furniture.",
                "He has items he wants to sell.",
                "He enjoys meeting new people."
              ],
              "answer": 2
            },
            {
              "id": "L1-18",
              "kind": "mcq",
              "no": 18,
              "prompt": "What can be inferred about the woman?",
              "choices": [
                "She has never held a garage sale before.",
                "She has experience selling items this way.",
                "She prefers to donate rather than sell.",
                "She is planning to move soon."
              ],
              "answer": 1
            }
          ],
          "audio": "media/audio/set9/l1-q17-18.mp3",
          "image": "media/pictures/set9/l2-q4-5-conversation.webp"
        },
        {
          "kind": "audio-set",
          "heading": "Questions 19-20",
          "instruction": "Listen to an announcement.",
          "questions": [
            {
              "id": "L1-19",
              "kind": "mcq",
              "no": 19,
              "prompt": "What is the main topic of the announcement?",
              "choices": [
                "A membership recruitment drive for a campus club",
                "A game design workshop for interested students",
                "A social gathering hosted by a club",
                "A competition between organizations"
              ],
              "answer": 2
            },
            {
              "id": "L1-20",
              "kind": "mcq",
              "no": 20,
              "prompt": "What are attendees asked to bring?",
              "choices": [
                "Board games from home",
                "Snacks to share",
                "A registration fee",
                "Their student IDs"
              ],
              "answer": 1
            }
          ],
          "audio": "media/audio/set9/l1-q19-20.mp3",
          "image": "media/pictures/set9/l1-q1-12-speaker-a.webp"
        },
        {
          "kind": "audio-set",
          "heading": "Questions 21-22",
          "instruction": "Listen to an announcement.",
          "questions": [
            {
              "id": "L1-21",
              "kind": "mcq",
              "no": 21,
              "prompt": "What is the main purpose of the announcement?",
              "choices": [
                "To introduce visiting lecturers to students",
                "To announce a new peer review assignment",
                "To remind students of upcoming project deadlines",
                "To inform students about a room change"
              ],
              "answer": 3
            },
            {
              "id": "L1-22",
              "kind": "mcq",
              "no": 22,
              "prompt": "What can be inferred about students in this class?",
              "choices": [
                "They will need to go to a different building",
                "They should register for the lecture series soon",
                "They can skip class on Monday if needed",
                "They will receive extra credit for attending"
              ],
              "answer": 0
            }
          ],
          "audio": "media/audio/set9/l1-q21-22.mp3",
          "image": "media/pictures/set9/l1-q1-12-speaker-e.webp"
        },
        {
          "kind": "audio-set",
          "heading": "Questions 23-24",
          "instruction": "Listen to an announcement.",
          "questions": [
            {
              "id": "L1-23",
              "kind": "mcq",
              "no": 23,
              "prompt": "Which of the following is true about the Health Sciences Shadowing Program?",
              "choices": [
                "It is available to students from any major",
                "Participants will observe professionals weekly",
                "The program runs during summer break",
                "Students will assist with medical procedures"
              ],
              "answer": 1
            },
            {
              "id": "L1-24",
              "kind": "mcq",
              "no": 24,
              "prompt": "What should students include in their application?",
              "choices": [
                "Two faculty recommendation letters",
                "A health screening report",
                "Prior volunteer experience documentation",
                "Immunization records and a personal statement"
              ],
              "answer": 3
            }
          ],
          "audio": "media/audio/set9/l1-q23-24.mp3",
          "image": "media/pictures/set9/l1-q1-12-speaker-c.webp"
        },
        {
          "kind": "audio-set",
          "heading": "Questions 25-28",
          "instruction": "Listen to a talk.",
          "questions": [
            {
              "id": "L1-25",
              "kind": "mcq",
              "no": 25,
              "prompt": "What is the main topic of the talk?",
              "choices": [
                "The historical development of Newton's laws of motion",
                "How moving objects overcome air resistance during turns",
                "Different techniques cyclists use to increase their speed",
                "How leaning helps maintain balance in turns"
              ],
              "answer": 3
            },
            {
              "id": "L1-26",
              "kind": "mcq",
              "no": 26,
              "prompt": "According to the speaker, what does the law of inertia state?",
              "choices": [
                "Objects in motion tend to continue straight",
                "Heavier objects require more force to stop completely",
                "Objects naturally slow down over time without applied force",
                "All motion eventually comes to rest"
              ],
              "answer": 0
            },
            {
              "id": "L1-27",
              "kind": "mcq",
              "no": 27,
              "prompt": "What determines how much a cyclist must lean during a turn?",
              "choices": [
                "The weight of the bicycle and rider",
                "The surface material of the road",
                "Speed and curve sharpness",
                "The direction of the wind"
              ],
              "answer": 2
            },
            {
              "id": "L1-28",
              "kind": "mcq",
              "no": 28,
              "prompt": "What will the speaker discuss next?",
              "choices": [
                "How Newton discovered the laws of motion",
                "Road and track design applications",
                "Safety equipment commonly used by cyclists",
                "The key difference between bicycles and motorcycles"
              ],
              "answer": 1
            }
          ],
          "audio": "media/audio/set9/l1-q25-28.mp3",
          "image": "media/pictures/set9/l1-q1-12-speaker-e.webp"
        },
        {
          "kind": "audio-set",
          "heading": "Questions 29-32",
          "instruction": "Listen to a talk.",
          "questions": [
            {
              "id": "L1-29",
              "kind": "mcq",
              "no": 29,
              "prompt": "What is the talk mainly about?",
              "choices": [
                "The history of dice games in educational settings",
                "A tool for sparking ideas and interaction",
                "How to become a professional fiction writer",
                "Traditional methods of overcoming writer's block"
              ],
              "answer": 1
            },
            {
              "id": "L1-30",
              "kind": "mcq",
              "no": 30,
              "prompt": "What does the speaker say is central to creative thinking?",
              "choices": [
                "Making unexpected connections",
                "Following established story structures",
                "Working independently without prompts",
                "Planning narratives carefully in advance"
              ],
              "answer": 0
            },
            {
              "id": "L1-31",
              "kind": "mcq",
              "no": 31,
              "prompt": "Why does the speaker mention social gatherings?",
              "choices": [
                "To explain where picture dice were invented",
                "To argue that writing is better done in groups",
                "To compare professional and casual storytelling",
                "To show another use of the dice"
              ],
              "answer": 3
            },
            {
              "id": "L1-32",
              "kind": "mcq",
              "no": 32,
              "prompt": "What will the speaker discuss next?",
              "choices": [
                "How to manufacture picture dice at home",
                "Other icebreaker activities for social events",
                "The psychology behind visual learning styles",
                "A former student's work using this method"
              ],
              "answer": 3
            }
          ],
          "audio": "media/audio/set9/l1-q29-32.mp3",
          "image": "media/pictures/set9/l1-q1-12-speaker-c.webp"
        }
      ]
    },
    {
      "id": "L2",
      "label": "Listening Module 2",
      "timeLimitSec": null,
      "blocks": [
        {
          "kind": "audio-set",
          "heading": "Questions 1-3",
          "instruction": "Listen to the question and select the best response from the choices.",
          "questions": [
            {
              "id": "L2-1",
              "kind": "mcq",
              "no": 1,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "I think it starts at three.",
                "The tutoring center is in the library.",
                "Yes, I registered online yesterday.",
                "I heard spots fill up fast."
              ],
              "answer": 2,
              "layout": "short-response",
              "audio": "media/audio/set9/l2-q01.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-b.webp"
            },
            {
              "id": "L2-2",
              "kind": "mcq",
              "no": 2,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "It's in the administration building.",
                "I applied for a scholarship last semester.",
                "The deadline was extended.",
                "You can also apply online now"
              ],
              "answer": 0,
              "layout": "short-response",
              "audio": "media/audio/set9/l2-q02.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-f.webp"
            },
            {
              "id": "L2-3",
              "kind": "mcq",
              "no": 3,
              "prompt": "Listen to the question and select the best response.",
              "choices": [
                "I'm leaning toward biology.",
                "The deadline to declare is next month.",
                "My advisor suggested I take a semester off.",
                "Engineering requires the most credits."
              ],
              "answer": 0,
              "layout": "short-response",
              "audio": "media/audio/set9/l2-q03.mp3",
              "image": "media/pictures/set9/l1-q1-12-speaker-d.webp"
            }
          ],
          "perQuestionAudio": true
        },
        {
          "kind": "audio-set",
          "heading": "Questions 4-5",
          "instruction": "Listen to a conversation.",
          "questions": [
            {
              "id": "L2-4",
              "kind": "mcq",
              "no": 4,
              "prompt": "What happened to the woman recently?",
              "choices": [
                "She dropped a linguistics course.",
                "She received a spot in a seminar.",
                "She changed her major to linguistics.",
                "She met with Professor Hammond."
              ],
              "answer": 1
            },
            {
              "id": "L2-5",
              "kind": "mcq",
              "no": 5,
              "prompt": "What does the woman suggest the man do?",
              "choices": [
                "Email the professor directly",
                "Attend the first class anyway",
                "Wait until next semester",
                "Prepare an alternative course option"
              ],
              "answer": 3
            }
          ],
          "audio": "media/audio/set9/set9-L2-04-05.mp3",
          "script": "Hey, did you manage to get into Professor Hammond’s linguistics seminar? I know it fills up fast. Not initially. I was number four on the waitlist, but I just got an email saying a spot opened up. That’s great news! I’m still stuck at number seven. I’m keeping my fingers crossed, but I’m not holding my breath. You might want to have a backup plan. The add/drop deadline is next Friday, and the list doesn’t usually move that quickly. Yeah, I’ve been looking at a sociolinguistics course as an alternative. It fits my schedule, but it’s not my first choice. Well, sometimes those unexpected courses turn out to be the best ones.",
          "scriptOrigin": "source",
          "scriptNote": "원본 전사(2026-08-12 확보). 종전에는 SET 9 SCRIPT.docx 에 Listening Module 2 Q4-15 의 본문 전사가 없어 정답키 제약에 맞춰 새로 집필(origin:\"authored\", rev3)한 지문을 쓰고 있었다. 원본이 들어왔으므로 그 집필본을 전부 폐기하고 원문으로 교체했다. 이제 이 블록은 다른 블록과 같은 지위의 원본이며, 지어낸 문장은 한 줄도 들어 있지 않다.",
          "scriptBlockId": "L2-B2",
          "scriptKind": "conversation",
          "image": "media/pictures/set9/l2-q4-5-conversation.webp"
        },
        {
          "kind": "audio-set",
          "heading": "Questions 6-7",
          "instruction": "Listen to a conversation.",
          "questions": [
            {
              "id": "L2-6",
              "kind": "mcq",
              "no": 6,
              "prompt": "What is the man’s main concern?",
              "choices": [
                "His rent is increasing significantly.",
                "His apartment is too far from work.",
                "His lease is about to expire.",
                "His landlord is difficult to contact."
              ],
              "answer": 0
            },
            {
              "id": "L2-7",
              "kind": "mcq",
              "no": 7,
              "prompt": "What can be inferred about the man?",
              "choices": [
                "He plans to move to a new city soon.",
                "He recently started a new job.",
                "He has a history of paying rent on time.",
                "He prefers to live with roommates."
              ],
              "answer": 2
            }
          ],
          "audio": "media/audio/set9/set9-L2-06-07.mp3",
          "script": "My landlord just sent me a notice about renewing my lease. The rent is going up by 15 percent. Ouch. That’s a pretty steep increase. Are you going to stay? I’m torn. The location is perfect—it’s a stone’s throw from my office—but that’s a lot more money every month. Have you thought about negotiating? Sometimes landlords are willing to meet you halfway, especially if you’ve been a reliable tenant. That’s not a bad idea. I’ve never missed a payment in three years. Maybe I can use that as leverage. Exactly. The worst they can say is no.",
          "scriptOrigin": "source",
          "scriptNote": "원본 전사(2026-08-12 확보). 종전에는 SET 9 SCRIPT.docx 에 Listening Module 2 Q4-15 의 본문 전사가 없어 정답키 제약에 맞춰 새로 집필(origin:\"authored\", rev3)한 지문을 쓰고 있었다. 원본이 들어왔으므로 그 집필본을 전부 폐기하고 원문으로 교체했다. 이제 이 블록은 다른 블록과 같은 지위의 원본이며, 지어낸 문장은 한 줄도 들어 있지 않다.",
          "scriptBlockId": "L2-B3",
          "scriptKind": "conversation",
          "image": "media/pictures/set9/l2-q6-7-conversation.webp"
        },
        {
          "kind": "audio-set",
          "heading": "Questions 8-11",
          "instruction": "Listen to a talk.",
          "questions": [
            {
              "id": "L2-8",
              "kind": "mcq",
              "no": 8,
              "prompt": "What aspect of bird behavior does the speaker mainly discuss in this talk?",
              "choices": [
                "The physiological adaptations that allow birds to fly long distances",
                "The seasonal patterns of food availability in different regions",
                "The navigation methods birds use and challenges to migration",
                "The evolutionary origins of migratory behavior in bird species"
              ],
              "answer": 2,
              "sourceCorrections": [
                {
                  "target": "choices[0]",
                  "raw": "The physiology adaptations that allows birds to fly long distances",
                  "corrected": "The physiological adaptations that allow birds to fly long distances",
                  "action": "corrected",
                  "why": "docx 원문 오타: 명사 physiology 가 한정어 자리에 쓰였고(→ physiological), 복수주어 adaptations 에 allows 가 붙어 수일치가 깨져 있다(→ allow). 오답 선택지만 비문이면 내용을 몰라도 소거되므로 test-wiseness 누출이다."
                },
                {
                  "target": "choices[3]",
                  "raw": "The evolutionary origins of migratory behavior in birds species",
                  "corrected": "The evolutionary origins of migratory behavior in bird species",
                  "action": "corrected",
                  "why": "docx 원문 오타: birds species → bird species (복합명사의 앞 요소는 단수)."
                }
              ],
              "choicesRaw": [
                "The physiology adaptations that allows birds to fly long distances",
                "The seasonal patterns of food availability in different regions",
                "The navigation methods birds use and challenges to migration",
                "The evolutionary origins of migratory behavior in birds species"
              ]
            },
            {
              "id": "L2-9",
              "kind": "mcq",
              "no": 9,
              "prompt": "According to the speaker, which navigation method do migrating birds use during nighttime travel?",
              "choices": [
                "Detecting changes in air temperature",
                "Following the Sun’s magnetic field patterns",
                "Recognizing landscape features below",
                "Observing positions of stars"
              ],
              "answer": 3
            },
            {
              "id": "L2-10",
              "kind": "mcq",
              "no": 10,
              "prompt": "Why does the speaker discuss glass buildings in relation to bird migration?",
              "choices": [
                "To give an example of how human development harms migrating birds",
                "To explain why birds prefer to rest on artificial structures",
                "To suggest that urban areas provide shelter for migratory species",
                "To describe how birds have adapted to modern environments"
              ],
              "answer": 0,
              "sourceCorrections": [
                {
                  "target": "choices[3]",
                  "raw": "To describe how birds have adapted to modem environments",
                  "corrected": "To describe how birds have adapted to modern environments",
                  "action": "corrected",
                  "why": "docx 원문 오타: modem 은 modern 의 OCR/타이핑 오류."
                }
              ],
              "choicesRaw": [
                "To give an example of how human development harms migrating birds",
                "To explain why birds prefer to rest on artificial structures",
                "To suggest that urban areas provide shelter for migratory species",
                "To describe how birds have adapted to modem environments"
              ]
            },
            {
              "id": "L2-11",
              "kind": "mcq",
              "no": 11,
              "prompt": "Based on the talk, what can be inferred about the effects of climate change on bird migration?",
              "choices": [
                "Birds developing new navigation systems to cope with changes",
                "Misaligned timing between arrival and food sources threatens birds",
                "Warmer temperatures have made migration unnecessary for most species",
                "Climate shifts affect birds in tropical breeding grounds"
              ],
              "answer": 1
            }
          ],
          "audio": "media/audio/set9/set9-L2-08-11.mp3",
          "script": "Alright, so today we’re going to look at one of the most remarkable phenomena in the animal kingdom—bird migration. Now, many bird species travel thousands of miles each year, and the question is, how exactly do they do this? Well, birds rely on several different navigation systems working together. They use the sun’s position during the day to orient themselves, tracking how it moves across the sky. At night, they actually follow star patterns—particularly the North Star and surrounding constellations. Additionally, many species can detect Earth’s magnetic field through special proteins in their eyes, which essentially gives them a built-in compass. Some researchers believe birds may even use smell to recognize familiar landscapes, though this is still being studied. Now, why do birds go through all this trouble? Basically, it comes down to survival. They’re moving between breeding grounds in temperate regions and feeding areas in warmer climates. This seasonal movement allows them to take advantage of food resources that vary throughout the year. For instance, insects are abundant in northern areas during summer but disappear in winter, so insect-eating birds must travel south to find food. However, here’s where things get problematic. Human activities are increasingly disrupting these ancient migration routes. Light pollution from cities confuses birds that navigate by starlight, causing them to become disoriented and exhausted as they circle illuminated buildings. Building designs, particularly glass structures, pose another serious threat—birds can’t see glass and fly directly into windows, leading to millions of collisions annually. Climate change is also shifting the timing of food availability, which means birds may arrive at their destinations only to find their food sources, like certain insects or plants, haven’t appeared yet. These disruptions can have serious ecological consequences, potentially threatening entire populations that have followed the same routes for thousands of years.",
          "scriptOrigin": "source",
          "scriptNote": "원본 전사(2026-08-12 확보). 종전에는 SET 9 SCRIPT.docx 에 Listening Module 2 Q4-15 의 본문 전사가 없어 정답키 제약에 맞춰 새로 집필(origin:\"authored\", rev3)한 지문을 쓰고 있었다. 원본이 들어왔으므로 그 집필본을 전부 폐기하고 원문으로 교체했다. 이제 이 블록은 다른 블록과 같은 지위의 원본이며, 지어낸 문장은 한 줄도 들어 있지 않다.",
          "scriptBlockId": "L2-B4",
          "scriptKind": "talk",
          "image": "media/pictures/set9/l2-q8-11-talk.webp"
        },
        {
          "kind": "audio-set",
          "heading": "Questions 12-15",
          "instruction": "Listen to a talk.",
          "questions": [
            {
              "id": "L2-12",
              "kind": "mcq",
              "no": 12,
              "prompt": "What is the speaker primarily explaining in this talk about jazz music?",
              "choices": [
                "The technical skills required to master jazz instruments",
                "How jazz developed differently from classical music traditions",
                "The way jazz musicians collaborate with their audiences",
                "The nature and function of improvisation in jazz performance"
              ],
              "answer": 3
            },
            {
              "id": "L2-13",
              "kind": "mcq",
              "no": 13,
              "prompt": "According to the speaker, what makes jazz improvisation particularly demanding for musicians?",
              "choices": [
                "They must memorize numerous melodic variations before performing",
                "Chord progressions in jazz are more complex than in other genres",
                "Written scores require different interpretations at each concert",
                "They must listen and respond to other players instantaneously"
              ],
              "answer": 3
            },
            {
              "id": "L2-14",
              "kind": "mcq",
              "no": 14,
              "prompt": "What is the speaker’s purpose in comparing jazz improvisation to having a conversation?",
              "choices": [
                "To illustrate how improvisation combines freedom with underlying structure",
                "To emphasize that each musician develops a distinctive personal voice",
                "To suggest that performers exchange musical ideas with one another",
                "To explain why jazz feels more natural and accessible than other genres"
              ],
              "answer": 0,
              "sourceCorrections": [
                {
                  "target": "prompt",
                  "raw": "What is the speaker’s purpose in complaining jazz improvisation to having a conversation?",
                  "corrected": "What is the speaker’s purpose in comparing jazz improvisation to having a conversation?",
                  "action": "corrected",
                  "why": "docx 원문 오타: complaining X to Y 는 성립하지 않는 결합이고, 선택지 4개가 전부 \"비유의 목적\"을 묻는 형태다 → comparing 의 오타로 확정. 질문 자체가 뜻이 통하지 않으면 문항이 성립하지 않는다."
                },
                {
                  "target": "choices[3]",
                  "raw": "To explain why jazz feels more natural and accessible than others genres",
                  "corrected": "To explain why jazz feels more natural and accessible than other genres",
                  "action": "corrected",
                  "why": "docx 원문 오타: others genres → other genres."
                }
              ],
              "promptRaw": "What is the speaker’s purpose in complaining jazz improvisation to having a conversation?",
              "choicesRaw": [
                "To illustrate how improvisation combines freedom with underlying structure",
                "To emphasize that each musician develops a distinctive personal voice",
                "To suggest that performers exchange musical ideas with one another",
                "To explain why jazz feels more natural and accessible than others genres"
              ]
            },
            {
              "id": "L2-15",
              "kind": "mcq",
              "no": 15,
              "prompt": "What can be inferred from the discussion about how jazz influenced other musical genres?",
              "choices": [
                "Rock and blues musicians formally studied jazz theory before changing their approach",
                "Classical composers were initially reluctant",
                "Other genres previously placed greater emphasis on performing fixed compositions",
                "Audiences in rock and blues gradually lost interest in predictable performances"
              ],
              "answer": 2,
              "sourceCorrections": [
                {
                  "target": "choices[1]",
                  "raw": "Classical composers were initially reluctant",
                  "action": "left as-is",
                  "why": "문장이 미완성으로 보이나 NEW TOEFL MOCK TEST SET  9.docx 의 해당 문단이 그 자리에서 끝난다(런 구성: \"B.\" + \" Classical composers were initially reluctant\"). 파싱 손실이 아니라 원본이 그렇게 짧다. 뒷부분을 지어낼 수 없으므로 원문을 그대로 둔다. 정답은 [2] 이므로 채점에는 영향이 없다."
                }
              ]
            }
          ],
          "audio": "media/audio/set9/set9-L2-12-15.mp3",
          "script": "So, let’s talk about something that makes jazz really unique as a musical form—improvisation. In other words, the ability of musicians to create music spontaneously during a performance. Now, this might sound like musicians are just playing whatever comes to mind, but actually, there’s a lot of structure involved. It’s not random at all. Jazz improvisation typically works within a framework. Musicians follow chord progressions and melodic themes established at the beginning of a piece, but within those boundaries, they have freedom to create original phrases and explore different musical ideas. Think of it like a conversation where you know the topic but choose your own words. A saxophone player, for example, might take a familiar melody and transform it through variations in rhythm, pitch, and phrasing. A trumpet player might respond by building on that variation, adding their own interpretation. Each musician brings something personal to the performance. One interesting challenge with improvisation is that it requires musicians to listen very carefully to each other. They need to respond in real time to what their fellow performers are doing, adjusting their playing moment by moment. If the drummer shifts the rhythm slightly, everyone else has to notice and adapt. This means a jazz performance is never quite the same twice, which is part of what attracts audiences to live jazz. You’re witnessing something being created right in front of you. What makes this particularly significant is how improvisation influenced other music genres over time. Rock musicians began incorporating guitar solos that weren’t strictly scripted. Blues artists embraced spontaneous vocal variations. Even some classical composers started leaving room for performer interpretation in their works. So jazz didn’t just develop its own tradition—it fundamentally changed how we think about musical creativity altogether, encouraging musicians across genres to see performance as an act of creation, not just reproduction.",
          "scriptOrigin": "source",
          "scriptNote": "원본 전사(2026-08-12 확보). 종전에는 SET 9 SCRIPT.docx 에 Listening Module 2 Q4-15 의 본문 전사가 없어 정답키 제약에 맞춰 새로 집필(origin:\"authored\", rev3)한 지문을 쓰고 있었다. 원본이 들어왔으므로 그 집필본을 전부 폐기하고 원문으로 교체했다. 이제 이 블록은 다른 블록과 같은 지위의 원본이며, 지어낸 문장은 한 줄도 들어 있지 않다.",
          "scriptBlockId": "L2-B5",
          "scriptKind": "talk",
          "image": "media/pictures/set9/l2-q12-15-talk.webp"
        }
      ]
    }
  ]
};

  var writing = {
  "id": "writing",
  "label": "Writing",
  "labelKo": "라이팅",
  "timeLimitSec": null,
  "modules": [
    {
      "id": "W1",
      "label": "Build a Sentence",
      "timeLimitSec": 600,
      "blocks": [
        {
          "kind": "build-set",
          "heading": "Questions 1-10",
          "instruction": "Make an appropriate sentence.",
          "questions": [
            {
              "id": "set9-W1-q01",
              "kind": "build",
              "no": 1,
              "context": "What did the professor ask?",
              "slots": [
                {
                  "t": "b",
                  "a": "she"
                },
                {
                  "t": "b",
                  "a": "wanted to know"
                },
                {
                  "t": "f",
                  "text": "which books"
                },
                {
                  "t": "b",
                  "a": "I"
                },
                {
                  "t": "b",
                  "a": "needed"
                },
                {
                  "t": "b",
                  "a": "for"
                },
                {
                  "t": "b",
                  "a": "the final project"
                },
                {
                  "t": "f",
                  "text": "."
                }
              ],
              "tiles": [
                "wanted to know",
                "the final project",
                "I",
                "needed",
                "she",
                "for"
              ],
              "trapTiles": [],
              "sentence": "She wanted to know which books I needed for the final project.",
              "answerTokens": [
                "she",
                "wanted to know",
                "I",
                "needed",
                "for",
                "the final project"
              ]
            },
            {
              "id": "set9-W1-q02",
              "kind": "build",
              "no": 2,
              "context": "How did your homemade pizza turn out?",
              "slots": [
                {
                  "t": "b",
                  "a": "it"
                },
                {
                  "t": "b",
                  "a": "turns"
                },
                {
                  "t": "b",
                  "a": "out"
                },
                {
                  "t": "b",
                  "a": "I"
                },
                {
                  "t": "b",
                  "a": "added"
                },
                {
                  "t": "b",
                  "a": "too much"
                },
                {
                  "t": "b",
                  "a": "salt"
                },
                {
                  "t": "f",
                  "text": "."
                }
              ],
              "tiles": [
                "out",
                "I",
                "salt",
                "turns",
                "too much",
                "it",
                "added"
              ],
              "trapTiles": [],
              "sentence": "It turns out I added too much salt.",
              "answerTokens": [
                "it",
                "turns",
                "out",
                "I",
                "added",
                "too much",
                "salt"
              ]
            },
            {
              "id": "set9-W1-q03",
              "kind": "build",
              "no": 3,
              "context": "Have you decided on you class schedule yet?",
              "slots": [
                {
                  "t": "f",
                  "text": "I wonder"
                },
                {
                  "t": "b",
                  "a": "if"
                },
                {
                  "t": "b",
                  "a": "I"
                },
                {
                  "t": "b",
                  "a": "can"
                },
                {
                  "t": "b",
                  "a": "still"
                },
                {
                  "t": "b",
                  "a": "switch"
                },
                {
                  "t": "b",
                  "a": "to"
                },
                {
                  "t": "b",
                  "a": "the morning section"
                },
                {
                  "t": "f",
                  "text": "."
                }
              ],
              "tiles": [
                "to",
                "can",
                "the morning section",
                "if",
                "still",
                "I",
                "switch"
              ],
              "trapTiles": [],
              "sentence": "I wonder if I can still switch to the morning section",
              "answerTokens": [
                "if",
                "I",
                "can",
                "still",
                "switch",
                "to",
                "the morning section"
              ]
            },
            {
              "id": "set9-W1-q04",
              "kind": "build",
              "no": 4,
              "context": "Did you find the jacket you were looking for?",
              "slots": [
                {
                  "t": "b",
                  "a": "no"
                },
                {
                  "t": "f",
                  "text": ","
                },
                {
                  "t": "b",
                  "a": "it"
                },
                {
                  "t": "b",
                  "a": "was"
                },
                {
                  "t": "f",
                  "text": "out of stock"
                },
                {
                  "t": "b",
                  "a": "in"
                },
                {
                  "t": "b",
                  "a": "my size"
                },
                {
                  "t": "f",
                  "text": "."
                }
              ],
              "tiles": [
                "was",
                "my size",
                "is",
                "it",
                "in",
                "no"
              ],
              "trapTiles": [
                "is"
              ],
              "sentence": "No, it was out of stock in my size.",
              "answerTokens": [
                "no",
                "it",
                "was",
                "in",
                "my size"
              ]
            },
            {
              "id": "set9-W1-q05",
              "kind": "build",
              "no": 5,
              "context": "What did your study partner say about the final?",
              "slots": [
                {
                  "t": "b",
                  "a": "he"
                },
                {
                  "t": "b",
                  "a": "asked"
                },
                {
                  "t": "b",
                  "a": "if"
                },
                {
                  "t": "b",
                  "a": "I"
                },
                {
                  "t": "b",
                  "a": "had"
                },
                {
                  "t": "b",
                  "a": "finished"
                },
                {
                  "t": "b",
                  "a": "reviewing"
                },
                {
                  "t": "f",
                  "text": "the last chapter"
                },
                {
                  "t": "b",
                  "a": "yet"
                },
                {
                  "t": "f",
                  "text": "."
                }
              ],
              "tiles": [
                "if",
                "reviewing",
                "he",
                "had",
                "asked",
                "yet",
                "I",
                "finished"
              ],
              "trapTiles": [],
              "sentence": "He asked if I had finished reviewing the last chapter yet.",
              "answerTokens": [
                "he",
                "asked",
                "if",
                "I",
                "had",
                "finished",
                "reviewing",
                "yet"
              ]
            },
            {
              "id": "set9-W1-q06",
              "kind": "build",
              "no": 6,
              "context": "What time does that café open on weekends?",
              "slots": [
                {
                  "t": "b",
                  "a": "it"
                },
                {
                  "t": "b",
                  "a": "opens"
                },
                {
                  "t": "f",
                  "text": "at nine"
                },
                {
                  "t": "b",
                  "a": "on"
                },
                {
                  "t": "b",
                  "a": "Saturdays"
                },
                {
                  "t": "f",
                  "text": "."
                }
              ],
              "tiles": [
                "on",
                "opening",
                "Saturdays",
                "it",
                "opens"
              ],
              "trapTiles": [
                "opening"
              ],
              "sentence": "It opens at nine on Saturdays.",
              "answerTokens": [
                "it",
                "opens",
                "on",
                "Saturdays"
              ]
            },
            {
              "id": "set9-W1-q07",
              "kind": "build",
              "no": 7,
              "context": "The professor changed the research topic.",
              "slots": [
                {
                  "t": "f",
                  "text": "Did she"
                },
                {
                  "t": "b",
                  "a": "explain"
                },
                {
                  "t": "b",
                  "a": "where to find"
                },
                {
                  "t": "b",
                  "a": "the new guidelines"
                },
                {
                  "t": "f",
                  "text": "?"
                }
              ],
              "tiles": [
                "the new guidelines",
                "explain",
                "where to find"
              ],
              "trapTiles": [],
              "sentence": "Did she explain where to find the new guidelines?",
              "answerTokens": [
                "explain",
                "where to find",
                "the new guidelines"
              ]
            },
            {
              "id": "set9-W1-q08",
              "kind": "build",
              "no": 8,
              "context": "Are you joining any clubs this semester?",
              "slots": [
                {
                  "t": "b",
                  "a": "I"
                },
                {
                  "t": "b",
                  "a": "met"
                },
                {
                  "t": "b",
                  "a": "a student"
                },
                {
                  "t": "f",
                  "text": "who runs"
                },
                {
                  "t": "b",
                  "a": "the photography club"
                },
                {
                  "t": "b",
                  "a": "and"
                },
                {
                  "t": "b",
                  "a": "it"
                },
                {
                  "t": "b",
                  "a": "seems"
                },
                {
                  "t": "b",
                  "a": "interesting"
                },
                {
                  "t": "f",
                  "text": "."
                }
              ],
              "tiles": [
                "and",
                "the photography club",
                "met",
                "interesting",
                "ran",
                "I",
                "a student",
                "it",
                "seems"
              ],
              "trapTiles": [
                "ran"
              ],
              "sentence": "I met a student who runs the photography club and it seems interesting.",
              "answerTokens": [
                "I",
                "met",
                "a student",
                "the photography club",
                "and",
                "it",
                "seems",
                "interesting"
              ]
            },
            {
              "id": "set9-W1-q09",
              "kind": "build",
              "no": 9,
              "context": "Did your roommate leave a message?",
              "slots": [
                {
                  "t": "b",
                  "a": "yes"
                },
                {
                  "t": "f",
                  "text": ","
                },
                {
                  "t": "b",
                  "a": "she"
                },
                {
                  "t": "b",
                  "a": "asked"
                },
                {
                  "t": "b",
                  "a": "what time"
                },
                {
                  "t": "b",
                  "a": "I"
                },
                {
                  "t": "b",
                  "a": "would"
                },
                {
                  "t": "b",
                  "a": "be"
                },
                {
                  "t": "b",
                  "a": "home"
                },
                {
                  "t": "f",
                  "text": "."
                }
              ],
              "tiles": [
                "would",
                "she",
                "home",
                "what time",
                "be",
                "asked",
                "I",
                "yes"
              ],
              "trapTiles": [],
              "sentence": "Yes, she asked what time I would be home.",
              "answerTokens": [
                "yes",
                "she",
                "asked",
                "what time",
                "I",
                "would",
                "be",
                "home"
              ]
            },
            {
              "id": "set9-W1-q10",
              "kind": "build",
              "no": 10,
              "context": "Which brand of cereal do you usually buy?",
              "slots": [
                {
                  "t": "b",
                  "a": "I"
                },
                {
                  "t": "b",
                  "a": "always"
                },
                {
                  "t": "b",
                  "a": "get"
                },
                {
                  "t": "b",
                  "a": "the one"
                },
                {
                  "t": "b",
                  "a": "the store"
                },
                {
                  "t": "b",
                  "a": "has"
                },
                {
                  "t": "f",
                  "text": "on sale."
                }
              ],
              "tiles": [
                "has",
                "the one",
                "got",
                "I",
                "the store",
                "get",
                "always"
              ],
              "trapTiles": [
                "got"
              ],
              "sentence": "I always get the one the store has on sale.",
              "answerTokens": [
                "I",
                "always",
                "get",
                "the one",
                "the store",
                "has"
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "W2",
      "label": "Write an Email",
      "timeLimitSec": 600,
      "blocks": [
        {
          "kind": "free-write",
          "heading": "WRITE AN EMAIL",
          "questions": [
            {
              "id": "set9-W2-email",
              "kind": "email",
              "no": 11,
              "to": "Christina",
              "subject": "Idea for the Fundraising Event",
              "situationLabel": "SITUATION",
              "situation": "You and your friend Christina are organizing a fundraising event for a local children’s hospital. While planning the event, you thought of an idea that could help improve the event and encourage more people from the community to participate. You want to share your idea with Christina and discuss next steps.",
              "bulletsLabel": "YOUR EMAIL SHOULD",
              "bullets": [
                "Describe your idea for improving the event and explain why you think it would be effective.",
                "Discuss how Christina can help with or contribute to your idea.",
                "Suggest a date and time for your next planning meeting and explain why that timing works well."
              ],
              "prompt": "You and your friend Christina are organizing a fundraising event for a local children’s hospital. While planning the event, you thought of an idea that could help improve the event and encourage more people from the community to participate. You want to share your idea with Christina and discuss next steps. Describe your idea for improving the event and explain why you think it would be effective. Discuss how Christina can help with or contribute to your idea. Suggest a date and time for your next planning meeting and explain why that timing works well.",
              "minWords": 80
            }
          ]
        }
      ]
    },
    {
      "id": "W3",
      "label": "Write for an Academic Discussion",
      "timeLimitSec": 600,
      "blocks": [
        {
          "kind": "free-write",
          "heading": "WRITE for an ACADEMIC DISCUSSION",
          "questions": [
            {
              "id": "set9-W3-disc",
              "kind": "discussion",
              "no": 12,
              "professor": "Doctor Alvarez – Business Ethics",
              "prompt": "In today’ session, we will examine company transparency and its growing importance in modern business practices. Transparency refers to how openly companies share information about their operations, finances, and decision-making with stakeholders. While openness can build trust, it may also create risks. Companies should be transparent to everyone, including the public. Do you agree or disagree with this statement? Why?",
              "posts": [
                {
                  "name": "Claire",
                  "text": "I agree that companies should be transparent to everyone. Transparency helps build trust with customers, employees, and investors, which is important for long-term success. When companies share information openly, they are more accountable for ethical behavior and social responsibility. This openness can improve reputation and encourage customer loyalty. Overall, transparency strengthens the relationship between businesses and society."
                },
                {
                  "name": "Mark",
                  "text": "I disagree that companies should be transparent to everyone. Although some transparency is necessary, complete openness can damage a company’s competitiveness. Businesses often depend on confidential strategies and financial information to succeed. If all details were public, competitors could misuse them. For this reason, companies should balance transparency with protecting sensitive information."
                }
              ],
              "minWords": 100
            }
          ]
        }
      ]
    }
  ]
};

  var speaking = {
  "id": "speaking",
  "label": "Speaking",
  "labelKo": "스피킹",
  "timeLimitSec": null,
  "modules": [
    {
      "id": "S1",
      "label": "Task 1 · Listen and Repeat",
      "timeLimitSec": 600,
      "blocks": [
        {
          "kind": "record-set",
          "heading": "Task 1",
          "instruction": "Listen and Repeat",
          "introAudio": "media/audio/set9/s1-instructions.mp3",
          "perQuestionAudio": true,
          "questions": [
            {
              "id": "set9-S1-q01",
              "kind": "repeat",
              "no": 1,
              "audio": "media/audio/set9/s1-q1.mp3",
              "prepSec": 3,
              "respondSec": 20,
              "script": "Is this your first time in our cafeteria?",
              "image": "media/pictures/set9/s-task1-repeat-1.png"
            },
            {
              "id": "set9-S1-q02",
              "kind": "repeat",
              "no": 2,
              "audio": "media/audio/set9/s1-q2.mp3",
              "prepSec": 3,
              "respondSec": 20,
              "script": "You can find today’s menu on the board?",
              "image": "media/pictures/set9/s-task1-repeat-2.png"
            },
            {
              "id": "set9-S1-q03",
              "kind": "repeat",
              "no": 3,
              "audio": "media/audio/set9/s1-q3.mp3",
              "prepSec": 3,
              "respondSec": 20,
              "script": "The hot food station is on the left side.",
              "image": "media/pictures/set9/s-task1-repeat-3.png"
            },
            {
              "id": "set9-S1-q04",
              "kind": "repeat",
              "no": 4,
              "audio": "media/audio/set9/s1-q4.mp3",
              "prepSec": 3,
              "respondSec": 20,
              "script": "We offer a variety of meals, snacks, and drinks every day.",
              "image": "media/pictures/set9/s-task1-repeat-4.png"
            },
            {
              "id": "set9-S1-q05",
              "kind": "repeat",
              "no": 5,
              "audio": "media/audio/set9/s1-q5.mp3",
              "prepSec": 3,
              "respondSec": 20,
              "script": "You can pay with cash or your student ID card.",
              "image": "media/pictures/set9/s-task1-repeat-5.png"
            },
            {
              "id": "set9-S1-q06",
              "kind": "repeat",
              "no": 6,
              "audio": "media/audio/set9/s1-q6.mp3",
              "prepSec": 3,
              "respondSec": 20,
              "script": "Please remember to return your tray to the collection area when finished.",
              "image": "media/pictures/set9/s-task1-repeat-6.png"
            },
            {
              "id": "set9-S1-q07",
              "kind": "repeat",
              "no": 7,
              "audio": "media/audio/set9/s1-q7.mp3",
              "prepSec": 3,
              "respondSec": 20,
              "script": "If you have any food allergies, please let the staff know before ordering.",
              "image": "media/pictures/set9/s-task1-repeat-7.png"
            }
          ],
          "script": "Instructions: You are being trained to help student at the university cafeteria, listen to your trainer, and repeat what she says. Repeat only once."
        }
      ]
    },
    {
      "id": "S2",
      "label": "Task 2 · Interview",
      "timeLimitSec": 600,
      "blocks": [
        {
          "kind": "record-set",
          "heading": "Task 2",
          "instruction": "Answer the interviewer’s questions.",
          "introAudio": "media/audio/set9/s2-instructions.mp3",
          "perQuestionAudio": true,
          "questions": [
            {
              "id": "set9-S2-q01",
              "kind": "interview",
              "no": 8,
              "audio": "media/audio/set9/s2-q1.mp3",
              "prepSec": 3,
              "respondSec": 45,
              "script": "Thank you for speaking with me today. I’d like to ask you some questions about exercise. What kind of exercise do you or someone you know typically do, such as running, swimming, or going to a gym? Why?",
              "image": "media/pictures/set9/s-task2-interviewer.webp"
            },
            {
              "id": "set9-S2-q02",
              "kind": "interview",
              "no": 9,
              "audio": "media/audio/set9/s2-q2.mp3",
              "prepSec": 3,
              "respondSec": 45,
              "script": "I see. If you wanted to encourage a friend who doesn’t exercise to become more active, would you prefer to invite them to exercise together with you, or would you prefer to share information about the benefits and let them decide on their own? Why?",
              "image": "media/pictures/set9/s-task2-interviewer.webp"
            },
            {
              "id": "set9-S2-q03",
              "kind": "interview",
              "no": 10,
              "audio": "media/audio/set9/s2-q3.mp3",
              "prepSec": 3,
              "respondSec": 45,
              "script": "Interesting. What are some things that might make it difficult for someone to start and maintain a regular exercise routine?",
              "image": "media/pictures/set9/s-task2-interviewer.webp"
            },
            {
              "id": "set9-S2-q04",
              "kind": "interview",
              "no": 11,
              "audio": "media/audio/set9/s2-q4.mp3",
              "prepSec": 3,
              "respondSec": 45,
              "script": "Good points. Lastly, what do you think are the most effective ways to help someone stay motivated to exercise over a long period of time?",
              "image": "media/pictures/set9/s-task2-interviewer.webp"
            }
          ],
          "script": "Instructions: You have volunteered for a research study on Exercise and Physical activity. You will have a short online interview with a researcher. The researcher will ask you some questions. Please answer the interviewer's questions."
        }
      ]
    }
  ]
};

  /* reading + listening 객관식 정답 (SET 9 ANSWER KEY.docx). 값은 choices 의 index 또는 blank 정답 문자열이다. */
  var ANSWER_KEY = {
  "R1-1": "populations",
  "R1-2": "experienced",
  "R1-3": "complex",
  "R1-4": "social",
  "R1-5": "and",
  "R1-6": "economic",
  "R1-7": "that",
  "R1-8": "political",
  "R1-9": "with",
  "R1-10": "traditions",
  "R1-11": "male",
  "R1-12": "establishes",
  "R1-13": "large",
  "R1-14": "territory",
  "R1-15": "spanning",
  "R1-16": "and",
  "R1-17": "regularly",
  "R1-18": "The",
  "R1-19": "look",
  "R1-20": "square",
  "R1-21": 1,
  "R1-22": 2,
  "R1-23": 2,
  "R1-24": 1,
  "R1-25": 2,
  "R1-26": 2,
  "R1-27": 0,
  "R1-28": 2,
  "R1-29": 1,
  "R1-30": 3,
  "R1-31": 3,
  "R1-32": 1,
  "R1-33": 0,
  "R1-34": 2,
  "R1-35": 3,
  "R2-1": "examines",
  "R2-2": "galaxies",
  "R2-3": "planets",
  "R2-4": "models",
  "R2-5": "which",
  "R2-6": "events",
  "R2-7": "describes",
  "R2-8": "ideas",
  "R2-9": "widely",
  "R2-10": "observations",
  "R2-11": 2,
  "R2-12": 1,
  "R2-13": 1,
  "R2-14": 1,
  "R2-15": 3,
  "L1-1": 1,
  "L1-2": 0,
  "L1-3": 2,
  "L1-4": 3,
  "L1-5": 1,
  "L1-6": 0,
  "L1-7": 2,
  "L1-8": 3,
  "L1-9": 1,
  "L1-10": 0,
  "L1-11": 2,
  "L1-12": 3,
  "L1-13": 0,
  "L1-14": 3,
  "L1-15": 1,
  "L1-16": 3,
  "L1-17": 2,
  "L1-18": 1,
  "L1-19": 2,
  "L1-20": 1,
  "L1-21": 3,
  "L1-22": 0,
  "L1-23": 1,
  "L1-24": 3,
  "L1-25": 3,
  "L1-26": 0,
  "L1-27": 2,
  "L1-28": 1,
  "L1-29": 1,
  "L1-30": 0,
  "L1-31": 3,
  "L1-32": 3,
  "L2-1": 2,
  "L2-2": 0,
  "L2-3": 0,
  "L2-4": 1,
  "L2-5": 3,
  "L2-6": 0,
  "L2-7": 2,
  "L2-8": 2,
  "L2-9": 3,
  "L2-10": 0,
  "L2-11": 1,
  "L2-12": 3,
  "L2-13": 3,
  "L2-14": 0,
  "L2-15": 2
};

  /* 빌드 시점에 감지된 결손. 런타임은 이 배열을 읽지 않는다(기록용). */
  var BUILD_WARNINGS = [];

  window.SMEAG_SET9 = {
    code: 'SET9',
    title: 'NEW TOEFL SET 9',
    paths: { audio: 'media/audio/set9/', pics: 'media/pictures/set9/' },
    sections: [reading, listening, writing, speaking],
    answerKey: ANSWER_KEY,
    buildWarnings: BUILD_WARNINGS,

    /* --- 편의 helper (set1.js 와 동일 시그니처) ----------------- */
    allQuestions: function () {
      var out = [];
      this.sections.forEach(function (sec) {
        sec.modules.forEach(function (mod) {
          mod.blocks.forEach(function (blk) {
            (blk.questions || []).forEach(function (q) {
              out.push({ q: q, block: blk, module: mod, section: sec });
            });
          });
        });
      });
      return out;
    },
    findQuestion: function (id) {
      var hit = null;
      this.allQuestions().forEach(function (e) { if (e.q.id === id) hit = e; });
      return hit;
    }
  };
})();
