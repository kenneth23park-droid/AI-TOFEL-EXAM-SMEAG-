/* SMEAG StudyGround — tools/make_set_template.mjs : 새 세트 원본 docx 세 장의 빈 틀.
 *
 * 세트는 문서 세 장(문제지·스크립트·정답지)에서 나오고, 가져오는 파서(sg2/assets/set-import.js)
 * 는 문서의 **모양**에 기대어 문항을 찾는다 — 섹션 머리글, 'Questions a-b', 빈칸의 '1co_ _ _',
 * 보기의 'A.', 짧은 응답의 '1.' 표시, 문장 만들기의 문맥/빈칸/타일 세 줄. 모양이 조금만
 * 어긋나도 문항이 사라지거나 정답이 한 칸씩 밀린다. 그래서 빈 틀을 사람이 손으로 만들지
 * 않고 여기서 짓고, tests/test_set_template.mjs 가 그 틀을 **실제 파서에 strict 모드로**
 * 물려 120문항이 stop 없이 지어지는지 확인한다. 파서가 바뀌어 틀이 더는 맞지 않으면 거기서 걸린다.
 *
 *   node studyground/tools/make_set_template.mjs     → studyground/docs/set-template/*.docx
 *
 * 외부 라이브러리 없이 zip 을 직접 짠다(파일 날짜를 고정해 같은 입력이면 같은 바이트).
 * [대괄호] 로 둘러싼 글은 노란 형광으로 칠한다 — 바꿔 넣을 자리다.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = path.join(path.dirname(HERE), 'docs', 'set-template');
export const FILES = {
  questions: 'NEW TOEFL SET XX.docx',
  script: 'SET XX SCRIPT.docx',
  answers: 'SET XX ANSWER KEY.docx'
};

/* ------------------------------------------------------------ 내용 */

const L = ['A', 'B', 'C', 'D'];
const H = (t) => ({ t, bold: true });          // 머리글
const P = (t) => ({ t });
const BLANK = { t: '' };
const IMG = (n) => ({ t: '', img: n });

/* 빈칸 지문 — 번호 + 주어진 글자 + 빠진 글자마다 '_ '. 지문마다 번호는 1 부터 다시 센다. */
const CLOZE = '[Replace this paragraph with the passage.] Honeybees live in large colonies. '
  + 'A 1col_ _ _ can 2con_ _ _ _ tens of thousands 3o_ bees, 4a_ _ each bee 5ha_ a job. '
  + '6Wor_ _ _ bees 7gat_ _ _ nectar 8fr_ _ flowers 9an_ 10bri_ _ it back to the hive.';
const CLOZE_ANSWERS = ['colony', 'contain', 'of', 'and', 'has', 'Worker', 'gather', 'from', 'and', 'bring'];

function mcq(no, stem) {
  return [P(no + '. ' + (stem || '[Question ' + no + ']')),
    ...L.map((x) => P(x + '. [Choice ' + x + ']')), BLANK];
}
function range(a, b) { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; }

function clozeBlock(from, to) {
  return [H('Questions ' + from + '-' + to), P('Fill in the blanks.'), P(CLOZE), BLANK];
}
function passageBlock(from, to, cue, title, paras) {
  return [H('Questions ' + from + '-' + to), P(cue), P(title),
    ...paras.map((x) => P(x)), BLANK, ...range(from, to).flatMap((n) => mcq(n))];
}
function shortResponse(from, to) {
  const out = [H('Questions ' + from + '-' + to), BLANK,
    P('Listen to the question and select the best response from the choices.'), BLANK];
  range(from, to).forEach((n) => {
    out.push(P(n + '.'));
    L.forEach((x) => out.push(P(x + '. [Response ' + x + ']')));
    out.push(BLANK);
  });
  return out;
}
function listenBlock(from, to, cue) {
  return [H('Questions ' + from + '-' + to), P(cue), BLANK, ...range(from, to).flatMap((n) => mcq(n))];
}

const CONV = 'Listen to a conversation.', ANN = 'Listen to an announcement.', TALK = 'Listen to a talk.';
const PASSAGE = ['[Passage paragraph 1. One paragraph per line.]', '[Passage paragraph 2.]', '[Passage paragraph 3.]'];

/* 문장 만들기 — 문맥 줄(번호) / 빈칸 줄(밑줄 2개 이상, 고정 글 섞어도 됨) / 타일 줄(Tab 으로 가름).
   타일이 빈칸보다 많으면 남는 것이 함정 타일이다. 정답지의 문장을 타일로 남김없이 만들 수 있어야 한다. */
const BUILD = [
  { ctx: '1. Did you finish the report?', slots: 'Yes, ______ ______ ______ ______.',
    tiles: ['I sent it', 'to', 'the manager', 'this morning', 'sending'],
    answer: 'Yes, I sent it to the manager this morning.' }
];
for (let n = 2; n <= 10; n++) {
  BUILD.push({ ctx: n + '. [Context ' + n + ' — the question or remark the student reads.]',
    slots: '______ ______ ______ ______.',
    tiles: ['[tile 1]', '[tile 2]', '[tile 3]', '[tile 4]', '[trap tile]'],
    answer: '[tile 1] [tile 2] [tile 3] [tile 4].' });
}

