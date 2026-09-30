/* =============================================================
 * SMEAG TOEFL — NEW TOEFL SET 1 문제 데이터
 * 원본: TOEFL MOCK TEST  SET 1/NEW TOEFL SET 1.docx
 *       TOEFL MOCK TEST  SET 1/ANSWER KEY SET 1.docx
 * 검증: tools/extract_set1.py --verify (원문 대조 + 정답 개수 확인)
 *
 * ⚠ 이 파일은 손으로 수정하지 말고, 수정 후에는 반드시 --verify 를 통과시킬 것.
 * ES module 아님 — <script src> 로 로드되어 window.SMEAG_SET1 을 정의한다.
 * ============================================================= */
(function () {
  'use strict';

  var AUDIO = 'TOEFL MOCK TEST  SET 1/SET 1 AUDIO/';
  var PICS = 'TOEFL LISTENING & WRITING PICTURES/';
  var SPK = 'app/assets/speaking/';

  /* --- Listening 유형별 삽화 (원본 PICTURES 폴더) ------------------ */
  var IMG = {
    q_male: PICS + 'TOEFL Listening Image (Single male).webp',
    q_male2: PICS + 'TOEFL Listening Image (Single male 2).webp',
    q_male3: PICS + 'TOEFL Listening Image (Single male 3).webp',
    q_female: PICS + 'TOEFL Listening Image (Single female).webp',
    q_female2: PICS + 'TOEFL Listening Image (Single female 2).webp',
    conv2: PICS + 'TOEFL Listening Image (2 Persons).webp',
    conv2b: PICS + 'TOEFL Listening Image (2 People).webp',
    talk: PICS + 'TOEFL Listening Image (Academic, Single female).webp'
  };

  /* 단문응답(Q1-7 / Q1-3) 화자 삽화.
   * 로테이션이 아니라 실제 오디오 음성에 맞춘 고정 매핑이다.
   * 각 mp3 의 기본주파수(F0) + MFCC 화자 유사도로 3명의 화자를 분류:
   *   여성A(고음, F0 ~230-290Hz) → q_female
   *   여성B(중음, F0 ~175-185Hz) → q_female2
   *   남성A(F0 ~110-140Hz)       → q_male
   * 오디오를 교체하면 이 표도 함께 갱신할 것. */
  var SPEAKER_BY_ITEM = {
    1: [IMG.q_female, IMG.q_male, IMG.q_female2, IMG.q_female, IMG.q_male, IMG.q_female, IMG.q_male],
    2: [IMG.q_male, IMG.q_female, IMG.q_female2]
  };

  function shortResponse(mod, no, choices, answer) {
    return {
      id: 'L' + mod + '-' + no,
      kind: 'mcq',
      layout: 'short-response',
      prompt: '오디오를 듣고 가장 알맞은 응답을 고르세요.',
      image: SPEAKER_BY_ITEM[mod][no - 1],
      audio: AUDIO + 'LISTENING/MODULE ' + mod + '/' + no + '.mp3',
      choices: choices,
      answer: answer
    };
  }

  /* =============================================================
   * READING
   * ============================================================= */
  var reading = {
    id: 'reading',
    label: 'Reading',
    labelKo: '리딩',
    timeLimitSec: 35 * 60,
    modules: [
      {
        id: 'R1',
        label: 'Reading Module 1',
        blocks: [
          {
            kind: 'cloze',
            heading: 'Questions 1-10',
            instruction: 'Fill in the blanks.',
            template:
              'Sleep is essential for physical health and cognitive function in humans. ' +
              'The {{1}} moves {{2}} different {{3}} of sleep throughout the night. ' +
              'During deep sleep, the body {{4}} tissues {{5}} {{6}} the immune {{7}}. ' +
              'REM sleep, when dreams occur, plays a {{8}} role in memory {{9}}. ' +
              'Adults typically {{10}} seven to nine hours of quality rest each night.',
            questions: [
              { id: 'R1-1', kind: 'blank', no: 1, hint: 'br', answer: 'brain' },
              { id: 'R1-2', kind: 'blank', no: 2, hint: 'in', answer: 'into' },
              { id: 'R1-3', kind: 'blank', no: 3, hint: 'sta', answer: 'stages' },
              { id: 'R1-4', kind: 'blank', no: 4, hint: 'rep', answer: 'repairs' },
              { id: 'R1-5', kind: 'blank', no: 5, hint: 'a', answer: 'and' },
              { id: 'R1-6', kind: 'blank', no: 6, hint: 'stren', answer: 'strengthens' },
              { id: 'R1-7', kind: 'blank', no: 7, hint: 'sys', answer: 'system' },
              { id: 'R1-8', kind: 'blank', no: 8, hint: 'crit', answer: 'critical' },
              { id: 'R1-9', kind: 'blank', no: 9, hint: 'consol', answer: 'consolidation' },
              { id: 'R1-10', kind: 'blank', no: 10, hint: 'req', answer: 'require' }
            ]
          },
          {
            kind: 'passage',
            heading: 'Questions 11-12',
            instruction: 'Read an email.',
            title: 'Subject: Community Garden Opening',
            paragraphs: [
              'Dear Ms. Alvarez,',
              'The Riverside Community Garden is now fully prepared and ready for use starting April 1. Garden space assignments will be emailed to registered members by March 25. Please bring your own seeds and gardening gloves. Water hoses and wheelbarrows are available at the tool shed.',
              'Best regards,',
              'Thomas Bergman\nCommunity Programs'
            ],
            questions: [
              {
                id: 'R1-11', kind: 'mcq', no: 11,
                prompt: 'What can be inferred about the garden?',
                choices: [
                  'It requires additional volunteers',
                  'It will open sometime next year',
                  'It is available for members to use',
                  'It will provide all the necessary gardening tools to the members'
                ],
                answer: 2
              },
              {
                id: 'R1-12', kind: 'mcq', no: 12,
                prompt: 'What will members receive before April 1?',
                choices: [
                  'Gardening equipment rental forms',
                  'Information about their assigned space',
                  'Instructions for purchasing seeds',
                  'Applications for new memberships'
                ],
                answer: 1
              }
            ]
          },
          {
            kind: 'chat',
            heading: 'Questions 13-15',
            instruction: 'Read a text message chain.',
            messages: [
              { name: 'Victor Okonkwo', time: '2:04 P.M.', side: 'left', text: 'Just got off the phone with finance. Due to the quarterly budget cuts, we need to reduce our training department spending by 15 percent immediately. This affects our upcoming leadership development program.' },
              { name: 'Sandra Reyes', time: '2:08 P.M.', side: 'right', text: 'That’s significant. The external facilitators alone account for about 40 percent of the program budget. Should we consider using internal trainers instead?' },
              { name: 'Marcus Webb', time: '2:08 P.M.', side: 'left', text: 'I could lead the communication skills module since I’ve done similar workshops before. That would save us the cost of one external speaker.' },
              { name: 'Victor Okonkwo', time: '2:12 P.M.', side: 'left', text: 'That would help. Sandra, can you review the catering contract? We originally planned for a full lunch service, but switching to a lighter refreshment option might also reduce costs.' },
              { name: 'Sandra Reyes', time: '2:15 P.M.', side: 'right', text: 'I’ll call the catering company this afternoon. They mentioned flexibility in their proposal. What about the venue?' },
              { name: 'Victor Okonkwo', time: '2:18 P.M.', side: 'left', text: 'Let’s keep the hotel venue. The professional setting is important for senior participants. Focus on the facilitators and catering first, and we’ll reassess if needed.' },
              { name: 'Marcus Webb', time: '2:21 P.M.', side: 'left', text: 'Understood. I’ll prepare an outline for my session and send it to you for approval by Thursday.' }
            ],
            questions: [
              {
                id: 'R1-13', kind: 'mcq', no: 13,
                prompt: 'What can be inferred about the leadership development program?',
                choices: [
                  'It is planned to take place outside the office',
                  'It has been canceled due to budget constraints',
                  'It will only include internal company trainers',
                  'It was scheduled to happen in a previous quarter'
                ],
                answer: 0
              },
              {
                id: 'R1-14', kind: 'mcq', no: 14,
                prompt: 'What is Mr. Webb’s responsibility in addressing the budget issue?',
                choices: [
                  'Renegotiating the venue contract with the hotel',
                  'Calculating the total amount of budget reduction needed',
                  'Reviewing the catering company’s proposal',
                  'Preparing a training session to reduce facilitators costs'
                ],
                answer: 3
              },
              {
                id: 'R1-15', kind: 'mcq', no: 15,
                prompt: 'What does Victor Okonkwo imply when he writes, “Let’s keep the hotel venue”?',
                choices: [
                  'He believes the hotel offers the lowest price',
                  'He thinks the location contributes to the program’s quality',
                  'He has already signed a non-refundable contract',
                  'He believes moving venues would confuse participants'
                ],
                answer: 1
              }
            ]
          },
          {
            kind: 'passage',
            heading: 'Questions 16-20',
            instruction: 'Read a passage.',
            title: 'Roman Roads',
            paragraphs: [
              'At its height, the Roman Empire maintained over eighty thousand kilometers of paved roads stretching from Britain to Mesopotamia. These highways served primarily military purposes, allowing legions to march quickly to trouble spots anywhere in the empire. The roads also transformed commerce and cultural exchange across three continents.',
              'Roman engineers developed sophisticated construction techniques that made their roads remarkably durable. Workers first excavated a trench and filled it with layers of progressively finer materials: large stones at the bottom, then gravel, then sand, topped with carefully fitted paving stones that created a smooth surface. The roads curved slightly upward at the center, allowing rainwater to drain into ditches along the sides and preventing the accumulation of standing water that would erode the foundation.',
              'Building and maintaining this vast network demanded enormous resources that only a powerful central government could provide. {{A}} Each major road required thousands of workers and years of construction. {{B}} Local communities bore responsibility for upkeep within their territories, a burden that sometimes sparked resentment. {{C}} When the empire weakened in later centuries, maintenance declined and many roads fell into despair. {{D}} Some routes, however, remained in use through the medieval period and formed the basis for modern European highways.'
            ],
            questions: [
              {
                id: 'R1-16', kind: 'mcq', no: 16,
                prompt: 'The word “sophisticated” in the passage is closest in meaning to:',
                choices: ['traditional', 'experimental', 'simple', 'advanced'],
                answer: 3
              },
              {
                id: 'R1-17', kind: 'mcq', no: 17,
                prompt: 'What was the primary purpose of Roman roads?',
                choices: [
                  'To display the architectural achievements of Roman engineers',
                  'To connect religious sites throughout Roman territories',
                  'To enable rapid military movement across the empire',
                  'To facilitate the construction of new cities'
                ],
                answer: 2
              },
              {
                id: 'R1-18', kind: 'mcq', no: 18,
                prompt: 'How did Roman engineers prevent water damage to their roads?',
                choices: [
                  'They used waterproof materials imported from other regions',
                  'They applied protective coatings to the paving stones regularly',
                  'They constructed underground tunnels to channel water away',
                  'They built the road surface to curve upward in the center for drainage'
                ],
                answer: 3
              },
              {
                id: 'R1-19', kind: 'mcq', no: 19,
                prompt: 'Why does the author mention “large stones at the bottom, then gravel, then sand”?',
                choices: [
                  'To describe the layered construction method that made roads durable',
                  'To compare Roman roads with modern highway construction',
                  'To explain why roads were expensive for local communities to maintain',
                  'To show the materials Romans imported from distant provinces'
                ],
                answer: 0
              },
              {
                id: 'R1-20', kind: 'insert', no: 20,
                prompt: 'Look at the four letters (A, B, C, and D) in the passage that indicate where the following sentence could be added. Where would the sentence best fit?',
                sentence: '“Completing each road required coordination across multiple provinces.”',
                choices: ['Position A', 'Position B', 'Position C', 'Position D'],
                answer: 1
              }
            ]
          }
        ]
      },
      {
        id: 'R2',
        label: 'Reading Module 2',
        blocks: [
          {
            kind: 'cloze',
            heading: 'Questions 1-10',
            instruction: 'Fill in the blanks.',
            template:
              'Desert plants have evolved remarkable adaptations that enable survival in extremely harsh conditions. ' +
              'Cacti store water in {{1}} thick stems and have {{2}} leaves to minimize {{3}} loss. ' +
              'Many desert {{4}} develop {{5}} root systems that reach deep underground water sources. ' +
              'Some plants remain {{6}} as seeds until rainfall {{7}} their rapid growth. ' +
              'These {{8}} {{9}} demonstrate {{10}} organisms can thrive where resources are severely limited.',
            questions: [
              { id: 'R2-1', kind: 'blank', no: 1, hint: 'th', answer: 'their' },
              { id: 'R2-2', kind: 'blank', no: 2, hint: 'red', answer: 'reduced' },
              { id: 'R2-3', kind: 'blank', no: 3, hint: 'mois', answer: 'moisture' },
              { id: 'R2-4', kind: 'blank', no: 4, hint: 'spe', answer: 'species' },
              { id: 'R2-5', kind: 'blank', no: 5, hint: 'exte', answer: 'extensive' },
              { id: 'R2-6', kind: 'blank', no: 6, hint: 'dor', answer: 'dormant' },
              { id: 'R2-7', kind: 'blank', no: 7, hint: 'trig', answer: 'triggers' },
              { id: 'R2-8', kind: 'blank', no: 8, hint: 'surv', answer: 'survival' },
              { id: 'R2-9', kind: 'blank', no: 9, hint: 'strat', answer: 'strategies' },
              { id: 'R2-10', kind: 'blank', no: 10, hint: 'h', answer: 'how' }
            ]
          },
          {
            kind: 'passage',
            heading: 'Questions 11-15',
            instruction: 'Read a passage.',
            title: 'Ancient Irrigation Systems',
            paragraphs: [
              'Ancient Mesopotamian civilizations developed sophisticated irrigation systems that transformed arid river valleys into productive agricultural land. Beginning around 6000 BCE, farmers in the region between the Tigris and Euphrates rivers constructed canals to divert floodwaters onto their fields. This innovation allowed populations to grow beyond what rainfall alone could support, laying the foundation for the world’s earliest cities.',
              'The Sumerians refined these techniques into elaborate networks of primary canals, secondary channels, and distribution gates. Engineers calculated precise gradients to maintain steady water flow across distances of many kilometers without mechanical pumps. Storage basins collected excess water during floods for release during dry months. Records on clay tablets show that dedicated officials managed water allocation, resolving disputes between farmers and ensuring equitable distribution throughout the growing season.',
              'Despite their ingenuity, these systems faced persistent challenges. Irrigated fields gradually accumulated salt as water evaporated and left minerals behind, reducing soil fertility over centuries of continuous cultivation. Silt buildup required constant canal maintenance, demanding substantial labor from the population. Political instability could interrupt this maintenance, sometimes causing rapid agricultural decline. These vulnerabilities help explain why several Mesopotamian city-states experienced dramatic population collapses even at the height of their technological sophistication.'
            ],
            questions: [
              {
                id: 'R2-11', kind: 'mcq', no: 11,
                prompt: 'The word “equitable” in paragraph 2 is closest in meaning to',
                choices: ['fair', 'rapid', 'limited', 'seasonal'],
                answer: 0
              },
              {
                id: 'R2-12', kind: 'mcq', no: 12,
                prompt: 'According to paragraph 2, how did Sumerian engineers achieve water flow across long distances?',
                choices: [
                  'They invented mechanical pumps powered by animal labor',
                  'They sustained water flow by establishing specific gradients',
                  'They constructed elevated aqueducts above ground level',
                  'They relied entirely on natural river currents'
                ],
                answer: 1
              },
              {
                id: 'R2-13', kind: 'mcq', no: 13,
                prompt: 'Why does the author mention clay tablets in paragraph 2?',
                choices: [
                  'To demonstrate how Sumerians learned mathematical calculations',
                  'To describe the materials used to construct canal walls',
                  'To offer evidence that water distribution was officially managed',
                  'To compare Sumerian writing with that of other ancient cultures'
                ],
                answer: 2
              },
              {
                id: 'R2-14', kind: 'mcq', no: 14,
                prompt: 'All of the following are mentioned as challenges to Mesopotamian irrigation EXCEPT:',
                choices: [
                  'Salt accumulation in irrigated fields over time',
                  'The need for constant clearing of silt from canals',
                  'Political instability that could disrupt maintenance efforts',
                  'Flooding that destroyed canal infrastructure each year'
                ],
                answer: 3
              },
              {
                id: 'R2-15', kind: 'mcq', no: 15,
                prompt: 'What is the main function of paragraph 3?',
                choices: [
                  'To describe the construction techniques used for building canals',
                  'To explain the problems that threatened irrigation systems’ viability',
                  'To compare Mesopotamian agriculture with modern farming methods',
                  'To argue that irrigation was unnecessary for Mesopotamian survival'
                ],
                answer: 1
              }
            ]
          }
        ]
      }
    ]
  };

  /* =============================================================
   * LISTENING  (오디오 1회 재생)
   * ============================================================= */
  var listening = {
    id: 'listening',
    label: 'Listening',
    labelKo: '리스닝',
    timeLimitSec: null, // 오디오 진행형 — 문항별 진행
    modules: [
      {
        id: 'L1',
        label: 'Listening Module 1',
        blocks: [
          {
            kind: 'audio-set',
            heading: 'Questions 1-7',
            instruction: 'Listen to the question and select the best response from the choices.',
            perQuestionAudio: true,
            questions: [
              shortResponse(1, 1, ['The restaurant has great reviews.', 'I made some changes to the document.', 'I was just about to.', 'The museum closes at five.'], 2),
              shortResponse(1, 2, ['I’ll pick it up myself.', 'I picked up a cold last week.', 'The delivery arrived damaged.', 'My bike needs new tires.'], 0),
              shortResponse(1, 3, ['I went jogging this morning.', 'What format is it in?', 'The file cabinet is full.', 'The presentation went smoothly.'], 1),
              shortResponse(1, 4, ['I think it moved to the library.', 'The building will be renovated next year.', 'The recipe calls for two eggs.', 'I centered the image in the document.'], 0),
              shortResponse(1, 5, ['I reminded her about the party.', 'The meeting was productive.', 'I’m afraid I don’t remember.', 'I’m craving Italian food.'], 2),
              shortResponse(1, 6, ['The beach was crowded.', 'The supplies arrived yesterday.', 'I ordered a pizza for lunch.', 'Jake from accounting.'], 3),
              shortResponse(1, 7, ['Let me pull it up now.', 'I checked my email this morning.', 'The movie got great reviews.', 'The curriculum is very detailed.'], 0)
            ]
          },
          {
            kind: 'audio-set',
            heading: 'Question 8',
            instruction: 'Listen to a conversation.',
            audio: AUDIO + 'LISTENING/MODULE 1/8 - Conversation 1.mp3',
            image: IMG.conv2,
            questions: [
              {
                id: 'L1-8', kind: 'mcq', no: 8,
                prompt: 'What does the man say about his assignment?',
                choices: [
                  'It involves more work than planned.',
                  'It requires special training.',
                  'It conflicts with another commitment.',
                  'It was changed from what he expected.'
                ],
                answer: 3
              }
            ]
          },
          {
            kind: 'audio-set',
            heading: 'Questions 9-10',
            instruction: 'Listen to a conversation.',
            audio: AUDIO + 'LISTENING/MODULE 1/9 -10 -Conversation 2.mp3',
            image: IMG.conv2b,
            questions: [
              {
                id: 'L1-9', kind: 'mcq', no: 9,
                prompt: 'Why is the man concerned?',
                choices: [
                  'He cannot afford the textbook.',
                  'He purchased the wrong textbook.',
                  'He lost his textbook prior to class.',
                  'He missed the return deadline for a textbook.'
                ],
                answer: 1
              },
              {
                id: 'L1-10', kind: 'mcq', no: 10,
                prompt: 'What does the woman offer to do?',
                choices: [
                  'Return the book on his behalf',
                  'Lend him money for a new book',
                  'Contact someone who might help',
                  'Speak to the professor about the issue'
                ],
                answer: 2
              }
            ]
          },
          {
            kind: 'audio-set',
            heading: 'Questions 11-12',
            instruction: 'Listen to an announcement.',
            audio: AUDIO + 'LISTENING/MODULE 1/11-12 Announcement.mp3',
            image: IMG.q_female2,
            questions: [
              {
                id: 'L1-11', kind: 'mcq', no: 11,
                prompt: 'What is the main purpose of the announcement?',
                choices: [
                  'To notify students of a temporary network outage',
                  'To promote a new internet service provider',
                  'To explain how to connect to the campus WiFi',
                  'To announce permanent changes to internet policies'
                ],
                answer: 0
              },
              {
                id: 'L1-12', kind: 'mcq', no: 12,
                prompt: 'What should students do according to the announcement?',
                choices: [
                  'Report any current connectivity problems',
                  'Register their devices with the IT department',
                  'Download needed materials before Friday evening',
                  'Avoid using campus computers until Monday'
                ],
                answer: 2
              }
            ]
          },
          {
            kind: 'audio-set',
            heading: 'Questions 13-14',
            instruction: 'Listen to an announcement.',
            audio: AUDIO + 'LISTENING/MODULE 1/13 -14 Announcement.mp3',
            image: IMG.q_male2,
            questions: [
              {
                id: 'L1-13', kind: 'mcq', no: 13,
                prompt: 'Which of the following is true about the symposium?',
                choices: [
                  'Only science majors may participate',
                  'Team projects are not permitted this year',
                  'Poster presentations are a new addition',
                  'Faculty feedback is available only for finalists'
                ],
                answer: 2
              },
              {
                id: 'L1-14', kind: 'mcq', no: 14,
                prompt: 'What should a student submit when signing up?',
                choices: [
                  'A completed research paper and presentation slides',
                  'A video recording of their presentation',
                  'Three recommendation letters from professors',
                  'A project abstract and faculty advisor’s signature'
                ],
                answer: 3
              }
            ]
          },
          {
            kind: 'audio-set',
            heading: 'Questions 15-18',
            instruction: 'Listen to a talk.',
            audio: AUDIO + 'LISTENING/MODULE 1/15 -18 Academic talk.mp3',
            image: IMG.q_male3, // 남성 화자 오디오 (F0 ~143Hz)
            questions: [
              {
                id: 'L1-15', kind: 'mcq', no: 15,
                prompt: 'What is the main topic of the talk?',
                choices: [
                  'The history of earthquake prediction methods',
                  'How tectonic plate movement causes earthquakes',
                  'Why some regions have more earthquakes than others',
                  'The damage earthquakes cause to buildings'
                ],
                answer: 1
              },
              {
                id: 'L1-16', kind: 'mcq', no: 16,
                prompt: 'According to the speaker, what happens at plate boundaries?',
                choices: [
                  'New rock is constantly being formed',
                  'Plates move quickly and unpredictably',
                  'Friction and stress build up between plates',
                  'Seismic waves originate from the surface'
                ],
                answer: 2
              },
              {
                id: 'L1-17', kind: 'mcq', no: 17,
                prompt: 'Why does the speaker explain the difference between focus and epicenter?',
                choices: [
                  'To clarify where earthquake shaking is strongest',
                  'To compare two types of seismic waves',
                  'To explain why some earthquakes are not felt',
                  'To describe how scientists measure earthquakes'
                ],
                answer: 0
              },
              {
                id: 'L1-18', kind: 'mcq', no: 18,
                prompt: 'What can be inferred about earthquake intensity?',
                choices: [
                  'It is determined by a single factor',
                  'Deeper earthquakes always cause more damage',
                  'It might be predicted based on the depth of the focus',
                  'Scientists cannot measure earthquake intensity accurately'
                ],
                answer: 2
              }
            ]
          }
        ]
      },
      {
        id: 'L2',
        label: 'Listening Module 2',
        blocks: [
          {
            kind: 'audio-set',
            heading: 'Questions 1-3',
            instruction: 'Listen to the question and select the best response from the choices.',
            perQuestionAudio: true,
            questions: [
              shortResponse(2, 1, ['I got a new laptop yesterday.', 'The feedback was very helpful.', 'Not yet-my advisor’s been traveling.', 'The draft is almost finished.'], 2),
              shortResponse(2, 2, ['The sugar bowl is empty.', 'Neither, thanks.', 'I bought cream cheese yesterday.', 'The train was delayed.'], 1),
              shortResponse(2, 3, ['I’ll grab one from the supply room.', 'I heard they’re getting rid of the printer.', 'I replaced my phone screen last week.', 'The weather’s supposed to clear up.'], 0)
            ]
          },
          {
            kind: 'audio-set',
            heading: 'Questions 4-5',
            instruction: 'Listen to a conversation.',
            audio: AUDIO + 'LISTENING/MODULE 2/4 -5 Conversation 1.mp3',
            image: IMG.conv2,
            questions: [
              {
                id: 'L2-4', kind: 'mcq', no: 4,
                prompt: 'What is the woman describing?',
                choices: [
                  'A new area on campus',
                  'A renovated coffee shop',
                  'An off-campus office rental',
                  'A technology workshop space'
                ],
                answer: 0
              },
              {
                id: 'L2-5', kind: 'mcq', no: 5,
                prompt: 'What does the woman say about the cost of using the space?',
                choices: [
                  'It is partly included in tuition fees.',
                  'The space is currently free, but this may change.',
                  'It has always required an annual subscription.',
                  'It varies depending on the amenities used.'
                ],
                answer: 1
              }
            ]
          },
          {
            kind: 'audio-set',
            heading: 'Questions 6-7',
            instruction: 'Listen to a conversation.',
            audio: AUDIO + 'LISTENING/MODULE 2/6 - 7 Conversation 2.mp3',
            image: IMG.conv2b,
            questions: [
              {
                id: 'L2-6', kind: 'mcq', no: 6,
                prompt: 'What does the woman suggest about the workshop?',
                choices: [
                  'It costs more than expected.',
                  'It requires prior experience.',
                  'It has been rescheduled.',
                  'It may reach capacity soon.'
                ],
                answer: 3
              },
              {
                id: 'L2-7', kind: 'mcq', no: 7,
                prompt: 'What does the woman advise the man to do?',
                choices: [
                  'Bring his own supplies',
                  'Arrive early to the session',
                  'Wear appropriate clothing',
                  'Watch an instructional video first'
                ],
                answer: 2
              }
            ]
          },
          {
            kind: 'audio-set',
            heading: 'Questions 8-11',
            instruction: 'Listen to a talk.',
            audio: AUDIO + 'LISTENING/MODULE 2/8 -11 Academic Talk 1.mp3',
            image: IMG.talk,
            questions: [
              {
                id: 'L2-8', kind: 'mcq', no: 8,
                prompt: 'What is the main topic of the talk?',
                choices: [
                  'The dangers of carbon dioxide emissions',
                  'How the greenhouse effect works',
                  'Methods to reduce global warming',
                  'The difference between light and radiation'
                ],
                answer: 1
              },
              {
                id: 'L2-9', kind: 'mcq', no: 9,
                prompt: 'According to the speaker, what role do greenhouse gases play?',
                choices: [
                  'They block sunlight from reaching Earth',
                  'They create holes in the ozone layer',
                  'They cool the atmosphere at night',
                  'They absorb and re-release infrared radiation'
                ],
                answer: 3
              },
              {
                id: 'L2-10', kind: 'mcq', no: 10,
                prompt: 'Why does the speaker mention that Earth would be minus eighteen degrees Celsius without the greenhouse effect?',
                choices: [
                  'To show that the natural greenhouse effect is beneficial',
                  'To argue that climate change is not a serious problem',
                  'To explain why polar regions are so cold',
                  'To compare Earth with other planets'
                ],
                answer: 0
              },
              {
                id: 'L2-11', kind: 'mcq', no: 11,
                prompt: 'What can be inferred about the “enhanced greenhouse effect”?',
                choices: [
                  'It is a natural cycle that occurs every century',
                  'It could have disastrous consequences',
                  'It rarely affects industrial regions of the world',
                  'It will eventually correct itself without intervention'
                ],
                answer: 1
              }
            ]
          },
          {
            kind: 'audio-set',
            heading: 'Questions 12-15',
            instruction: 'Listen to a talk.',
            audio: AUDIO + 'LISTENING/MODULE 2/12 -15 Academic Talk 2.mp3',
            image: IMG.q_male2, // 13-14 Announcement 과 동일 남성 화자
            questions: [
              {
                id: 'L2-12', kind: 'mcq', no: 12,
                prompt: 'What is the main topic of the talk?',
                choices: [
                  'The history of moral philosophy',
                  'The works of Immanuel Kant',
                  'Two frameworks of ethics',
                  'How to resolve ethical dilemmas'
                ],
                answer: 2
              },
              {
                id: 'L2-13', kind: 'mcq', no: 13,
                prompt: 'According to the speaker, what do utilitarians emphasize when making moral decisions?',
                choices: [
                  'Following absolute rules',
                  'Maintaining personal integrity',
                  'The results of actions',
                  'Traditional moral values'
                ],
                answer: 2
              },
              {
                id: 'L2-14', kind: 'mcq', no: 14,
                prompt: 'What can be inferred about deontology?',
                choices: [
                  'It prioritizes flexibility over consistency',
                  'It would permit lying in certain circumstances',
                  'It might conflict with one’s self-interest',
                  'It was developed after utilitarian philosophy'
                ],
                answer: 2
              },
              {
                id: 'L2-15', kind: 'mcq', no: 15,
                prompt: 'Why does the speaker mention hiding someone from danger?',
                choices: [
                  'To explain the origins of deontology',
                  'To show a situation where the two frameworks conflict',
                  'To argue that utilitarianism is generally seen as superior',
                  'To describe Kant’s most famous example'
                ],
                answer: 1
              }
            ]
          }
        ]
      }
    ]
  };

  /* =============================================================
   * WRITING
   * slots: 'fixed' = 화면에 고정 표시, 'blank' = 타일을 끼우는 자리
   * blank 순서대로 answerTokens 와 1:1 대응
   * ============================================================= */
  function build(no, context, slots, tiles, sentence) {
    return {
      id: 'W-' + no, kind: 'build', no: no,
      context: context, slots: slots, tiles: tiles, sentence: sentence,
      answerTokens: slots.filter(function (s) { return s.t === 'b'; }).map(function (s) { return s.a; })
    };
  }
  function F(text) { return { t: 'f', text: text }; }
  function B(answer) { return { t: 'b', a: answer }; }

  var writing = {
    id: 'writing',
    label: 'Writing',
    labelKo: '라이팅',
    timeLimitSec: null,
    modules: [
      {
        id: 'W1',
        label: 'Build a Sentence',
        timeLimitSec: 10 * 60,
        blocks: [
          {
            kind: 'build-set',
            heading: 'Questions 1-10',
            instruction: 'Make an appropriate sentence.',
            questions: [
              build(1, 'What time did the flight land?',
                [F('It arrived'), B('around'), B('noon'), F('.')],
                ['noon', 'around'],
                'It arrived around noon.'),
              build(2, 'How was the cooking class you took last weekend?',
                [F('I finally'), B('learned'), B('how'), B('to make'), B('fresh'), B('pasta'), B('from scratch'), F('.')],
                ['fresh', 'how', 'from scratch', 'pasta', 'to make', 'learned'],
                'I finally learned how to make fresh pasta from scratch.'),
              build(3, 'I need to get a birthday gift for my nephew.',
                [B('Why'), B('don’t'), B('you'), B('check'), B('out'), F('the toy store'), B('near'), F('the mall?')],
                ['check', 'near', 'you', 'don’t', 'why', 'out'],
                'Why don’t you check out the toy store near the mall?'),
              build(4, 'The traffic was terrible this morning.',
                [B('That'), B('is'), B('why'), B('I'), B('always'), B('take'), B('the train'), F('.')],
                ['is', 'always', 'the train', 'why', 'I', 'that', 'take'],
                'That is why I always take the train.'),
              build(5, 'My neighbor has been renovating his house for months.',
                [F('Do you'), B('know'), B('when'), B('he'), B('expects'), B('to finish'), B('the construction'), F('?')],
                ['the construction', 'expects', 'when', 'he', 'know', 'to finish'],
                'Do you know when he expects to finish the construction?'),
              build(6, 'Did you see the documentary about climate change?',
                [B('Yes'), F(','), B('it'), F('made'), B('me'), B('realize'), B('how'), B('serious'), B('the problem'), B('actually'), F('is.')],
                ['yes', 'the problem', 'me', 'serious', 'actually', 'how', 'it', 'realize'],
                'Yes, it made me realize how serious the problem actually is.'),
              build(7, 'I saw you talking to the new intern at lunch.',
                [F('She'), B('asked'), B('if'), B('I'), B('could'), B('show'), B('her'), B('around'), F('the office.')],
                ['show', 'I', 'her', 'asked', 'around', 'if', 'could'],
                'She asked if I could show her around the office.'),
              build(8, 'The team lead sent out the new schedule this morning.',
                [B('Did'), B('she'), F('say'), B('why'), B('the deadline'), B('was'), B('moved'), B('forward'), F('?')],
                ['the deadline', 'did', 'was', 'why', 'forward', 'moved', 'she'],
                'Did she say why the deadline was moved forward?'),
              build(9, 'The professor mentioned something about extra credit today.',
                [B('Did'), B('she'), F('explain'), B('what'), B('students'), B('need'), B('to do'), B('to earn'), B('the additional'), F('points?')],
                ['she', 'the additional', 'did', 'need', 'to do', 'students', 'what', 'to earn'],
                'Did she explain what students need to do to earn the additional points?'),
              build(10, 'I heard you helped organize the charity event at your company.',
                [B('Would'), B('you'), B('like'), B('to know'), F('how'), B('many people'), B('ended up'), B('volunteering'), B('for the'), F('fundraiser?')],
                ['would', 'volunteering', 'many people', 'to know', 'like', 'for the', 'you', 'ended up'],
                'Would you like to know how many people ended up volunteering for the fundraiser?')
            ]
          }
        ]
      },
      {
        id: 'W2',
        label: 'Write an Email',
        timeLimitSec: 10 * 60,
        blocks: [
          {
            kind: 'free-write',
            heading: 'WRITE AN EMAIL',
            questions: [
              {
                id: 'W-EMAIL', kind: 'email', no: 11,
                to: 'editor@horizonliterarymagazine.com',
                subject: 'Problem Using Submission Form',
                situationLabel: 'SITUATION',
                situation: 'A literary magazine has invited readers to submit short stories for publication. You decided to submit one of your stories using their online submission form. However, after clicking the submit button, you received an error message and are unsure whether your submission was received.',
                bulletsLabel: 'YOUR EMAIL SHOULD',
                bullets: [
                  'Tell the editor what you appreciate about the magazine',
                  'Describe the problem you experienced while using the submission form',
                  'Ask about the status of your submission'
                ],
                minWords: 80
              }
            ]
          }
        ]
      },
      {
        id: 'W3',
        label: 'Write for an Academic Discussion',
        timeLimitSec: 10 * 60,
        blocks: [
          {
            kind: 'free-write',
            heading: 'WRITE for an ACADEMIC DISCUSSION',
            questions: [
              {
                id: 'W-DISC', kind: 'discussion', no: 12,
                professor: 'Professor Gupta – Education',
                prompt: 'This week, we’ll be discussing exam formats, specifically the use of open-books exams versus closed-books exams. Some educators argue that open-book exams better reflect real-world problem-solving skills, while others believe that closed-book exams encourage deeper learning and better memory retention. In your opinion, which type of exam is more beneficial for students?',
                posts: [
                  { name: 'Lena', text: 'I believe open-book exams are more beneficial. In real-life situations, people have access to resources when solving problems, so it makes sense to allow students to use their notes or textbooks. Open-book exams encourage critical thinking, as students need to apply the material rather than just memorize it. This type of assessment is more reflective of real-world problem-solving.' },
                  { name: 'Omar', text: 'I think closed-book exams are better for student learning. They encourage students to study and truly understand the material, rather than relying on their ability to look up information during the test. Closed-book exams test a student’s knowledge and memory, helping them retain information longer. It’s a more rigorous way of assessing what students have learned.' }
                ],
                minWords: 100
              }
            ]
          }
        ]
      }
    ]
  };

  /* =============================================================
   * SPEAKING  (녹음 제출 — 자동 채점 없음)
   * ============================================================= */
  function repeatQ(no) {
    return {
      id: 'S-' + no, kind: 'repeat', no: no,
      audio: AUDIO + 'SPEAKING/' + no + '.mp3',
      image: SPK + 'image' + no + '.png',
      prepSec: 3, respondSec: 20
    };
  }
  function interviewQ(no, file) {
    return {
      id: 'S-' + no, kind: 'interview', no: no,
      audio: AUDIO + 'SPEAKING/' + file,
      image: SPK + 'image8.png',
      prepSec: 3, respondSec: 45
    };
  }

  var speaking = {
    id: 'speaking',
    label: 'Speaking',
    labelKo: '스피킹',
    timeLimitSec: null,
    modules: [
      {
        id: 'S1',
        label: 'Task 1 · Listen and Repeat',
        blocks: [
          {
            kind: 'record-set',
            heading: 'Task 1',
            instruction: 'Listen and Repeat',
            introAudio: AUDIO + 'SPEAKING/Listen and Repeat Instructions.mp3',
            questions: [repeatQ(1), repeatQ(2), repeatQ(3), repeatQ(4), repeatQ(5), repeatQ(6), repeatQ(7)]
          }
        ]
      },
      {
        id: 'S2',
        label: 'Task 2 · Interview',
        blocks: [
          {
            kind: 'record-set',
            heading: 'Task 2',
            instruction: 'Answer the interviewer’s questions.',
            introAudio: AUDIO + 'SPEAKING/Interview Instructions.mp3',
            questions: [
              interviewQ(8, 'Interview 1.mp3'),
              interviewQ(9, 'Interview 2.mp3'),
              interviewQ(10, 'Interview 3.mp3'),
              interviewQ(11, 'Interview 4.mp3')
            ]
          }
        ]
      }
    ]
  };

  window.SMEAG_SET1 = {
    code: 'SET1',
    title: 'NEW TOEFL SET 1',
    paths: { audio: AUDIO, pics: PICS, speaking: SPK },
    sections: [reading, listening, writing, speaking],

    /* --- 편의 helper ------------------------------------------- */
    allQuestions: function () {
      var out = [];
      this.sections.forEach(function (sec) {
        sec.modules.forEach(function (mod) {
          mod.blocks.forEach(function (blk) {
            blk.questions.forEach(function (q) {
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
