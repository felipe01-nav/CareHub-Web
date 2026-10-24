// CareHub Learning: the example courses Studio can create ("Start from an example"), one for each kind of course.
// Everything here is made up: Brightside Bakery, Riverstone Home Internet and their customers are fictional.
// Each example only uses blocks Studio has, takes its settings from its course type, and can be published as it is.
// Pictures are Studio's sample pictures (/covers/…), described as the stand-ins they are.
import { applyPreset, defaultSettings, estimateMinutes, newId } from './CareHubLearningApi';

import type {
  Block,
  Content,
  CourseSettings,
  FlashCard,
  Lesson,
  Preset,
  Question,
  QuestionKind,
  Quiz,
  ScenarioStep,
  TextItem,
} from './CareHubLearningApi';
import type { GalleryImage, LinkButton } from './CareHubLearningBlocks3';

export interface ExampleCourse {
  preset: Preset;
  title: string;
  /** One line for the picker. */
  description: string;
  build: () => Content;
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

function b<T extends Block['type']>(type: T, fields: Omit<Extract<Block, { type: T }>, 'id' | 'type'>): Block {
  return { id: newId('b'), type, ...fields } as unknown as Block;
}

function lesson(title: string, blocks: Block[], minSeconds = 0): Lesson {
  return { id: newId('l'), title, min_seconds: minSeconds, blocks };
}

function items(list: [title: string, text: string][]): TextItem[] {
  return list.map(([title, text]) => ({ id: newId('i'), title, text }));
}

function cards(list: [front: string, back: string][]): FlashCard[] {
  return list.map(([front, back]) => ({ id: newId('c'), front, back }));
}

function question(kind: QuestionKind, prompt: string, answers: [text: string, correct: boolean][], extra: Partial<Question> = {}): Question {
  return {
    id: newId('q'),
    kind,
    prompt,
    options: answers.map(([text, correct]) => ({ id: newId('o'), text, correct })),
    pairs: [],
    feedback_correct: 'That’s right!',
    feedback_incorrect: 'Not quite.',
    explanation: '',
    points: 1,
    ...extra,
  };
}

function single(prompt: string, answers: string[], right: number, extra: Partial<Question> = {}): Question {
  return question(
    'single',
    prompt,
    answers.map((text, i): [string, boolean] => [text, i === right]),
    extra
  );
}

function trueFalse(prompt: string, isTrue: boolean, extra: Partial<Question> = {}): Question {
  return question(
    'true_false',
    prompt,
    [
      ['True', isTrue],
      ['False', !isTrue],
    ],
    extra
  );
}

function matching(prompt: string, pairs: [left: string, right: string][], extra: Partial<Question> = {}): Question {
  return { ...question('matching', prompt, [], extra), pairs: pairs.map(([left, right]) => ({ id: newId('p'), left, right })) };
}

function fillBlank(prompt: string, answers: string[], extra: Partial<Question> = {}): Question {
  return { ...question('fill_blank', prompt, [], extra), answers, case_sensitive: false };
}

/** Put in order: `list` is the right order (learners get it shuffled). */
function ordering(prompt: string, list: string[], extra: Partial<Question> = {}): Question {
  return { ...question('ordering', prompt, [], extra), items: list.map((text) => ({ id: newId('o'), text })) };
}

/** One of the sample pictures Studio offers (1–6). */
function sample(n: number) {
  return `/covers/m_cover_image_${n}.png`;
}

function pictures(list: [picture: number, alt: string, caption: string][]): GalleryImage[] {
  return list.map(([n, alt, caption]) => ({ id: newId('g'), url: sample(n), alt, caption }));
}

/** A sorting activity: each card says which pile it belongs in (0 = the first pile). */
function sorting(prompt: string, piles: string[], list: [text: string, pile: number][]): Block {
  const ps = piles.map((title) => ({ id: newId('g'), title }));

  return b('sorting', { prompt, piles: ps, cards: list.map(([text, pile]) => ({ id: newId('c'), text, pile_id: ps[pile].id })) });
}

function timeline(list: [date: string, title: string, text: string][]): Block {
  return b('timeline', { items: list.map(([date, title, text]) => ({ id: newId('t'), date, title, text, image_url: '', image_alt: '' })) });
}

/** Buttons that open other lessons of the course (the first one is the main button). */
function lessonButtons(list: [label: string, to: Lesson][]): Block {
  return b('buttons', {
    items: list.map(
      ([label, to], i): LinkButton => ({
        id: newId('bt'),
        label,
        style: i === 0 ? 'primary' : 'secondary',
        target: { kind: 'lesson', lesson_id: to.id, block_id: '' },
      })
    ),
  });
}

function quotes(list: [text: string, cite: string][]): Block {
  return b('quote_carousel', { quotes: list.map(([text, cite]) => ({ id: newId('qt'), text, cite, image_url: '', image_alt: '' })) });
}

interface Turn {
  /** What happens, or what the customer says. */
  text: string;
  good: [say: string, feedback: string];
  weak: [say: string, feedback: string];
  /** Show the weaker answer first, so the good one isn't always on top. */
  weakFirst?: boolean;
}

/** A practice conversation: every step has a good and a weaker answer, and both carry on to the next step. */
function scenario(title: string, intro: string, turns: Turn[]): Block {
  const ids = turns.map(() => newId('s'));
  const steps: ScenarioStep[] = turns.map((t, i) => {
    const next = ids[i + 1] || '';
    const good = { id: newId('ch'), text: t.good[0], feedback: t.good[1], good: true, next };
    const weak = { id: newId('ch'), text: t.weak[0], feedback: t.weak[1], good: false, next };

    return { id: ids[i], text: t.text, choices: t.weakFirst ? [weak, good] : [good, weak] };
  });

  return b('scenario', { title, intro, start: ids[0], steps });
}

function noQuiz(): Quiz {
  return { enabled: false, title: 'Final quiz', questions: [], pool_size: 0, shuffle: true };
}

/** Settings come from the course type, as if it was picked in "New course"; `tweak` sets what the type leaves alone. */
function course(preset: Preset, c: Pick<Content, 'title' | 'summary' | 'cover' | 'lessons' | 'quiz'>, tweak: Partial<CourseSettings> = {}): Content {
  const content = applyPreset(
    {
      title: c.title,
      summary: c.summary,
      cover: c.cover,
      preset,
      est_minutes: 0,
      settings: { ...defaultSettings(), ...tweak },
      lessons: c.lessons,
      quiz: c.quiz,
    },
    preset
  );

  return { ...content, est_minutes: estimateMinutes(content) };
}

// ---------------------------------------------------------------------------
// Standard course: Billing basics at Brightside Bakery
// ---------------------------------------------------------------------------

function billingBasics(): Content {
  const lessons: Lesson[] = [
    lesson(
      'Welcome to the billing desk',
      [
        b('heading', { text: 'Why billing matters', level: 2 }),
        b('paragraph', {
          text: 'At **Brightside Bakery**, most questions from customers are about orders and payments. Getting billing right keeps customers coming back — and saves everyone time.',
        }),
        b('image', {
          url: '/covers/m_cover_image_5.png',
          alt: 'A colorful abstract picture used as a stand-in for the bakery counter',
          caption: 'The billing desk sits next to the front counter.',
          width: 'full',
          layout: 'side',
          text: 'Customers reach the billing desk **in person**, **by phone** or **by email**. However they get in touch, you follow the same steps, and help is never far away.',
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
        timeline([
          ['8:30 am', 'Doors open', 'Read the overnight emails and online orders. Answer anything urgent first.'],
          ['11:00 am', 'Business invoices go out', 'Invoices for business customers are emailed. They have 14 days to pay.'],
          ['2:00 pm', 'Refunds are sent', 'Refunds approved in the morning go out together. Card refunds take 3 to 5 working days to arrive.'],
          ['5:30 pm', 'Hand over', 'Leave a short note on anything still open, so the next shift can pick it up.'],
        ]),
        b('statement', { text: 'Fix the problem first, then explain it.' }),
        b('divider', {}),
        b('quote', {
          text: 'A calm answer turns most billing calls around in under five minutes.',
          cite: 'Sam Ortiz, Billing lead',
          image_url: sample(2),
        }),
      ],
      20
    ),
    lesson('Reading an invoice', [
      b('paragraph', { text: 'Every Brightside invoice has the same three parts. Open each tab to see what to look for.' }),
      b('tabs', {
        items: items([
          ['Invoice number', 'Starts with **BB-** and is printed at the top right, for example BB-1042.'],
          ['Line items', 'One line per product: cakes, breads, extras like candles, and the delivery fee.'],
          ['Due date', 'Business customers pay within 14 days. Walk-in customers pay when they order.'],
        ]),
      }),
      b('paragraph', { text: 'These three bestsellers are on most invoices, so it helps to know their prices.' }),
      b('gallery', {
        layout: 'grid',
        images: pictures([
          [1, 'A colorful abstract picture standing in for a birthday cake', 'Birthday cake: $40.00'],
          [6, 'A colorful abstract picture standing in for a sourdough loaf', 'Sourdough loaf: $6.50'],
          [4, 'A colorful abstract picture standing in for a box of cupcakes', 'Box of six cupcakes: $18.00'],
        ]),
      }),
      b('accordion', {
        items: items([
          ['What is a credit note?', 'A credit note cancels part or all of an invoice. We send one with every refund.'],
          ['Why is there a delivery fee?', 'Deliveries within 5 miles cost $6. Orders over $80 are delivered free.'],
          ['What if the total looks wrong?', 'Check the line items first, then ask the billing lead before promising a refund.'],
        ]),
      }),
      b('knowledge_check', {
        question: single('Where do you find the invoice number?', ['At the bottom, next to the total', 'At the top right, starting with BB-', 'On the delivery note only'], 1, {
          feedback_correct: 'Yes — top right, starting with BB-.',
          feedback_incorrect: 'Look again: it’s at the top right and starts with BB-.',
        }),
      }),
      b('continue', { label: 'Continue', require_complete: true }),
      b('flashcards', {
        cards: cards([
          ['Duplicate charge', 'The same payment taken twice. Refund the extra one.'],
          ['Credit note', 'A document that cancels part or all of an invoice.'],
          ['Due date', 'The last day to pay an invoice — 14 days for business customers.'],
        ]),
      }),
    ]),
    lesson('Practice: Jordan’s double charge', [
      b('heading', { text: 'Refunding a duplicate charge', level: 2 }),
      b('process', {
        items: items([
          ['Find the order', 'Ask for the order number (it starts with **BB-**) and open the order.'],
          ['Check both payments', 'Look for two payments with the same amount, a few minutes apart. Only one belongs to the order.'],
          ['Refund the extra one', 'Refund the second payment in full — never both.'],
          ['Confirm by email', 'Email the customer a confirmation. Card refunds take 3 to 5 working days.'],
        ]),
      }),
      b('paragraph', { text: 'Time to practice. Jordan Lee, a regular customer, calls the bakery. Here’s the invoice for the order. Choose what you would say.' }),
      b('table', {
        header: true,
        rows: [
          ['Item', 'Quantity', 'Price'],
          ['Birthday cake', '1', '$40.00'],
          ['Birthday candles', '1', '$2.00'],
          ['Delivery', '1', '$6.00'],
          ['**Total**', '', '**$48.00**'],
        ],
        caption: 'Jordan’s invoice, BB-1042',
      }),
      scenario('A customer was charged twice', 'You’re on the billing phone line on a busy Saturday morning.', [
        {
          text: '“Hi, it’s Jordan Lee. I ordered a birthday cake last week and my card was charged twice. I’m really not happy.”',
          good: [
            '“I’m sorry about that, Jordan — let’s sort it out. Could you tell me your order number?”',
            'Great start: you said sorry and moved straight to fixing it.',
          ],
          weak: ['“That’s the bank’s problem, not ours.”', 'This sounds like you’re passing the blame. Jordan gets more upset.'],
        },
        {
          text: 'Jordan gives you order BB-1042. On the account you see two payments of $48.00 — one from the order and one from a retry when the card reader froze.',
          good: [
            'Refund the second $48.00 payment and tell Jordan when to expect it.',
            'Exactly. The duplicate payment goes back, and Jordan knows what happens next.',
          ],
          weak: ['Offer a free cupcake instead of a refund.', 'Kind, but Jordan still paid twice. Always refund a duplicate charge first.'],
        },
        {
          text: '“Thanks — that’s a relief. How long will the refund take?”',
          good: ['“Usually 3 to 5 working days. I’ll email you a confirmation now.”', 'Clear and honest. Jordan thanks you and hangs up happy.'],
          weak: ['“It should be instant.”', 'Card refunds usually take a few days — promising “instant” leads to another call.'],
        },
      ]),
      b('continue', { label: 'I’m done practicing', require_complete: true }),
      b('knowledge_check', {
        question: question(
          'multiple',
          'Which of these should you do on every billing call?',
          [
            ['Find the order number', true],
            ['Tell the customer what happens next', true],
            ['Promise an instant refund', false],
          ],
          {
            feedback_correct: 'Spot on.',
            feedback_incorrect: 'Close — find the order and explain next steps, but never promise an instant refund.',
          }
        ),
      }),
      sorting('Which of these can you refund straight away, and which need the billing lead first?', ['Refund it now', 'Ask the billing lead first'], [
        ['The same payment was taken twice', 0],
        ['The card reader froze and a retry charged the card again', 0],
        ['The customer says the total looks wrong', 1],
        ['The customer wants their money back for a cake they didn’t like', 1],
      ]),
      b('callout', { title: 'Nice work', text: 'You’re ready for the final quiz. You need 70% to pass and you have three tries.', tone: 'success' }),
    ]),
  ];

  const questions: Question[] = [
    single('A customer was charged twice for the same order. What do you do first?', ['Refund the extra payment', 'Offer a discount on the next order', 'Ask them to call their bank'], 0, {
      explanation: 'A duplicate charge is always refunded first.',
    }),
    question(
      'multiple',
      'Which parts appear on every Brightside invoice?',
      [
        ['Invoice number', true],
        ['Line items', true],
        ['The baker’s name', false],
        ['Due date', true],
      ],
      {
        feedback_correct: 'Yes — number, line items and due date.',
        feedback_incorrect: 'Every invoice has a number, line items and a due date.',
      }
    ),
    trueFalse('Orders over $80 are delivered free.', true, { feedback_correct: 'Correct.', feedback_incorrect: 'It’s true — over $80, delivery is free.' }),
    fillBlank('Every Brightside invoice number starts with ___.', ['BB-', 'BB'], {
      feedback_correct: 'Yes — for example BB-1042.',
      feedback_incorrect: 'Invoice numbers start with BB-, for example BB-1042.',
    }),
    matching(
      'Match each word with what it means.',
      [
        ['Credit note', 'Cancels part of an invoice'],
        ['Due date', 'Last day to pay'],
        ['Duplicate charge', 'The same payment taken twice'],
      ],
      { feedback_correct: 'All matched!', feedback_incorrect: 'Some pairs are mixed up.', points: 2 }
    ),
  ];

  return course(
    'standard',
    {
      title: 'Billing basics at Brightside Bakery',
      summary: 'An example course: read an invoice, practice a call with a customer who was charged twice, then take a short quiz.',
      cover: '/covers/m_cover_image_3.png',
      lessons,
      quiz: { enabled: true, title: 'Billing basics quiz', questions, pool_size: 0, shuffle: true },
    },
    { pass_mark: 70, max_attempts: 3, show_answers: 'after_submit' }
  );
}

// ---------------------------------------------------------------------------
// Scenario lab: Calming an upset caller
// ---------------------------------------------------------------------------

function upsetCaller(): Content {
  const lessons: Lesson[] = [
    lesson('Before you practice', [
      b('heading', { text: 'What helps on a tough call', level: 2 }),
      b('paragraph', {
        text: 'When a caller is upset, they want two things: to feel heard, and to know what happens next. In this lab you’ll take two calls for **Riverstone Home Internet** and see how each answer lands.',
      }),
      b('process', {
        items: items([
          ['Listen', 'Let the caller finish. Don’t jump in, even if you already know the fix.'],
          ['Say sorry', 'Say sorry for how it feels, for example: “I’m sorry, that sounds really frustrating.”'],
          ['Fix what you can', 'Tell the caller what you’re doing while you do it, so the silence doesn’t worry them.'],
          ['Agree what happens next', 'Say who will do what, and by when. Then check the caller is happy with that.'],
        ]),
      }),
      b('image', {
        url: sample(1),
        alt: 'A colorful abstract picture',
        caption: '',
        width: 'full',
        layout: 'text_on',
        text: '**Listen first.** Most callers calm down once they feel heard.',
      }),
      b('flashcards', {
        cards: cards([
          ['Instead of “Calm down”…', 'Try “I can hear this has been really frustrating.”'],
          ['Instead of “That’s not my department”…', 'Try “Let me get you to the right person. I’ll stay on until they answer.”'],
          ['Instead of “I don’t know”…', 'Try “Good question — let me find out for you.”'],
        ]),
      }),
    ]),
    lesson('Practice: the internet keeps dropping', [
      b('paragraph', { text: 'Marcus Bell works from home. His internet has dropped three times today, and he just lost a video call with a client.' }),
      scenario('The internet keeps dropping', 'Marcus waited 10 minutes to get through. He sounds tense.', [
        {
          text: '“Finally! My internet has dropped three times today. I work from home — this is costing me money.”',
          good: [
            '“I’m sorry, Marcus — that sounds really stressful. Let’s get it fixed. Can I run a quick check on your line while we talk?”',
            'You showed you heard him and moved straight to fixing it. Marcus calms down a little.',
          ],
          weak: [
            '“Have you tried turning your router off and on again?”',
            'It might be the fix, but leading with it sounds like you weren’t listening. Marcus gets more annoyed.',
          ],
          weakFirst: true,
        },
        {
          text: 'The line check shows the signal keeps dropping outside Marcus’s home. A technician needs to visit.',
          good: [
            '“I can see the problem — it’s outside your home, not your router. A technician can come tomorrow between 8 and 10 am. Does that work?”',
            'Clear and honest, and Marcus gets a say in the time.',
          ],
          weak: ['“Everything looks fine on my end.”', 'The check found a fault. Saying it’s fine makes Marcus feel brushed off.'],
        },
        {
          text: '“Tomorrow? I have client calls all morning. What am I supposed to do until then?”',
          good: [
            '“I understand. I can add free mobile data to your account for today, so you can keep working. Shall I do that now?”',
            'You found something that helps right now. Marcus thanks you before he hangs up.',
          ],
          weak: ['“Sorry, there’s nothing I can do until then.”', 'Even when you can’t fix it today, look for something that helps in the meantime.'],
          weakFirst: true,
        },
      ]),
      b('continue', { label: 'I’m done with this call', require_complete: true }),
      b('callout', {
        title: 'What made the difference',
        text: 'Marcus calmed down when he felt heard and got something that helped today — before the fault was even fixed.',
        tone: 'tip',
      }),
    ]),
    lesson('Practice: a caller asks for a manager', [
      b('paragraph', { text: 'Dana Whitfield was promised a refund last month. It still hasn’t arrived, and she wants to speak to a manager.' }),
      scenario('A caller asks for a manager', 'This is Dana’s third call about the same refund.', [
        {
          text: '“This is the third time I’ve called about this refund. I want to speak to a manager. Now.”',
          good: [
            '“I’m sorry you’ve had to call again, Dana. I can ask my team lead to join. Can I check where the refund is first? It may be quicker.”',
            'You respected her request and offered a faster way. Dana agrees to let you check.',
          ],
          weak: ['“Managers don’t take calls.”', 'A flat “no” usually makes things worse. Offer to bring in your team lead if it’s needed.'],
        },
        {
          text: 'You find the refund. It was approved, but it came back because the bank account on file is closed.',
          good: [
            '“I found it. Your refund was approved, but the bank account we have is closed, so it came back. If you add your new account through the secure link I’m texting you, it goes out today.”',
            'You explained what went wrong without blaming anyone, and how to fix it.',
          ],
          weak: ['“That’s on you — you didn’t update your bank details.”', 'Even if it’s true, blaming the caller starts the argument again.'],
          weakFirst: true,
        },
        {
          text: '“Fine. But I want someone to know I’ve had to call three times.”',
          good: [
            '“That’s fair. I’ll add a note for my team lead, Priya Shah, and she’ll email you by Friday.”',
            'You dealt with what Dana really wanted: to be taken seriously.',
          ],
          weak: ['“Okay. Is there anything else?”', 'Moving on too fast leaves Dana feeling unheard. Agree on a follow-up first.'],
        },
      ]),
      b('continue', { label: 'I’m done practicing', require_complete: true }),
      b('knowledge_check', {
        question: single(
          'A caller is upset and talking fast. What should you do first?',
          ['Jump in with the fix', 'Let them finish, then say sorry for how it feels', 'Put them on hold so they can calm down'],
          1,
          {
            feedback_correct: 'Yes — listen first, then show you understand.',
            feedback_incorrect: 'Let them finish first. People calm down faster when they feel heard.',
          }
        ),
      }),
      b('paragraph', { text: 'Here’s what Riverstone customers said after calls like these.' }),
      quotes([
        ['She let me finish before she said anything. That alone made me feel better.', 'Riverstone customer, after a call about dropped internet'],
        ['I didn’t need a manager in the end. I needed someone to tell me what went wrong.', 'Riverstone customer, after a refund call'],
        ['He told me what he was doing while I waited, so the silence didn’t worry me.', 'Riverstone customer, after a billing call'],
      ]),
      b('callout', {
        title: 'Nice work',
        text: 'That’s the lab done. Try the calls again any time and pick different answers to see what happens.',
        tone: 'success',
      }),
    ]),
  ];

  return course('scenario_lab', {
    title: 'Calming an upset caller',
    summary: 'Practice two tough calls with Riverstone Home Internet customers and see how each answer lands.',
    cover: '',
    lessons,
    quiz: noQuiz(),
  });
}

// ---------------------------------------------------------------------------
// Required read: Taking card payments safely
// ---------------------------------------------------------------------------

function cardPolicy(): Content {
  const lessons: Lesson[] = [
    lesson('What’s changing', [
      b('callout', {
        title: 'Why this matters',
        text: 'Card numbers are some of the most private things a caller can share. Keeping them out of our call recordings protects our customers — and you.',
        tone: 'info',
      }),
      b('paragraph', {
        text: 'Every call at **Riverstone Home Internet** is recorded, so we can train and check quality. From now on, nobody reads out, types or writes down a full card number during a call.',
      }),
      b('columns', {
        left: '**Always**\nSend the secure payment link by text or email.\nIf a caller starts reading out their number, stop them politely.',
        right: '**Never**\nAsk a caller to read out their card number.\nWrite card details on paper or in account notes.',
      }),
      b('statement', { text: 'If you can see or hear a full card number, something has gone wrong.' }),
    ]),
    lesson('Taking a payment', [
      b('divider', { style: 'numbered' }),
      b('heading', { text: 'On a call', level: 2 }),
      b('paragraph', { text: 'Here’s how to take a payment on a call. It takes about a minute.' }),
      b('process', {
        items: items([
          ['Offer the link', 'Say: “I’ll text you a secure link, so you can pay without reading your card number out.”'],
          ['Send it', 'Choose **Send payment link** on the customer’s account. It arrives by text or email within a minute.'],
          ['Stay on the line', 'Stay with the caller while they pay, in case they have questions.'],
          ['Check it worked', 'When the payment shows on the account, tell the caller the amount and thank them.'],
        ]),
      }),
      b('code', {
        caption: 'The text message the caller gets. You can paste the same words into a chat.',
        code: 'Riverstone Home Internet: here is your secure payment link.\nhttps://pay.riverstone.example/p/7Q2K9X\nIt works for 15 minutes. We will never ask you to read out your card number.',
        language: 'plain',
      }),
      b('divider', { style: 'numbered' }),
      b('heading', { text: 'When something goes wrong', level: 2 }),
      b('accordion', {
        items: items([
          ['What if the caller can’t use a link?', 'Transfer them to the automated payment line. They type their card number on the keypad, and it’s never recorded.'],
          ['What if a caller reads their number out anyway?', 'Stop them politely and tell your team lead after the call. They’ll make sure that part of the recording is deleted.'],
          ['Does this apply to email and chat?', 'Yes. If a customer sends a card number by email or chat, don’t copy it anywhere. Tell your team lead so it can be deleted.'],
        ]),
      }),
      b('quote', { text: 'If in doubt, send the link.', cite: 'Priya Shah, Team lead' }),
    ]),
  ];

  return course(
    'required_read',
    {
      title: 'Taking card payments safely',
      summary: 'Riverstone’s policy for card payments on calls. Read it in order, then confirm you’ve understood it.',
      cover: '',
      lessons,
      quiz: noQuiz(),
    },
    { ack_text: 'I have read the card payments policy and I will follow it.' }
  );
}

// ---------------------------------------------------------------------------
// Certification: Amazon Connect call handling
// ---------------------------------------------------------------------------

function callHandling(): Content {
  const ccp = lesson('Your Contact Control Panel', [
    b('image', { url: sample(6), alt: 'A colorful abstract banner picture', caption: '', width: 'full', layout: 'banner' }),
    b('heading', { text: 'Meet the CCP', level: 2 }),
    b('paragraph', {
      text: 'At **Riverstone Home Internet**, you take every call in the **Contact Control Panel** (CCP), the phone that’s part of Amazon Connect. It runs in your browser, so keep its tab open during your shift.',
    }),
    b('tabs', {
      items: items([
        ['Your status', 'Set your status to **Available** to get calls, and to **Offline** when your shift ends. Your team may add others, like Break or Training.'],
        ['Taking a call', 'When a call comes in, the CCP rings and shows the caller’s number. Choose **Accept** to answer.'],
        ['After the call', 'When the call ends, you move to **After contact work** (ACW). Finish your notes, then choose **Close contact** to get the next call.'],
      ]),
    }),
    b('callout', { title: 'Good to know', text: 'Not getting any calls? Check that your status says **Available** — it’s the most common reason.', tone: 'tip' }),
  ]);
  const steps = lesson('A call from start to finish', [
    b('paragraph', { text: 'Every Riverstone call follows the same five steps. Go through them in order.' }),
    b('process', {
      items: items([
        ['Greet', 'Say the company name and your first name, then ask how you can help.'],
        ['Check who’s calling', 'Ask for the account number and the first line of the address. Don’t share any account details until both match.'],
        ['Solve the problem', 'Tell the caller what you’re doing while you do it. Ask before you put them on hold.'],
        ['Sum up', 'Repeat what you did and what happens next, then ask: “Is there anything else I can help with?”'],
        ['Wrap up', 'In **After contact work**, write a short note for the next person, then choose **Close contact**.'],
      ]),
    }),
    b('knowledge_check', {
      question: single(
        'A caller wants to know their latest bill but can’t give the address on the account. What do you do?',
        ['Read out the bill, since they know the account number', 'Explain that you can’t share details until you’ve checked who’s calling', 'End the call'],
        1,
        {
          feedback_correct: 'Right. Account details stay private until you know who you’re talking to.',
          feedback_incorrect: 'Not quite. Don’t share account details until you’ve checked who’s calling.',
        }
      ),
    }),
    b('continue', { label: 'Continue', require_complete: true }),
    b('statement', { text: 'Check who’s calling before you share anything.' }),
  ]);
  const lessons: Lesson[] = [
    ccp,
    steps,
    lesson('Transfers and wrapping up', [
      b('paragraph', { text: 'Sometimes another team needs to help. A good transfer means the caller never has to tell their story twice.' }),
      b('accordion', {
        items: items([
          ['Warm transfer', 'You stay on the line, introduce the caller to your colleague, then leave the call. Use this for most transfers.'],
          ['Cold transfer', 'You send the call straight to another queue without talking to anyone first. Use this only for simple requests, like a question about a bill.'],
          ['Before any transfer', 'Tell the caller who they’re going to and why, and leave a short note so your colleague knows the story.'],
        ]),
      }),
      b('flashcards', {
        cards: cards([
          ['CCP', 'Contact Control Panel — where you take calls in Amazon Connect.'],
          ['ACW', 'After contact work — time after a call to finish your notes.'],
          ['Quick connect', 'A saved person, queue or number you can transfer a call to in a couple of clicks.'],
          ['Queue', 'Where calls wait until someone who can help is free.'],
        ]),
      }),
      b('callout', {
        title: 'Ready for the quiz',
        text: 'The final quiz has seven questions. You need 80% to pass and you have three tries. Pass it to get your certificate.',
        tone: 'success',
      }),
      b('paragraph', { text: 'Want another look first?' }),
      lessonButtons([
        ['Review the five steps of a call', steps],
        ['Review the CCP', ccp],
      ]),
    ]),
  ];

  const questions: Question[] = [
    single(
      'You’re signed in to the CCP but no calls are coming through. What’s the most likely reason?',
      ['Your status isn’t set to Available', 'Your headset volume is too low', 'Nobody is calling today'],
      0,
      { explanation: 'You only get calls when your status is Available.' }
    ),
    trueFalse('If a caller is in a hurry, it’s okay to share account details before you check who’s calling.', false, {
      feedback_correct: 'Correct — always check who’s calling first.',
      feedback_incorrect: 'It’s false. Always check who’s calling first, however busy they are.',
    }),
    question(
      'multiple',
      'Which of these are part of every Riverstone call?',
      [
        ['Greet the caller', true],
        ['Check who’s calling', true],
        ['Sum up what happens next', true],
        ['Offer a discount', false],
      ],
      {
        feedback_correct: 'Yes — greet, check, solve, sum up and wrap up.',
        feedback_incorrect: 'Every call has a greeting, a check on who’s calling and a summary. Discounts aren’t part of it.',
      }
    ),
    single('When is a warm transfer the best choice?', ['When you want the call to end quickly', 'When your colleague needs to hear the story first', 'Never — cold transfers are always better'], 1, {
      explanation: 'Staying on to introduce the caller means they don’t have to repeat themselves.',
    }),
    matching(
      'Match each word with what it means.',
      [
        ['CCP', 'Where you take calls'],
        ['ACW', 'Time to finish notes after a call'],
        ['Quick connect', 'A saved place to transfer a call to'],
      ],
      { feedback_correct: 'All matched!', feedback_incorrect: 'Some pairs are mixed up.', points: 2 }
    ),
    ordering('Put the steps of a Riverstone call in order.', ['Greet the caller', 'Check who’s calling', 'Solve the problem', 'Sum up', 'Wrap up'], {
      feedback_correct: 'That’s it: greet, check, solve, sum up, wrap up.',
      feedback_incorrect: 'Not quite. Greet the caller, check who’s calling, solve the problem, sum up, then wrap up.',
    }),
    fillBlank('When a call ends, you move to ___ to finish your notes.', ['After contact work', 'ACW'], {
      feedback_correct: 'Yes — After contact work (ACW).',
      feedback_incorrect: 'It’s After contact work (ACW).',
    }),
  ];

  return course('certification', {
    title: 'Amazon Connect call handling',
    summary: 'Handle a call from start to finish in Amazon Connect. Finish the lessons, pass the final quiz and get a certificate.',
    cover: '/covers/m_cover_image_5.png',
    lessons,
    quiz: { enabled: true, title: 'Call handling quiz', questions, pool_size: 0, shuffle: true },
  });
}

// ---------------------------------------------------------------------------
// Microlearning: Putting a caller on hold
// ---------------------------------------------------------------------------

function holdCall(): Content {
  const lessons: Lesson[] = [
    lesson('Hold calls the right way', [
      b('paragraph', { text: 'Nobody likes waiting in silence. A good hold takes ten seconds to set up and saves a lot of frustration.' }),
      b('process', {
        items: items([
          ['Ask first', '“Is it okay if I put you on hold for about two minutes while I check that?”'],
          ['Wait for a yes', 'If the caller would rather not wait, offer to call them back instead.'],
          ['Choose Hold', 'In the Contact Control Panel (CCP), choose **Hold**. The caller hears music while they wait.'],
          ['Check back in', 'If it’s taking longer than you said, come back on the line and give a quick update.'],
          ['Thank them', 'Choose **Resume**, say “Thanks for waiting,” then share what you found.'],
        ]),
      }),
      b('statement', { text: 'Never leave a caller on hold for more than two minutes without checking in.' }),
      b('divider', { style: 'spacer' }),
      b('knowledge_check', {
        question: single(
          'You said the hold would take two minutes. It’s been three. What do you do?',
          ['Keep them on hold until you’re finished', 'Come back on the line and give a quick update', 'End the call and call them back later'],
          1,
          {
            feedback_correct: 'Yes — a quick update shows you haven’t forgotten them.',
            feedback_incorrect: 'Come back on the line and give an update. Silence feels much longer than it is.',
          }
        ),
      }),
    ]),
  ];

  return course('microlearning', {
    title: 'Putting a caller on hold',
    summary: 'A two-minute lesson: how to put a caller on hold so they don’t feel forgotten.',
    cover: '',
    lessons,
    quiz: noQuiz(),
  });
}

// ---------------------------------------------------------------------------
// The list Studio shows
// ---------------------------------------------------------------------------

/** One example for each kind of course, in the same order as the course types in "New course". */
export const EXAMPLES: ExampleCourse[] = [
  {
    preset: 'standard',
    title: 'Billing basics at Brightside Bakery',
    description: 'Read an invoice, practice a call about a double charge, then take a short quiz.',
    build: billingBasics,
  },
  {
    preset: 'scenario_lab',
    title: 'Calming an upset caller',
    description: 'Practice two tough calls and see how each answer lands.',
    build: upsetCaller,
  },
  {
    preset: 'required_read',
    title: 'Taking card payments safely',
    description: 'A short policy that people read in order and confirm at the end.',
    build: cardPolicy,
  },
  {
    preset: 'certification',
    title: 'Amazon Connect call handling',
    description: 'Lessons in order, a final quiz to pass, then a certificate.',
    build: callHandling,
  },
  {
    preset: 'microlearning',
    title: 'Putting a caller on hold',
    description: 'One two-minute lesson with a quick check at the end.',
    build: holdCall,
  },
];

/** The first example (Billing basics), for code that only needs one. */
export function exampleCourse(): Content {
  return billingBasics();
}
