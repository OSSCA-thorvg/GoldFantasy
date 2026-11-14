import type { Phrases } from '../phrases';

/** The grades of an offering at Odin's altar, what each tends to bring, and the rite's new beats. */
const grades = [
  ['Humble', 'humble', '소박한', '작은 정성입니다. 평범한 정착민이 올 때가 많습니다.'],
  ['Worthy', 'worthy', '정성스러운', '알맞은 정성입니다. 재주를 지닌 정착민이 올 때가 많습니다.'],
  ['Bountiful', 'bountiful', '풍성한', '넉넉한 정성입니다. 재능 있고 튼튼한 주민이 올 때가 많습니다.'],
  ['Kingly', 'kingly', '왕다운', '왕에게 어울리는 정성입니다. 영웅이 올 때가 많습니다.'],
] as const;
const lines = [
  'A small gift. It tends to bring a plain settler.',
  'A fair gift. It tends to bring a settler with some skill.',
  'A rich gift. It tends to bring a gifted and hardy resident.',
  'A gift fit for a king. It tends to bring a hero.',
];
const resources = [
  ['water', '물을'],
  ['bones', '뼈를'],
  ['gold', '골드를'],
  ['food', '식량을'],
  ['stone', '석재를'],
] as const;
const callings = [
  ['Warriors', '전사'],
  ['Rangers', '순찰자'],
  ['Mages', '마법사'],
  ['Clerics', '성직자'],
  ['Bards', '음유시인'],
] as const;

const table: Record<string, string> = {
  'No calling is favoured yet.': '아직 기운이 쏠린 직업이 없습니다.',
  'No offering could be greater.': '이보다 큰 제물은 없습니다.',
  'The stores hold too little to raise it further.': '창고가 모자라 더 높일 수 없습니다.',
  'Odin answers': '오딘이 응답합니다',
  'Arrives without equipment': '장비 없이 도착',
  'Often refused': '자주 거절당함',
  'Sometimes refused': '가끔 거절당함',
  'Rarely refused': '드물게 거절당함',
  'Never refused': '거절당하지 않음',
  'Odin sends up to {0} residents; {1} live here.': '오딘은 주민을 최대 {0}명까지 보내며, 현재 {1}명이 삽니다.',
  'Odin will now send up to {0} residents.': '이제 오딘이 주민을 최대 {0}명까지 보냅니다.',
  'Odin sends no more until another floor beyond a gate is cleared.':
    '관문 너머의 층을 하나 더 정복할 때까지 오딘은 더 보내지 않습니다.',
  'Odin turns the offering away': '오딘이 제물을 물리칩니다',
  'The offering was refused. The gifts are gone.': '제물이 거절당했습니다. 바친 것은 사라졌습니다.',
  'No one came.': '아무도 오지 않았습니다.',
  'Odin turned the offering away. The gifts are gone.': '오딘이 제물을 물리쳤습니다. 바친 것은 사라졌습니다.',
};
grades.forEach(([name, lower, korean], i) => {
  table[`${name} offering`] = `${korean} 제물`;
  table[`A ${lower} offering was accepted.`] = `${korean} 제물을 오딘이 받아들였습니다.`;
  table[lines[i]] = grades[i][3];
  if (i)
    for (const [key, word] of resources)
      table[`Lay more ${key} to reach a ${lower} offering.`] = `${word} 더 올리면 ${korean} 제물이 됩니다.`;
});
for (const [name, korean] of callings) table[`Leans toward ${name}.`] = `${korean} 쪽으로 기웁니다.`;

export const offeringPhrases: Phrases = table;