export const QUESTIONS = [
  H('NEW TOEFL SET XX'), BLANK,
  H('READING SECTION'), BLANK,
  H('MODULE 1'),
  ...clozeBlock(1, 10),
  ...clozeBlock(11, 20),
  ...passageBlock(21, 22, 'Read a notice.', '[Notice title]', ['[Notice text. One paragraph per line.]']),
  ...passageBlock(23, 25, 'Read a notice.', '[Notice or review title]', ['[Text paragraph 1.]', '[Text paragraph 2.]']),
  ...passageBlock(26, 30, 'Read a passage.', '[Passage title]', PASSAGE),
  ...passageBlock(31, 35, 'Read a passage.', '[Passage title]', PASSAGE),
  H('MODULE 2'),
  ...clozeBlock(1, 10),
  ...passageBlock(11, 15, 'Read a passage.', '[Passage title]', PASSAGE),

  H('LISTENING SECTION'), BLANK,
  H('MODULE 1'),
  ...shortResponse(1, 12),
  ...listenBlock(13, 14, CONV), ...listenBlock(15, 16, CONV), ...listenBlock(17, 18, CONV),
  ...listenBlock(19, 20, ANN), ...listenBlock(21, 22, ANN), ...listenBlock(23, 24, ANN),
  ...listenBlock(25, 28, TALK), ...listenBlock(29, 32, TALK),
  H('MODULE 2'),
  ...shortResponse(1, 3),
  ...listenBlock(4, 5, CONV), ...listenBlock(6, 7, CONV),
  ...listenBlock(8, 11, TALK), ...listenBlock(12, 15, TALK),

  H('WRITING SECTION'),
  H('Build a sentence'),
  P('Questions 1-10'),
  P('Make an appropriate sentence.'), BLANK,
  ...BUILD.flatMap((b) => [P(b.ctx), P(b.slots), P(b.tiles.join('\t'))]),
  BLANK,
  H('WRITE AN EMAIL'),
  P('To: [Recipient, e.g. Dr. Wilson]'),
  P('Subject: [Subject line]'), BLANK,
  P('SITUATION'),
  P('[Situation — who the student is, what happened, and why they are writing].'), BLANK,
  P('YOUR EMAIL SHOULD'),
  P('[Requirement 1].'), P('[Requirement 2].'), P('[Requirement 3].'), BLANK,
  H('WRITE for an ACADEMIC DISCUSSION'), BLANK,
  P('Professor – [Subject, e.g. Business Management]'), BLANK,
  P('[The professor\'s question. Keep it longer than 80 characters — the importer finds the question by its length.]'), BLANK,
  P('[Student A name]'),
  P('[Student A\'s post — two to four sentences.]'), BLANK,
  P('[Student B name]'),
  P('[Student B\'s post — two to four sentences.]'), BLANK,

  H('SPEAKING SECTION'), BLANK,
  H('Task 1'),
  P('Listen and Repeat'), BLANK,
  ...range(1, 7).flatMap((n) => [IMG(n), P(n + '.'), BLANK]),
  H('Task 2'), BLANK,
  P('Answer the interviewer’s questions.'),
  IMG(8)
];

function scriptBlock(from, to, lines) { return [H('QUESTIONS ' + from + '-' + to), ...lines.map(P), BLANK]; }
const shortLines = (from, to) => range(from, to).map((n) => '[Question ' + n + ' — the sentence the student hears.]');
const convLines = ['M: [Man — first line of the conversation.]', 'W: [Woman — reply.]',
  'M: [Man — next line.]', 'W: [Woman — next line.]'];
const annLines = ['[Announcement — the full text. One paragraph per line.]'];
const talkLines = ['[Talk — paragraph 1.]', '[Talk — paragraph 2.]', '[Talk — paragraph 3.]'];

export const SCRIPT = [
  H('SET XX SCRIPT'),
  H('Listening'),
  H('Module 1'),
  ...scriptBlock(1, 12, shortLines(1, 12)),
  ...scriptBlock(13, 14, convLines), ...scriptBlock(15, 16, convLines), ...scriptBlock(17, 18, convLines),
  ...scriptBlock(19, 20, annLines), ...scriptBlock(21, 22, annLines), ...scriptBlock(23, 24, annLines),
  ...scriptBlock(25, 28, talkLines), ...scriptBlock(29, 32, talkLines),
  H('Module 2'),
  ...scriptBlock(1, 3, shortLines(1, 3)),
  ...scriptBlock(4, 5, convLines), ...scriptBlock(6, 7, convLines),
  ...scriptBlock(8, 11, talkLines), ...scriptBlock(12, 15, talkLines),
  BLANK,
  H('SPEAKING'),
  P('Listen and Repeat'),
  P('[Situation — e.g. You are learning to use the student portal. Listen to the officer and repeat what she says.]'), BLANK,
  ...range(1, 7).map((n) => P('[Sentence ' + n + ' to repeat.]')), BLANK,
  H('INTERVIEW'),
  P('[Situation — e.g. You have volunteered for a research study about health. Please answer the interviewer’s questions.]'), BLANK,
  ...range(1, 4).flatMap((n) => [P(n + '. [Interview question ' + n + '.]'), BLANK])
];

