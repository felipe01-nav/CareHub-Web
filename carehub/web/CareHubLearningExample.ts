// CareHub Learning: the example course Studio can create ("Start from an example"). Everything here is made up:
// Brightside Bakery and its customers are fictional. It uses most block types and can be published as it is.
import { estimateMinutes, newId } from './CareHubLearningApi';

import type { Block, Content, Lesson, Question, ScenarioStep } from './CareHubLearningApi';

function b<T extends Block['type']>(type: T, fields: Omit<Extract<Block, { type: T }>, 'id' | 'type'>): Block {
  return { id: newId('b'), type, ...fields } as unknown as Block;
}

function single(prompt: string, answers: string[], right: number, extra: Partial<Question> = {}): Question {
  return {
    id: newId('q'),
    kind: 'single',
    prompt,
    options: answers.map((text, i) => ({ id: newId('o'), text, correct: i === right })),
    pairs: [],
    feedback_correct: 'That’s right!',
    feedback_incorrect: 'Not quite.',
    explanation: '',
    points: 1,
    ...extra,
  };
}

export function exampleCourse(): Content {
  const s1 = newId('s');
  const s2 = newId('s');
  const s3 = newId('s');
  const steps: ScenarioStep[] = [
    {
      id: s1,
      text: '“Hi, it’s Jordan Lee. I ordered a birthday cake last week and my card was charged twice. I’m really not happy.”',
      choices: [
        {
          id: newId('ch'),
          text: '“I’m sorry about that, Jordan — let’s sort it out. Could you tell me your order number?”',
          feedback: 'Great start: you said sorry and moved straight to fixing it.',
          good: true,
          next: s2,
        },
        {
          id: newId('ch'),
          text: '“That’s the bank’s problem, not ours.”',
          feedback: 'This sounds like you’re passing the blame. Jordan gets more upset.',
          good: false,
          next: s2,
        },
      ],
    },
    {
      id: s2,
      text: 'Jordan gives you order BB-1042. On the account you see two payments of $48.00 — one from the order and one from a retry when the card reader froze.',
      choices: [
        {
          id: newId('ch'),
          text: 'Refund the second $48.00 payment and tell Jordan when to expect it.',
          feedback: 'Exactly. The duplicate payment goes back, and Jordan knows what happens next.',
          good: true,
          next: s3,
        },
        {
          id: newId('ch'),
          text: 'Offer a free cupcake instead of a refund.',
          feedback: 'Kind, but Jordan still paid twice. Always refund a duplicate charge first.',
          good: false,
          next: s3,
        },
      ],
    },
    {
      id: s3,
      text: '“Thanks — that’s a relief. How long will the refund take?”',
      choices: [
        {
          id: newId('ch'),
          text: '“Usually 3 to 5 working days. I’ll email you a confirmation now.”',
          feedback: 'Clear and honest. Jordan thanks you and hangs up happy.',
          good: true,
          next: '',
        },
        {
          id: newId('ch'),
          text: '“It should be instant.”',
          feedback: 'Card refunds usually take a few days — promising “instant” leads to another call.',
          good: false,
          next: '',
        },
      ],
    },
  ];

  const lessons: Lesson[] = [
    {
      id: newId('l'),
      title: 'Welcome to the billing desk',
      min_seconds: 20,
      blocks: [
        b('heading', { text: 'Why billing matters', level: 2 }),
        b('paragraph', {
          text: 'At **Brightside Bakery**, most questions from customers are about orders and payments. Getting billing right keeps customers coming back — and saves everyone time.',
        }),
        b('image', {
          url: '/covers/m_cover_image_5.png',
          alt: 'A colorful abstract picture used as a stand-in for the bakery counter',
          caption: 'The billing desk sits next to the front counter.',
          width: 'full',
        }),
        b('callout', {
          title: 'Good to know',
          text: 'You can always ask *Sam Ortiz* (billing lead) when something looks odd. Nobody expects you to know everything on day one.',
          tone: 'tip',
        }),
        b('list', {
          style: 'check',
          items: ['Greet the customer and say your name', 'Find the order number', 'Explain what you will do next', 'Send a confirmation email'],
        }),
        b('statement', { text: 'Fix the problem first, then explain it.' }),
        b('divider', {}),
        b('quote', { text: 'A calm answer turns most billing calls around in under five minutes.', cite: 'Sam Ortiz, Billing lead' }),
      ],
    },
    {
      id: newId('l'),
      title: 'Reading an invoice',
      min_seconds: 0,
      blocks: [
        b('paragraph', { text: 'Every Brightside invoice has the same three parts. Open each tab to see what to look for.' }),
        b('tabs', {
          items: [
            { id: newId('i'), title: 'Invoice number', text: 'Starts with **BB-** and is printed at the top right, for example BB-1042.' },
            { id: newId('i'), title: 'Line items', text: 'One line per product: cakes, breads, extras like candles, and the delivery fee.' },
            { id: newId('i'), title: 'Due date', text: 'Business customers pay within 14 days. Walk-in customers pay when they order.' },
          ],
        }),
        b('accordion', {
          items: [
            { id: newId('i'), title: 'What is a credit note?', text: 'A credit note cancels part or all of an invoice. We send one with every refund.' },
            { id: newId('i'), title: 'Why is there a delivery fee?', text: 'Deliveries within 5 miles cost $6. Orders over $80 are delivered free.' },
            { id: newId('i'), title: 'What if the total looks wrong?', text: 'Check the line items first, then ask the billing lead before promising a refund.' },
          ],
        }),
        b('knowledge_check', {
          question: single('Where do you find the invoice number?', ['At the bottom, next to the total', 'At the top right, starting with BB-', 'On the delivery note only'], 1, {
            feedback_correct: 'Yes — top right, starting with BB-.',
            feedback_incorrect: 'Look again: it’s at the top right and starts with BB-.',
          }),
        }),
        b('continue', { label: 'Continue', require_complete: true }),
        b('flashcards', {
          cards: [
            { id: newId('c'), front: 'Duplicate charge', back: 'The same payment taken twice. Refund the extra one.' },
            { id: newId('c'), front: 'Credit note', back: 'A document that cancels part or all of an invoice.' },
            { id: newId('c'), front: 'Due date', back: 'The last day to pay an invoice — 14 days for business customers.' },
          ],
        }),
      ],
    },
    {
      id: newId('l'),
      title: 'Practice: Jordan’s double charge',
      min_seconds: 0,
      blocks: [
        b('paragraph', { text: 'Time to practice. Jordan Lee, a regular customer, calls the bakery. Choose what you would say.' }),
        b('scenario', { title: 'A customer was charged twice', intro: 'You’re on the billing phone line on a busy Saturday morning.', start: s1, steps }),
        b('continue', { label: 'I’m done practicing', require_complete: true }),
        b('knowledge_check', {
          question: {
            id: newId('q'),
            kind: 'multiple',
            prompt: 'Which of these should you do on every billing call?',
            options: [
              { id: newId('o'), text: 'Find the order number', correct: true },
              { id: newId('o'), text: 'Tell the customer what happens next', correct: true },
              { id: newId('o'), text: 'Promise an instant refund', correct: false },
            ],
            pairs: [],
            feedback_correct: 'Spot on.',
            feedback_incorrect: 'Close — find the order and explain next steps, but never promise an instant refund.',
            explanation: '',
            points: 1,
          },
        }),
        b('callout', { title: 'Nice work', text: 'You’re ready for the final quiz. You need 70% to pass and you have three tries.', tone: 'success' }),
      ],
    },
  ];

  const questions: Question[] = [
    single('A customer was charged twice for the same order. What do you do first?', ['Refund the extra payment', 'Offer a discount on the next order', 'Ask them to call their bank'], 0, {
      explanation: 'A duplicate charge is always refunded first.',
    }),
    {
      id: newId('q'),
      kind: 'multiple',
      prompt: 'Which parts appear on every Brightside invoice?',
      options: [
        { id: newId('o'), text: 'Invoice number', correct: true },
        { id: newId('o'), text: 'Line items', correct: true },
        { id: newId('o'), text: 'The baker’s name', correct: false },
        { id: newId('o'), text: 'Due date', correct: true },
      ],
      pairs: [],
      feedback_correct: 'Yes — number, line items and due date.',
      feedback_incorrect: 'Every invoice has a number, line items and a due date.',
      explanation: '',
      points: 1,
    },
    {
      id: newId('q'),
      kind: 'true_false',
      prompt: 'Orders over $80 are delivered free.',
      options: [
        { id: newId('o'), text: 'True', correct: true },
        { id: newId('o'), text: 'False', correct: false },
      ],
      pairs: [],
      feedback_correct: 'Correct.',
      feedback_incorrect: 'It’s true — over $80, delivery is free.',
      explanation: '',
      points: 1,
    },
    {
      id: newId('q'),
      kind: 'matching',
      prompt: 'Match each word with what it means.',
      options: [],
      pairs: [
        { id: newId('p'), left: 'Credit note', right: 'Cancels part of an invoice' },
        { id: newId('p'), left: 'Due date', right: 'Last day to pay' },
        { id: newId('p'), left: 'Duplicate charge', right: 'The same payment taken twice' },
      ],
      feedback_correct: 'All matched!',
      feedback_incorrect: 'Some pairs are mixed up.',
      explanation: '',
      points: 2,
    },
  ];

  const content: Content = {
    title: 'Billing basics at Brightside Bakery',
    summary: 'An example course: read an invoice, practice a call with a customer who was charged twice, then take a short quiz.',
    cover: '/covers/m_cover_image_3.png',
    preset: 'certification',
    est_minutes: 0,
    settings: {
      sequential: true,
      min_seconds_per_lesson: 0,
      pass_mark: 70,
      max_attempts: 3,
      show_answers: 'after_submit',
      require_ack: false,
      ack_text: 'I have read and understood this course.',
      completion: 'all_lessons_and_quiz',
      catalog: true,
    },
    lessons,
    quiz: { enabled: true, title: 'Billing basics quiz', questions, pool_size: 0, shuffle: true },
  };

  return { ...content, est_minutes: estimateMinutes(content) };
}
