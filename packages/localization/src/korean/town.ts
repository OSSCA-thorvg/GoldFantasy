import type { Phrases } from '../phrases';

export const townPhrases: Phrases = {
  // town-construction: ground and placement reasons
  'Unexplored land': '미탐험 지역',
  "Odin's statue": '오딘의 석상',
  'Another world': '다른 세계',
  Water: '물',
  Mountains: '산',
  Ice: '얼음',
  Lava: '용암',
  'Rocky ground': '암석 지대',
  'A dungeon entrance': '던전 입구',
  'Grows from an earlier stage': '이전 단계에서 성장합니다',
  'Needs {0} people in this village': '이 마을에 주민 {0}명이 필요합니다',
  'Found the camp first': '먼저 캠프를 세우세요',
  'Camps must stand far apart': '캠프는 서로 멀리 떨어져야 합니다',
  'Must be closer to a dungeon': '던전에 더 가까워야 합니다',
  'Torches need a completed road': '횃불은 완성된 길에만 세울 수 있습니다',
  Occupied: '이미 사용 중',
  'On the road': '길 위',
  'Fields in the way': '밭이 가로막고 있습니다',
  'Needs forest close by': '가까이에 숲이 필요합니다',
  'Needs rocky ground close by': '가까이에 암석 지대가 필요합니다',

  // town-construction: roads
  'Hold and draw a road': '누른 채로 길을 그리세요',
  'Too short': '너무 짧습니다',
  'Too long': '너무 깁니다',
  'Cannot bridge the sea': '바다에는 다리를 놓을 수 없습니다',
  'A bridge needs dry banks': '다리 양 끝은 마른 땅이어야 합니다',
  'Bridge too long': '다리가 너무 깁니다',
  'Building in the way': '건물이 가로막고 있습니다',
  'Must connect to the settlement': '정착지와 이어져야 합니다',
  'Must connect to a camp or its roads': '캠프 또는 캠프의 길과 이어져야 합니다',
  'This road belongs to a neutral settlement': '중립 정착지의 길입니다',
  'Road already exists': '이미 길이 있습니다',
  'No road there': '그곳에는 길이 없습니다',
  'Already paved': '이미 포장되었습니다',
  'Lay the road first': '먼저 길을 놓으세요',
  'No such road': '없는 길입니다',

  // town-construction: fields and demolition
  'Click to outline a field': '클릭해서 밭의 윤곽을 그리세요',
  'The outline crosses itself': '윤곽선이 서로 겹칩니다',
  'Too small': '너무 작습니다',
  'At most {0} acres per field': '밭 하나는 최대 {0}에이커입니다',
  'Not arable': '경작할 수 없는 땅',
  'Too dry for crops': '작물을 기르기에 너무 건조합니다',
  'Too cold for crops': '작물을 기르기에 너무 춥습니다',
  'Road in the way': '길이 가로막고 있습니다',
  'Needs a farmhouse close by': '가까이에 농가가 필요합니다',
  'This building belongs to a neutral settlement': '중립 정착지의 건물입니다',
  'The seat of the settlement stays': '정착지의 본거지는 철거할 수 없습니다',
  'This field belongs to a neutral settlement': '중립 정착지의 밭입니다',
  'Nothing to clear': '철거할 것이 없습니다',

  // town-construction: notices
  'The chapel now follows the {0}': '예배당이 이제 따르는 신앙: {0}',
  '{0} moves from the {1} to the {2}': '{0}: {1}에서 {2} 쪽으로 일터를 옮깁니다',
  'Discovered {0}, home to neutral coastal giants': '{0} 발견: 중립 해안 거인들의 거처',
  'Discovered {0}, a way to {1}': '{0} 발견: {1} 방면으로 가는 길',
  '{0} (x{1})': '{0} (x{1})',

  // town-devotion
  'Complete an altar first.': '먼저 제단을 완성하세요.',
  'This altar belongs to another settlement.': '다른 정착지의 제단입니다.',
  'Complete a camp for this altar.': '이 제단이 속한 캠프를 완성하세요.',
  'A resident is waiting for an available home.': '새 주민이 빈 집을 기다리고 있습니다.',
  'A resident is already preparing this altar.': '다른 주민이 이미 이 제단을 준비하고 있습니다.',
  'No free resident bed. Complete a home in this settlement.':
    '남는 주민 침대가 없습니다. 이 정착지에 집을 완성하세요.',
  'Need 4 food for the altar offering.': '제단 공물로 식량 4가 필요합니다.',
  'An available resident must be present in this settlement.':
    '이 정착지에 움직일 수 있는 주민이 있어야 합니다.',
  'The settlement does not have enough resources for this offering.':
    '정착지에 이 공물을 바칠 자원이 부족합니다.',
  'Guests cannot pray for a new resident.': '손님은 새 주민을 위해 기도할 수 없습니다.',
  'Choose an available resident of this settlement.': '이 정착지의 움직일 수 있는 주민을 선택하세요.',
  "Choose a resident who lives in this altar's settlement.": '이 제단이 있는 정착지의 주민을 선택하세요.',
  'Given breath at the altar of Odin.': '오딘의 제단에서 숨을 받았습니다.',
  'Shaped from an offering at the altar of Ymir.': '오딘의 제단에서 숨을 받았습니다.',
  'Called into the world by a prayer at the settlement altar.':
    '정착지 제단의 기도에 응해 세상에 불려 왔습니다.',
  '{0} is shaped by the offering and joins the settlement.':
    '{0}: 공물에서 빚어져 정착지에 합류했습니다.',
  '{0} appears at the altar and joins the settlement.': '{0}: 제단에 나타나 정착지에 합류했습니다.',

  // town-models: seasons
  Spring: '봄',
  Summer: '여름',
  Autumn: '가을',
  Winter: '겨울',

  // town-economy
  'Autumn ends with no harvest': '수확 없이 가을이 끝났습니다',
  'Harvest: +{0} food': '수확: 식량 +{0}',
  'Harvest: +{0} food ({1} produced, {2} not stored)': '수확: 식량 +{0} (생산 {1}, 저장하지 못함 {2})',
  'Spring begins': '봄이 시작됩니다',
  'Spring of year {0} begins': '{0}년째 봄이 시작됩니다',
  'Summer begins': '여름이 시작됩니다',
  'Autumn begins': '가을이 시작됩니다',
  'Winter begins': '겨울이 시작됩니다',
  'Winter is one season away: fields will lie fallow and game will thin. Store food.':
    '한 계절 뒤면 겨울입니다. 밭은 쉬고 사냥감은 줄어듭니다. 식량을 비축하세요.',
  'Winter: game is scarce and hungry monsters raid more often':
    '겨울: 사냥감이 드물고 굶주린 몬스터의 습격이 잦아집니다',
  'The stores are full: build a suitable depot or storehouse':
    '저장고가 가득 찼습니다. 알맞은 보관소나 창고를 지으세요',
  '{0} bought their {1} for {2} gold': '{0}: 살던 {1} 구입 ({2} 골드)',
  'Needs food in store': '비축된 식량이 필요합니다',
  'Needs a market close by': '가까이에 시장이 필요합니다',
  'Needs {0} workers': '일꾼 {0}명이 필요합니다',
  'Needs {0} people': '주민 {0}명이 필요합니다',
  'In a town of {0}, merges with 3 mature townhouses huddled beside it':
    '주민 {0}명인 마을에서, 곁에 모인 다 자란 연립주택 3채와 합쳐집니다',
  'Needs a full house ({0}/{1}) in a town of {2}': '주민 {2}명인 마을에서 집이 가득 차야 합니다 ({0}/{1})',
  'Needs {0} gold from guests ({1} so far)': '손님 수입 {0} 골드 필요 (현재 {1})',
  'Needs {0} residents trained ({1} so far)': '훈련을 마친 주민 {0}명이 필요합니다 (현재 {1}명)',
  'Needs clear ground around it to grow': '성장하려면 주변에 빈 땅이 필요합니다',
  'Waiting for {0}': '{0} 대기 중',
  '{0} grew into a {1}': '{0}: {1} 단계로 성장했습니다',
  'Four townhouses merged into a manor': '연립주택 4채가 저택으로 합쳐졌습니다',

  // town-encounters
  'A giant is slain (+{0} gold)': '거인을 처치했습니다 (+{0} 골드)',
  'A monster is slain (+{0} gold)': '몬스터를 처치했습니다 (+{0} 골드)',
  'The raid is beaten off ({0} slain, +{1} gold)': '습격을 물리쳤습니다 ({0}마리 처치, +{1} 골드)',

  // town-equipment
  'Select a controllable resident': '조작할 수 있는 주민을 선택하세요',
  'A completed home camp is required': '완성된 소속 캠프가 필요합니다',
  'Move closer to your settlement storage': '정착지 저장 시설에 더 가까이 이동하세요',
  'This item cannot be crafted': '제작할 수 없는 아이템입니다',
  'A completed matching workshop is required': '완성된 알맞은 작업장이 필요합니다',
  'Use a workshop in this resident’s settlement': '이 주민이 속한 정착지의 작업장을 이용하세요',
  'Finish or cancel the current crafting order': '진행 중인 제작 명령을 끝내거나 취소하세요',
  'The inventory is full': '소지품이 가득 찼습니다',
  'Not enough settlement materials': '정착지의 재료가 부족합니다',
  '{0} crafted {1}': '{0}: {1} 제작 완료',
  '{0} stopped making the {1}': '{0}: {1} 만들기를 그만두었습니다',
  '{0} in hand': '{0}을(를) 손에 들었습니다',
  'Build a workbench first': '먼저 작업대를 지으세요',

  // town-hiring
  'Guests are temporary visitors. New residents arrive through an altar prayer.':
    '손님은 잠시 머무는 방문객입니다. 새 주민은 제단의 기도로 찾아옵니다.',
  'A close-combat profession that strikes hardest. Equip a crafted weapon for stronger attacks.':
    '가장 강하게 공격하는 근접 전투 직업입니다. 제작한 무기를 장비하면 공격이 더 강해집니다.',
  'A ranged-combat profession that strikes harder. Equip a crafted bow to attack from a distance.':
    '더 강하게 공격하는 원거리 전투 직업입니다. 제작한 활을 장비하면 멀리서 공격합니다.',
  'A rune-casting profession that strikes harder. Equip a crafted staff to attack from a distance.':
    '더 강하게 공격하는 룬 마법 직업입니다. 제작한 지팡이를 장비하면 멀리서 공격합니다.',
  'A sworn guardian who fights at close range. Monsters hit the cleric and nearby allies softer.':
    '근거리에서 싸우는 서약의 수호자입니다. 몬스터가 성직자와 가까운 아군에게 주는 피해가 줄어듭니다.',
  'A keeper of songs who fights at close range. Nearby allies strike harder.':
    '근거리에서 싸우는 노래의 전승자입니다. 가까운 아군이 더 강하게 공격합니다.',
  'Complete a guild first.': '먼저 길드를 완성하세요.',
  'This guild belongs to another settlement.': '다른 정착지의 길드입니다.',
  'Guests cannot train or become residents.': '손님은 훈련을 받거나 주민이 될 수 없습니다.',
  "Choose a resident who lives in this guild's settlement.": '이 길드가 있는 정착지의 주민을 선택하세요.',
  'This resident has already chosen a profession.': '이 주민은 이미 직업을 골랐습니다.',
  'Choose a guild profession.': '길드 직업을 선택하세요.',
  'Need 12 gold for the professional oath.': '직업 서약에 12 골드가 필요합니다.',
  'Need 4 food for the training supplies.': '훈련 보급품으로 식량 4가 필요합니다.',
  '{0} has taken the oath of a {1}.': '{0}: {1}의 서약을 맺었습니다.',

  // town-monsters
  'A horde pours out of {0}!': '{0}에서 몬스터 무리가 쏟아져 나옵니다!',
  'Great brutes from {0} march on the settlement!': '{0}에서 나온 거대한 괴수들이 정착지로 진군합니다!',
  'Raiders close in from {0} and {1}!': '습격대가 두 곳에서 조여 옵니다: {0}, {1}!',
  'Monsters from {0} raid the settlement!': '{0}에서 나온 몬스터들이 정착지를 습격합니다!',
  'Select residents to send': '보낼 주민을 선택하세요',
  '{0} set out for floor {1} beyond {2}': '{0}명이 {2} 너머 {1}층으로 출발합니다',
  '{0} was killed by a provoked giant': '{0}: 성난 거인에게 죽었습니다',
  '{0} was killed by monsters': '{0}: 몬스터에게 죽었습니다',
  '{0} was killed': '{0}: 죽었습니다',
  '{0} reached level {1}!': '{0}: 레벨 {1} 달성!',
  "A guest was killed: the settlement's renown suffers": '손님이 죽었습니다. 정착지의 명성이 떨어집니다',
  'Monsters tore up a paved road': '몬스터가 포장된 길을 파헤쳤습니다',
  'Monsters tore up a road': '몬스터가 길을 파헤쳤습니다',
  'Monsters wrecked the {0} site': '몬스터가 건설 현장을 부쉈습니다: {0}',
  'Monsters destroyed the {0}': '몬스터가 건물을 파괴했습니다: {0}',

  // town-people
  '{0} moves on': '{0}: 다음 여정을 떠납니다',
  '{0} leaves, unhappy': '{0}: 불만을 품고 떠납니다',

  // town-realm: expedition reasons
  'No known dungeon there': '그곳에 알려진 던전이 없습니다',
  'A neutral giant dwelling': '중립 거인의 거처',
  'This floor is already cleared': '이미 정리한 층입니다',
  'Clear the floor above first': '먼저 위층을 정리하세요',
  'A party is already beyond another gate': '다른 관문 너머에 이미 파티가 있습니다',
  'Another party is on its way to a gate': '다른 파티가 관문으로 가는 중입니다',
  'This map has no open sea for the world beyond': '이 지도에는 너머의 세계가 자리할 넓은 바다가 없습니다',
  'No party is beyond a gate': '관문 너머에 파티가 없습니다',
  'The party is fighting': '파티가 전투 중입니다',
  'Gather the whole party at the way home': '파티 전원을 귀환로에 모으세요',
  'The party is fighting (portal recall needs {0} mana)':
    '파티가 전투 중입니다 (포털 소환에는 마나 {0} 필요)',
  'Gather the whole party at the way home (portal recall needs {0} mana)':
    '파티 전원을 귀환로에 모으세요 (포털 소환에는 마나 {0} 필요)',

  // town-realm: notices
  'The way home': '귀환로',
  '{0} more step through {1} to join the party': '{0}명이 {1} 너머로 건너가 파티에 합류합니다',
  'The party steps through {0} into {1} (floor {2} of {3})':
    '파티가 {0} 너머로 건너갑니다: {1} ({3}층 중 {2}층)',
  'The portal pulls the party home for {0}': '포털이 파티를 불러들였습니다 (소모: {0})',
  'The party returns from {0} empty-handed': '파티가 {0}에서 빈손으로 귀환했습니다',
  'The party returns from {0} with {1}': '파티가 {0}에서 귀환했습니다. 획득: {1}',
  'The party withdraws from {0} empty-handed': '파티가 {0}에서 빈손으로 철수했습니다',
  'The party withdraws from {0} with {1}': '파티가 {0}에서 철수했습니다. 획득: {1}',
  'No one returned from {0}': '{0}에서 아무도 돌아오지 못했습니다',
  '{0} is sealed. Every gate is closed: Midgard is safe!':
    '{0} 봉인 완료. 모든 관문이 닫혔습니다. 미드가르드는 안전합니다!',
  '{0} is sealed for good ({1} of {2} gates closed)': '{0} 영구 봉인 (관문 {2}개 중 {1}개 닫힘)',
  '{0}: the guardian of floor {1} has fallen': '{0}: {1}층의 수호자가 쓰러졌습니다',

  // town-realm: reward panel
  '{0} is sealed': '{0} 봉인 완료',
  'Floor {0} cleared': '{0}층 정리 완료',
  '{0} is sealed for good ({1} of {2} gates).': '{0} 영구 봉인 (관문 {2}개 중 {1}개).',
  'Every survivor gains {0} levels.': '생존자 전원의 레벨이 {0} 오릅니다.',
  'Floor {0} of {1} is now open.': '{1}의 {0}층이 열렸습니다.',
  'This floor had already been cleared: a smaller hoard.': '이미 정리한 층이라 전리품이 적습니다.',
  'Hoard: {0}.': '전리품: {0}.',
  'Go home from anywhere to bank the spoils.': '어디서든 귀환하면 전리품을 정착지로 가져갑니다.',

  // town-residents: guest arrivals
  '{0}, a traveller, arrives': '{0}: 여행자가 도착했습니다',
  '{0}, a traveller, arrives through the portal': '{0}: 여행자가 포털을 통해 도착했습니다',
  '{0}, a bard, arrives to play at the tavern': '{0}: 음유시인이 선술집에서 연주하러 도착했습니다',
  '{0}, a bard, arrives through the portal to play at the tavern':
    '{0}: 음유시인이 선술집에서 연주하러 포털을 통해 도착했습니다',
  '{0}, an adventurer ({1}), arrives': '{0}: 모험가({1})가 도착했습니다',
  '{0}, an adventurer ({1}), arrives through the portal': '{0}: 모험가({1})가 포털을 통해 도착했습니다',

  // town-tick
  '{0} starved to death': '{0}: 굶어 죽었습니다',
  '{0} died of the cold': '{0}: 얼어 죽었습니다',
  '{0} is repaired': '{0} 수리 완료',
  '{0} is finished': '{0} 건설 완료',
  'A road is mended': '길을 보수했습니다',
  'A road is paved with stone': '길을 돌로 포장했습니다',
  'A road is laid': '길을 놓았습니다',

  // town-wildlife
  '{0} hunted (carrying {1} food)': '{0} 사냥 성공 (식량 {1} 운반 중)',
  '{0} hunted (+{1} food)': '{0} 사냥 성공 (식량 +{1})',
  '{0} fell while hunting': '{0}: 사냥 중에 쓰러졌습니다',
};