const letters = (n, shift) => range(0, n - 1).map((i) => L[(i + shift) % 4]);
export const ANSWERS = [
  H('SET XX ANSWER KEY'), BLANK,
  H('READING'), BLANK,
  H('Module 1'), BLANK,
  ...CLOZE_ANSWERS.map(P), ...CLOZE_ANSWERS.map(P), ...letters(15, 0).map(P), BLANK,
  H('Module 2'), BLANK,
  ...CLOZE_ANSWERS.map(P), ...letters(5, 1).map(P), BLANK,
  H('LISTENING'), BLANK,
  H('Module 1'), BLANK,
  ...letters(32, 2).map(P), BLANK,
  H('Module 2'), BLANK,
  ...letters(15, 3).map(P), BLANK,
  H('WRITING'), BLANK,
  ...BUILD.map((b) => P(b.answer))
];

/* ------------------------------------------------------------ docx */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function runs(text, bold) {
  const rPr = (hl) => (bold || hl) ? '<w:rPr>' + (bold ? '<w:b/>' : '') + (hl ? '<w:highlight w:val="yellow"/>' : '') + '</w:rPr>' : '';
  return text.split(/(\[[^\]]*\])/).filter(Boolean).map((seg) => {
    const hl = /^\[.*\]$/.test(seg);
    const body = seg.split('\t').map((x) => x ? '<w:t xml:space="preserve">' + esc(x) + '</w:t>' : '').join('<w:tab/>');
    return '<w:r>' + rPr(hl) + body + '</w:r>';
  }).join('');
}

function drawing(n) {
  const cx = 3657600, cy = 2286000;   /* 4in × 2.5in */
  return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
    + '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + n + '" name="Picture ' + n + '"/>'
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:nvPicPr><pic:cNvPr id="' + n + '" name="image' + n + '.png"/><pic:cNvPicPr/></pic:nvPicPr>'
    + '<pic:blipFill><a:blip r:embed="rIdImg' + n + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
    + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

function documentXml(paras) {
  const body = paras.map((p) => '<w:p>' + (p.img ? drawing(p.img) : '') + (p.t ? runs(p.t, p.bold) : '') + '</w:p>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
    + '<w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Malgun Gothic" w:cs="Calibri"/>'
  + '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + '</w:styles>';

function contentTypes(hasPng) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + (hasPng ? '<Default Extension="png" ContentType="image/png"/>' : '')
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '</Types>';
}

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

function docRels(imgs) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + imgs.map((n) => '<Relationship Id="rIdImg' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + n + '.png"/>').join('')
    + '</Relationships>';
}

/* 자리표시 그림 — 연회색 바탕에 테두리. Word 에서 그림을 눌러 '그림 바꾸기' 로 갈아 끼운다. */
function placeholderPng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const edge = x < 4 || y < 4 || x >= w - 4 || y >= h - 4;
      const diag = Math.abs(x * h - y * w) < w * 2 || Math.abs((w - x) * h - y * w) < w * 2;
      const v = edge || diag ? 150 : 232;
      raw.fill(v, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* zip — deflate, 날짜 고정(1980-01-01). */
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function docx(paras) {
  const imgs = paras.filter((p) => p.img).map((p) => p.img);
  const entries = [
    ['[Content_Types].xml', contentTypes(imgs.length > 0)],
    ['_rels/.rels', ROOT_RELS],
    ['word/document.xml', documentXml(paras)],
    ['word/styles.xml', STYLES],
    ['word/_rels/document.xml.rels', docRels(imgs)]
  ];
  const png = imgs.length ? placeholderPng(480, 300) : null;
  imgs.forEach((n) => entries.push(['word/media/image' + n + '.png', png]));
  return zip(entries);
}

/** 세 장을 바이트로. 테스트가 커밋된 파일과 견줄 때도 이것을 부른다. */
export function templateDocs() {
  return { questions: docx(QUESTIONS), script: docx(SCRIPT), answers: docx(ANSWERS) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const docs = templateDocs();
  for (const k of Object.keys(FILES)) {
    fs.writeFileSync(path.join(OUT_DIR, FILES[k]), docs[k]);
    console.log(path.relative(process.cwd(), path.join(OUT_DIR, FILES[k])) + '  ' + docs[k].length + ' bytes');
  }
}
