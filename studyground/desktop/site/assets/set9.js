(function () {
  'use strict';

  var AUDIO = 'media/tts/';

  var reading = {
    id: 'reading',
    label: 'Reading',
    labelKo: '리딩',
    modules: [
      {
        id: 'R1',
        label: 'Reading Module 1',
        blocks: [
          {
            kind: 'passage',
            heading: 'Questions 1-2',
            instruction: 'Read the passage and answer the questions.',
            title: 'Campus Library Hours',
            paragraphs: [
              'The campus library has extended its opening hours to better support students during the final week of the semester. Staff now stay later on weekdays, and the study rooms remain available until midnight on Thursdays and Fridays.',
              'According to the library director, the change was made after students asked for more quiet spaces to prepare for exams. The new schedule has already been posted on the website and in the building lobby.'
            ],
            questions: [
              { id: 'R9-1', kind: 'mcq', no: 1, prompt: 'Why did the library extend its hours?', choices: ['To attract more visitors from the local community', 'To provide more support for students during exam week', 'To replace the old study rooms with computer labs', 'To reduce staff working hours during weekends'], answer: 1 },
              { id: 'R9-2', kind: 'mcq', no: 2, prompt: 'Where can students find the new schedule?', choices: ['In the cafeteria menu', 'On the library website and in the lobby', 'In the student residence handbook', 'At the campus gym reception desk'], answer: 1 }
            ]
          },
          {
            kind: 'cloze',
            heading: 'Questions 3-5',
            instruction: 'Complete the summary with the correct words.',
            template: 'The library change was designed to {{1}} students during the {{2}} week of the semester. The new hours were announced on the {{3}} and in the lobby.',
            questions: [
              { id: 'R9-3', kind: 'blank', no: 1, hint: 'supp', answer: 'support' },
              { id: 'R9-4', kind: 'blank', no: 2, hint: 'fin', answer: 'final' },
              { id: 'R9-5', kind: 'blank', no: 3, hint: 'web', answer: 'website' }
            ]
          }
        ]
      },
      {
        id: 'R2',
        label: 'Reading Module 2',
        blocks: [
          {
            kind: 'passage',
            heading: 'Questions 6-10',
            instruction: 'Read an academic passage and answer the questions.',
            title: 'Long-term Effects of Agricultural Intensification',
            paragraphs: [
              'Over the past century, many agricultural regions have intensified production to meet rising food demand. While yields have increased, monoculture practices and heavy fertilizer use have led to soil degradation in some areas. Researchers note that loss of soil structure and reduced organic matter can take decades to reverse, and some regions now face lower productivity despite technological inputs.',
              'Policy responses vary; some governments subsidize regenerative farming practices, while others focus on short-term yield goals to ensure food security. The passage argues that sustainable approaches balance productivity with ecological health, requiring coordinated long-term planning.'
            ],
            questions: [
              { id: 'R9-6', kind: 'mcq', no: 6, prompt: 'What is a key long-term problem mentioned?', choices: ['Increased food prices', 'Soil degradation', 'Excess biodiversity', 'Decreased fertilizer availability'], answer: 1 },
              { id: 'R9-7', kind: 'mcq', no: 7, prompt: 'According to the passage, what is needed to address the issue?', choices: ['Individual farm action only', 'Coordinated long-term planning', 'Immediate removal of all subsidies', 'Short-term technological fixes'], answer: 1 }
            ]
          }
        ]
      }
    ]
  };

  var listening = {
    id: 'listening',
    label: 'Listening',
    labelKo: '리스닝',
    modules: [
      {
        id: 'L1',
        label: 'Listening Module 1',
        blocks: [
          {
            kind: 'conversation',
            heading: 'Questions 1-2',
            instruction: 'Listen to the conversation and answer the questions.',
            audio: AUDIO + 'read-set9-listening-scene.mp3',
            image: '',
            messages: [
              { from: 'Student', text: 'I wanted to ask about the group presentation. My team is worried we will not finish before Friday.' },
              { from: 'Professor', text: 'You can submit a short outline first, and then complete the full presentation next week.' }
            ],
            questions: [
              { id: 'L9-1', kind: 'mcq', no: 1, prompt: 'What does the professor suggest?', choices: ['Finish the presentation immediately', 'Submit an outline first and complete the full presentation later', 'Cancel the presentation', 'Ask another professor for help'], answer: 1 },
              { id: 'L9-2', kind: 'mcq', no: 2, prompt: 'When will the full presentation be completed?', choices: ['Before Friday', 'Next week', 'Today', 'At the end of the semester'], answer: 1 }
            ]
          }
        ]
      },
      {
        id: 'L2',
        label: 'Listening Module 2',
        blocks: [
          {
            kind: 'lecture',
            heading: 'Questions 3-5',
            instruction: 'Listen to the short lecture and answer the questions.',
            audio: AUDIO + 'read-L2-lecture-invasive-species.mp3',
            image: '',
            summary: 'A short lecture about invasive species and their ecological impact.',
            questions: [
              { id: 'L9-3', kind: 'mcq', no: 3, prompt: 'What effect do invasive species have according to the lecturer?', choices: ['They increase native biodiversity', 'They reduce native biodiversity', 'They have no ecological effect', 'They always improve soil quality'], answer: 1 },
              { id: 'L9-4', kind: 'mcq', no: 4, prompt: 'Which mitigation does the lecturer mention?', choices: ['Ignoring the problem', 'Monitoring and removal', 'Planting only invasive species', 'Exporting the species'], answer: 1 }
            ]
          }
        ]
      }
    ]
  };

  var writing = {
    id: 'writing',
    label: 'Writing',
    labelKo: '라이팅',
    modules: [
      {
        id: 'W1',
        label: 'Writing Module 1',
        blocks: [
          {
            kind: 'free-write',
            heading: 'Writing Task 1',
            instruction: 'Respond to the prompt in at least 120 words.',
            questions: [
              { id: 'set9-writing-1', no: 1, prompt: 'Do you think universities should require students to take a course on personal budgeting? Explain your opinion and provide reasons.', minWords: 120 }
            ]
          },
          {
            kind: 'free-write',
            heading: 'Writing Task 2',
            instruction: 'Respond to the prompt in at least 100 words.',
            questions: [
              { id: 'set9-writing-2', no: 2, prompt: 'Some students prefer studying alone, while others prefer studying with classmates. Which approach do you think is more effective and why?', minWords: 100 }
            ]
          },
          {
            kind: 'free-write',
            heading: 'Writing Task 3',
            instruction: 'Respond to the prompt in at least 150 words.',
            questions: [
              { id: 'set9-writing-3', no: 3, prompt: 'Some cities ban cars from certain central areas to reduce pollution. Do you agree or disagree with such bans? Use reasons and examples to support your answer.', minWords: 150 }
            ]
          }
        ]
      }
    ]
  };

  var speaking = {
    id: 'speaking',
    label: 'Speaking',
    labelKo: '스피킹',
    modules: [
      {
        id: 'S1',
        label: 'Speaking Module 1',
        blocks: [
          {
            kind: 'record-set',
            heading: 'Speaking Task 1',
            instruction: 'Answer the prompt aloud for 45 seconds.',
            questions: [
              { id: 'set9-speaking-1', no: 1, prompt: 'Describe a place where you like to study and explain why it helps you concentrate.', audio: AUDIO + 'read-set9-speaking-prompt.mp3' }
            ]
          },
          {
            kind: 'record-set',
            heading: 'Speaking Task 2',
            instruction: 'Answer the prompt aloud for 45 seconds.',
            questions: [
              { id: 'set9-speaking-2', no: 2, prompt: 'Describe a time when you had to work with a group. What was your role and what did you learn?', audio: AUDIO + 'read-set9-speaking-prompt.mp3' }
            ]
          },
          {
            kind: 'record-set',
            heading: 'Speaking Task 3',
            instruction: 'Answer the prompt aloud for 60 seconds.',
            questions: [
              { id: 'set9-speaking-3', no: 3, prompt: 'Describe a challenge you overcame and explain how it improved your skills.', audio: AUDIO + 'read-set9-speaking-prompt.mp3' }
            ]
          }
        ]
      }
    ]
  };

  window.SMEAG_SET9 = {
    code: 'SET9',
    title: 'NEW TOEFL SET 9',
    label: 'NEW TOEFL SET 9',
    sections: [reading, listening, writing, speaking],
    answerKey: {
      'R9-1': 1,
      'R9-2': 1,
      'R9-3': 'support',
      'R9-4': 'final',
      'R9-5': 'website',
      'R9-6': 1,
      'R9-7': 1,
      'L9-1': 1,
      'L9-2': 1,
      'L9-3': 1,
      'L9-4': 1,
      'set9-writing-1': 'Open-ended response',
      'set9-writing-2': 'Open-ended response',
      'set9-writing-3': 'Open-ended response',
      'set9-speaking-1': 'Open-ended response',
      'set9-speaking-2': 'Open-ended response',
      'set9-speaking-3': 'Open-ended response'
    },
    explanations: {
      'R9-1': 'The passage states that the library extended hours to support students during exam week.',
      'R9-2': 'The schedule is posted on the library website and in the lobby.',
      'R9-3': 'The word “support” fits best in the sentence about helping students.',
      'R9-4': '“Final week” is the correct adjective phrase in the context.',
      'R9-5': 'The schedule was announced on the website.',
      'R9-6': 'The passage highlights soil degradation as a long-term effect of intensification.',
      'R9-7': 'The author recommends coordinated, long-term policy action rather than short-term fixes.',
      'L9-1': 'The professor recommends submitting an outline first and finishing the full presentation later.',
      'L9-2': 'The full presentation will be completed next week.',
      'L9-3': 'The lecturer explains invasive species reduce native biodiversity and disrupt ecosystems.',
      'L9-4': 'The lecturer suggests monitoring and removal as mitigation measures.',
      'set9-writing-1': 'A strong response should clearly state an opinion and support it with reasons and examples.',
      'set9-writing-2': 'A strong response should compare both approaches and use examples.',
      'set9-writing-3': 'A strong response should present a clear position with supporting details and examples.',
      'set9-speaking-1': 'Describe the place and explain how features help concentration (quiet, light, resources).',
      'set9-speaking-2': 'Describe your role, actions, and lessons learned from teamwork.',
      'set9-speaking-3': 'Explain the challenge, steps taken to overcome it, and resulting skill improvement.'
    }
  };
})();
