/* =============================================================
 * SMEAG · StudyGround 2.0 — IELTS Academic 샘플 콘텐츠 팩 (Story 6.1/6.2/6.3 구조 검증용)
 *
 * 스키마는 assets/set1.js(window.SMEAG_SET1)와 **동일**하다.
 *   sections[] → modules[] → blocks[] → questions[]
 *   block.kind ∈ {cloze, passage, chat, free-write, build-set, audio-set, record-set}
 * 모듈 id 는 config/timing.ielts.json 의 sections.*.modules[].id / tasks[].id 와 1:1 로 맞춘다
 *   listening P1–P4 · reading PASSAGE1–3 · writing TASK1/TASK2 · speaking SP1–SP3
 *
 * ⚠ 문항은 전부 자체 창작이다. 실제 IELTS 기출을 옮겨 적지 않았다.
 *   목적은 "IELTS 프로파일이 TOEFL 런타임을 한 줄도 포크하지 않고 컴파일되는가"의 구조 검증이며,
 *   각 파트 2문항(Speaking Part 2 는 성격상 1문항)만 담는다.
 *
 * ⚠ 미디어(오디오·차트 이미지)는 아직 제작되지 않았다. audio 경로는 media/ielts/** 로
 *   예약만 해 두었고 파일은 없다 — SG_MEDIA.isMapped 는 통과하지만 실제 재생은 404 다.
 *   렌더러는 오디오 404 에서도 다음 단계로 넘어간다(F12)이라 구조 검증에는 지장이 없다.
 *
 * ES module 아님 — <script src> 로 로드되어 window.SMEAG_IELTS_SAMPLE 을 정의한다.
 * 렌더러들이 콘텐츠를 window.SMEAG_SET1 에서 읽으므로, 이 팩으로 실제 시험을 구동하려면
 * 로드 후 window.SMEAG_IELTS_SAMPLE.install() 을 한 번 호출한다(자동 설치하지 않는다).
 * ============================================================= */
(function () {
  'use strict';

  var AUDIO = 'media/ielts/audio/';   // 이미 배포형 경로 — SG_MEDIA 리맵 대상 아님

  function mcq(id, no, prompt, choices, answer) {
    return { id: id, kind: 'mcq', no: no, prompt: prompt, choices: choices, answer: answer };
  }

  /* --- Listening: 4파트 · 파트당 2문항 (총 8) ---------------------- */

  function listenPart(no, label, heading, instruction, audioFile, questions) {
    return {
      id: 'P' + no,
      label: label,
      blocks: [
        {
          kind: 'audio-set',
          heading: heading,
          instruction: instruction,
          audio: AUDIO + audioFile,
          perQuestionAudio: false,
          questions: questions
        }
      ]
    };
  }

  var listening = {
    id: 'listening',
    label: 'Listening',
    labelKo: '리스닝',
    modules: [
      listenPart(1, 'Part 1 · Everyday conversation', 'Questions 1-2',
        'Listen to a conversation between a new resident and a receptionist at a community sports centre.',
        'part1-sports-centre.mp3', [
          mcq('IL-1', 1, 'Why does the woman prefer the evening membership?', [
            'It costs less than the full membership',
            'It includes the swimming pool',
            'It matches her working hours',
            'It can be paid monthly'
          ], 2),
          mcq('IL-2', 2, 'What does the receptionist ask her to bring on her first visit?', [
            'A passport photograph',
            'Proof of her address',
            'A medical certificate',
            'Her employment contract'
          ], 1)
        ]),
      listenPart(2, 'Part 2 · Monologue on a local topic', 'Questions 3-4',
        'Listen to a talk about a city recycling scheme.',
        'part2-recycling-scheme.mp3', [
          mcq('IL-3', 3, 'What change to the collection service is announced?', [
            'Collections will move from Monday to Thursday',
            'Glass will be collected separately from paper',
            'Households will pay a small annual fee',
            'Garden waste will no longer be collected'
          ], 1),
          mcq('IL-4', 4, 'According to the speaker, what has been the main obstacle so far?', [
            'A shortage of collection vehicles',
            'Confusion about which bin to use',
            'Opposition from local businesses',
            'The cost of the new containers'
          ], 1)
        ]),
      listenPart(3, 'Part 3 · Academic discussion', 'Questions 5-6',
        'Listen to two students discussing the plan for a research project.',
        'part3-project-discussion.mp3', [
          mcq('IL-5', 5, 'What do the students decide to change about their method?', [
            'They will interview fewer people but for longer',
            'They will replace interviews with a questionnaire',
            'They will collect data over two terms instead of one',
            'They will ask their tutor to select the participants'
          ], 0),
          mcq('IL-6', 6, 'What is the man still worried about?', [
            'Finding enough published sources',
            'Getting ethical approval in time',
            'The cost of transcribing the recordings',
            'His partner’s availability in the holidays'
          ], 1)
        ]),
      listenPart(4, 'Part 4 · Academic lecture', 'Questions 7-8',
        'Listen to part of a lecture about urban beekeeping.',
        'part4-urban-beekeeping.mp3', [
          mcq('IL-7', 7, 'What surprised researchers about city hives?', [
            'They produced less honey than rural hives',
            'They survived the winter more often than rural hives',
            'They attracted a narrower range of plant species',
            'They needed feeding throughout the summer'
          ], 1),
          mcq('IL-8', 8, 'What does the lecturer recommend for new urban beekeepers?', [
            'Keeping no more than two hives at first',
            'Placing hives at ground level',
            'Registering the hives with a national database',
            'Harvesting honey only in early spring'
          ], 2)
        ])
    ]
  };

  /* --- Reading: 3지문 · 지문당 2문항 (총 6) ------------------------ */

  function readingPassage(id, label, heading, title, paragraphs, questions) {
    return {
      id: id,
      label: label,
      blocks: [
        {
          kind: 'passage',
          heading: heading,
          instruction: 'Read the passage and answer the questions that follow.',
          title: title,
          paragraphs: paragraphs,
          questions: questions
        }
      ]
    };
  }

  var reading = {
    id: 'reading',
    label: 'Reading',
    labelKo: '리딩',
    modules: [
      readingPassage('PASSAGE1', 'Passage 1', 'Questions 1-2', 'The Return of the Urban Tram', [
        'For most of the twentieth century the tram was treated as an obstacle. Cities that had laid tracks in the 1890s tore them up in the 1950s, convinced that buses were cheaper and that private cars were the future. Within three decades the same cities were rebuilding what they had removed, and at a far higher price than the original construction.',
        'The argument that finally persuaded planners was not nostalgia but capacity. A modern tram carrying two hundred passengers occupies roughly the road space of four cars. Where a corridor is already congested, replacing car journeys with tram journeys frees space that no amount of road widening can create, because widened roads are refilled by the traffic they attract.',
        'The objection is cost. A kilometre of tramway costs many times a kilometre of bus lane, and the money is spent before a single passenger is carried. Supporters answer that the permanence of the rails is precisely the point: a bus route can be cancelled by a memo, so nobody builds a flat beside one, whereas developers will invest along a line that is visibly fixed in concrete.'
      ], [
        mcq('IR-1', 1, 'Why does the writer mention road widening in the second paragraph?', [
          'To show that it is more expensive than tramways',
          'To explain why extra road space does not reduce congestion',
          'To argue that buses need wider roads than trams',
          'To criticise planners who removed the original tracks'
        ], 1),
        mcq('IR-2', 2, 'According to the third paragraph, the permanence of tram rails is valuable because it', [
          'reduces the long-term cost of maintenance',
          'makes cancellation politically difficult',
          'encourages investment near the route',
          'allows longer vehicles to be used'
        ], 2)
      ]),
      readingPassage('PASSAGE2', 'Passage 2', 'Questions 3-4', 'Salt Farming in Coastal Wetlands', [
        'Solar salt production is among the oldest continuous industries in the world. Sea water is admitted to shallow ponds and allowed to evaporate through a series of basins, each more concentrated than the last, until the salt crystallises and can be raked from the floor. The technique has changed remarkably little in two thousand years.',
        'What has changed is how the ponds are valued. Because the basins hold water at different depths and salinities, they reproduce, almost by accident, the range of habitats that natural coastal wetlands provide. Wading birds that have lost their estuarine feeding grounds to ports and housing now depend on working salt pans, and in several countries the largest flamingo colonies are found on commercial salt farms.',
        'This creates an awkward dependency. Conservation bodies have generally assumed that the retreat of heavy industry benefits wildlife, but when a salt farm closes, the ponds silt up, the salinity gradient collapses and the birds leave within a few seasons. Several agencies now pay operators to keep unprofitable pans in production, a policy that sits uncomfortably with the principle that nature should not require an industrial subsidy.'
      ], [
        mcq('IR-3', 3, 'The writer describes the habitat value of salt pans as arising', [
          'from a deliberate design decision by operators',
          'as an unintended consequence of the production method',
          'only after the ponds have been abandoned',
          'from the gradual return of estuarine species'
        ], 1),
        mcq('IR-4', 4, 'What does the writer suggest is "awkward" about the situation?', [
          'Salt farms are less profitable than they once were',
          'Conservation now depends on an industry continuing to operate',
          'Birds prefer artificial ponds to natural estuaries',
          'Agencies disagree about which species should be protected'
        ], 1)
      ]),
      readingPassage('PASSAGE3', 'Passage 3', 'Questions 5-6', 'Why Museums Are Rethinking Storage', [
        'A large museum displays between one and five per cent of what it owns. The rest sits in storage, and for most of the last century storage was designed to be invisible: windowless rooms, often off site, entered by staff and almost nobody else. The collection existed, in practice, only as a catalogue entry.',
        'The visible-storage movement inverts this. Objects are shelved behind glass in rooms the public can walk through, arranged by material or size rather than by narrative. Visitors see four thousand ceramic vessels at once instead of the twelve a curator would have chosen. Critics call the result meaningless; supporters reply that the twelve were never neutral either, and that a visitor who can see the whole holding can at least ask why only twelve were selected.',
        'The practical objections are harder to dismiss. Light, humidity and vibration all rise when a store becomes a gallery, and conservators point out that an object seen for thirty seconds by a passing visitor may pay for that visibility with a measurable shortening of its life. The compromise now emerging is selective: robust materials go on open view, while light-sensitive works stay in the dark and appear instead as high-resolution surrogates.'
      ], [
        mcq('IR-5', 5, 'The phrase "the twelve were never neutral either" is used to argue that', [
          'curated displays also involve arbitrary choices',
          'visible storage is cheaper than curated display',
          'twelve objects are too few for any exhibition',
          'curators should explain their selections in writing'
        ], 0),
        mcq('IR-6', 6, 'What compromise does the final paragraph describe?', [
          'Rotating objects between store and gallery each season',
          'Displaying only objects that have already been digitised',
          'Showing durable objects openly and fragile ones as reproductions',
          'Limiting the number of visitors admitted to the store'
        ], 2)
      ])
    ]
  };

  /* --- Writing: Task 1(150단어) / Task 2(250단어) ------------------
   * 두 태스크 모두 block.kind = 'free-write'. 현재 writing 렌더러의 비-email 분기는
   * professor / prompt / posts 필드를 읽으므로 그 형태에 맞춰 채운다.
   * (렌더러의 제목이 "Write for an Academic Discussion" 으로 고정된 점은 알려진 갭 —
   *  docs/bmad/ielts-mapping.md 의 후속 과제 표 참조.) */

  var writing = {
    id: 'writing',
    label: 'Writing',
    labelKo: '라이팅',
    modules: [
      {
        id: 'TASK1',
        label: 'Task 1',
        blocks: [
          {
            kind: 'free-write',
            heading: 'WRITING TASK 1',
            questions: [
              {
                id: 'IW-T1', kind: 'graphDescription', no: 1,
                professor: 'IELTS Academic · Writing Task 1',
                prompt: 'The table below shows how households in one city disposed of their food waste in 2005, 2015 and 2025. ' +
                  'Summarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\n' +
                  'General rubbish bin: 78% (2005), 52% (2015), 21% (2025)\n' +
                  'Home composting: 14% (2005), 19% (2015), 24% (2025)\n' +
                  'Council food-waste collection: 0% (2005), 26% (2015), 51% (2025)\n' +
                  'Other or not stated: 8% (2005), 3% (2015), 4% (2025)',
                posts: [],
                minWords: 150
              }
            ]
          }
        ]
      },
      {
        id: 'TASK2',
        label: 'Task 2',
        blocks: [
          {
            kind: 'free-write',
            heading: 'WRITING TASK 2',
            questions: [
              {
                id: 'IW-T2', kind: 'essay', no: 2,
                professor: 'IELTS Academic · Writing Task 2',
                prompt: 'Some people believe that public museums and galleries should charge an entrance fee so that they depend less on government funding. ' +
                  'Others argue that entry must remain free if these institutions are to serve the whole population.\n\n' +
                  'Discuss both views and give your own opinion.\n\n' +
                  'Give reasons for your answer and include any relevant examples from your own knowledge or experience.',
                posts: [],
                minWords: 250
              }
            ]
          }
        ]
      }
    ]
  };

  /* --- Speaking: Part1(2문항) / Part2 cue card(1 long turn) / Part3(2문항) ---
   * Part 2 문항의 cueCard 가 컴파일러에서 phases 의 read/prep 에 실려 나간다.
   * cueCard.image 는 선택 — 넣으면 prep 화면에 그림 cue 로 함께 표시된다. */

  function speakQ(id, no, prompt) {
    return { id: id, kind: 'interview', no: no, prompt: prompt };
  }

  var speaking = {
    id: 'speaking',
    label: 'Speaking',
    labelKo: '스피킹',
    modules: [
      {
        id: 'SP1',
        label: 'Part 1 · Introduction and Interview',
        blocks: [
          {
            kind: 'record-set',
            heading: 'Part 1',
            instruction: 'The examiner will ask you general questions about yourself and familiar topics.',
            questions: [
              speakQ('IS-1', 1, 'Let’s talk about where you live. Do you live in a house or an apartment, and what do you like about it?'),
              speakQ('IS-2', 2, 'How do you usually travel to work or to your place of study? Has that changed in the last few years?')
            ]
          }
        ]
      },
      {
        id: 'SP2',
        label: 'Part 2 · Long Turn',
        blocks: [
          {
            kind: 'record-set',
            heading: 'Part 2',
            instruction: 'You will have one minute to prepare, then speak for one to two minutes.',
            questions: [
              {
                id: 'IS-3', kind: 'longTurn', no: 3,
                prompt: 'Describe a skill you learned outside school or university.',
                cueCard: {
                  topicEn: 'Describe a skill you learned outside school or university.',
                  topicKo: '학교나 대학 밖에서 배운 기술 하나를 설명하세요.',
                  bullets: [
                    'what the skill is',
                    'how and when you learned it',
                    'who or what helped you learn it',
                    'and explain why this skill has been useful to you'
                  ],
                  bulletsKo: [
                    '어떤 기술인지',
                    '언제 어떻게 배웠는지',
                    '누구 또는 무엇의 도움을 받았는지',
                    '그리고 그 기술이 왜 유용했는지 설명하세요'
                  ]
                }
              }
            ]
          }
        ]
      },
      {
        id: 'SP3',
        label: 'Part 3 · Discussion',
        blocks: [
          {
            kind: 'record-set',
            heading: 'Part 3',
            instruction: 'The examiner will ask further questions connected to the topic in Part 2.',
            questions: [
              speakQ('IS-4', 4, 'Do you think practical skills are valued as highly as academic qualifications in your country? Why?'),
              speakQ('IS-5', 5, 'Some people say that anything can now be learned from online videos. How far do you agree?')
            ]
          }
        ]
      }
    ]
  };

  var pack = {
    code: 'IELTS-SAMPLE',
    title: 'IELTS Academic — Sample Set',
    profile: 'ielts',
    paths: { audio: AUDIO, pics: 'media/ielts/pictures/', speaking: 'media/ielts/speaking/' },
    sections: [listening, reading, writing, speaking],

    /* --- 편의 helper (set1.js 와 동일 시그니처) ------------------- */
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
    },

    /* 렌더러들은 콘텐츠를 window.SMEAG_SET1 에서 읽는다(exam-render-*.js).
     * 자동으로 덮어쓰면 TOEFL 세션을 망가뜨리므로 명시 호출로만 설치한다. */
    install: function () {
      window.SMEAG_SET1 = this;
      return this;
    }
  };

  window.SMEAG_IELTS_SAMPLE = pack;
})();
