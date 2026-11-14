import type { Phrases } from '../phrases';

// First-time explanations, their cards and the guide log.
export const guidePhrases: Phrases = {
  // Card and log
  Guide: '안내',
  'Guide (F1)': '안내 (F1)',
  'Every first-time explanation, to read again.': '처음 겪은 일의 설명을 다시 읽을 수 있습니다.',
  'Every first-time explanation, newest first.': '처음 겪은 일의 설명입니다. 최근 것이 위에 있습니다.',
  'Got it': '확인',
  Look: '보기',
  'Day {0}': '{0}일째',
  '{0} more waiting': '{0}개 더 기다리는 중',
  'Camera focus: On': '카메라 이동: 켬',
  'Camera focus: Off': '카메라 이동: 끔',
  'Cards: On': '안내 카드: 켬',
  'Cards: Off': '안내 카드: 끔',
  Newer: '최근',
  Older: '이전',
  '{0}–{1} of {2}': '{2}개 중 {0}–{1}',
  Earlier: '지난 기록',
  'Nothing yet. An explanation is written here the first time something happens.':
    '아직 기록이 없습니다. 무언가 처음 일어나면 여기에 설명이 적힙니다.',
  '{0} joins the settlement': '{0}이(가) 정착지에 합류했습니다',
  '{0} used {1}': '{0}: {1} 사용',
  '{0} learned {1}': '{0}: {1} 습득',
  'New building: {0}': '새 건물: {0}',
  // The opening
  'The founders wait for your word': '개척자들이 명령을 기다립니다',
  'The founders stand where they woke and do nothing until you act.':
    '개척자들은 깨어난 자리에 선 채, 당신이 움직이기 전까지 아무것도 하지 않습니다.',
  'Select them and give an order, or found a camp from the Quests panel. Once you do, they go about their work by themselves.':
    '그들을 선택해 명령을 내리거나 퀘스트 창에서 캠프를 세우세요. 그때부터 스스로 일을 찾아 합니다.',
  // Gathering
  'The first tree is down': '첫 나무를 베었습니다',
  "A felled tree gives wood. It rides in the feller's pack until the pack grows heavy; then they carry it to storage.":
    '나무를 베면 목재가 나옵니다. 배낭이 무거워질 때까지 벤 사람이 지고 다니다가, 그 뒤 창고로 옮깁니다.',
  'A wooden axe fells trees faster than bare hands.': '나무 도끼가 있으면 맨손보다 나무를 빨리 벱니다.',
  'The first stone is broken': '첫 돌을 깼습니다',
  'Rocky ground gives stone, carried like wood in the pack.':
    '바위 땅에서 석재가 나오며, 목재처럼 배낭에 담아 나릅니다.',
  'A wooden pick breaks stone faster than bare hands. A quarry needs rocky ground close by.':
    '나무 곡괭이가 있으면 맨손보다 돌을 빨리 깹니다. 채석장은 가까이에 바위 땅이 있어야 합니다.',
  'Food from the hunt': '사냥으로 얻은 식량',
  'Food comes from hunting, and from fields once a farmhouse stands. Residents eat from the stores.':
    '식량은 사냥에서, 그리고 농가를 세운 뒤에는 밭에서도 얻습니다. 주민들은 창고의 식량을 먹습니다.',
  'Game grows scarce in winter, so lay food by before it comes.':
    '겨울에는 사냥감이 줄어드니, 겨울이 오기 전에 식량을 모아 두세요.',
  'Hunted animals and slain monsters leave bones, which go straight to storage.':
    '사냥한 짐승과 쓰러뜨린 몬스터는 뼈를 남기며, 뼈는 곧바로 창고로 갑니다.',
  "Offered at the Altar of Odin, bones raise the starting level of the newcomer and lean them toward the Warrior's calling.":
    '오딘의 제단에 뼈를 바치면 새 주민의 처음 레벨이 오르고, 전사의 길로 기울게 됩니다.',
  'A heavy load': '무거운 짐',
  'A heavy pack slows a resident down, and the fuller it gets, the slower they walk.':
    '배낭이 무거우면 걸음이 느려지고, 가득 찰수록 더 느리게 걷습니다.',
  'They empty the pack at storage, so a store near the work saves long walks.':
    '배낭은 창고에서 비우므로, 일터 가까이 창고가 있으면 먼 길을 아낄 수 있습니다.',
  // Making
  'The first piece of gear': '첫 장비',
  "Gear is crafted from the settlement's stores, one piece at a time, and goes straight into a free slot it fits.":
    '장비는 정착지 창고의 자원으로 한 번에 하나씩 만들며, 맞는 빈 칸이 있으면 곧바로 장착됩니다.',
  'Tools make their work faster; weapons hit harder.': '도구는 그 일을 빠르게 하고, 무기는 더 세게 칩니다.',
  'Gear in hand': '손에 든 장비',
  'Gear in hand works at once: a tool speeds the work it is made for, a weapon hits harder and armor takes part of every blow.':
    '손에 든 장비는 바로 효과를 냅니다. 도구는 맞는 일을 빠르게 하고, 무기는 더 세게 치며, 방어구는 받는 피해를 줄입니다.',
  "A resident's window shows what they carry and lets you change it.":
    '주민 창에서 지닌 장비를 보고 바꿀 수 있습니다.',
  'The first field': '첫 밭',
  'Farmhands of a farmhouse tend the fields close to it; more farmhands can tend more fields.':
    '농가의 일꾼들은 농가 가까이의 밭을 돌봅니다. 일꾼이 많을수록 더 많은 밭을 돌볼 수 있습니다.',
  'Fields grow while they are tended through summer and autumn, and the harvest comes in when autumn ends.':
    '밭은 여름과 가을 내내 돌보는 동안 자라며, 가을이 끝날 때 수확합니다.',
  'The first road': '첫 길',
  'Residents walk faster on a road, and faster still once it is paved.':
    '주민들은 길 위에서 더 빨리 걷고, 포장하면 더욱 빨라집니다.',
  'Lumberyards and quarries haul along roads: they open once a road is finished.':
    '벌목장과 채석장은 길을 따라 나르므로, 길이 하나 완성되면 지을 수 있습니다.',
  // The world
  'A gate to another world': '다른 세계로 가는 관문',
  'Each gate leads down, floor by floor, into a world beyond Midgard. Send a party through and destroy every den and the guardian of a floor to clear it.':
    '관문마다 한 층 한 층 내려가며 미드가르드 너머의 세계로 이어집니다. 파티를 보내 그 층의 소굴을 모두 부수고 수호자를 쓰러뜨리면 층을 돌파합니다.',
  'Clear the last floor and the gate is sealed: its raids stop and the settlement keeps a boon of that world.':
    '마지막 층을 돌파하면 관문이 봉인됩니다. 그 관문의 습격이 멈추고, 정착지는 그 세계의 축복을 얻습니다.',
  "The Allfather's likeness in stone stands by the founding shore, where the first two woke.":
    '모든 것의 아버지를 닮은 석상이 처음의 두 사람이 깨어난 해안가에 서 있습니다.',
  'Once a tent and a farmhouse stand, raise an Altar of Odin at home: offerings there shape every new resident.':
    '천막과 농가를 세운 뒤에는 오딘의 제단을 지으세요. 그곳에 바친 제물로 새 주민이 빚어집니다.',
  'A volcano smokes in the south of Midgard. Its slopes are bare mountain rock that no one can cross or build on.':
    '미드가르드 남쪽에서 화산이 연기를 뿜습니다. 그 비탈은 아무도 건너거나 지을 수 없는 산의 바위입니다.',
  'The deep spring in the north from which the rivers flow.': '강물이 흘러나오는 북쪽의 깊은 샘입니다.',
  'Everyone drinks water every day. A well draws it, and more beside a lake or river.':
    '모두가 날마다 물을 마십니다. 우물로 물을 긷고, 호수나 강 옆이면 더 많이 긷습니다.',
  'Night falls': '밤이 옵니다',
  'Residents on Auto stop work and go to sleep; one you send to a workplace keeps at it through the dark.':
    '자동으로 움직이는 주민은 일을 멈추고 잠들지만, 일터로 직접 보낸 주민은 어둠 속에서도 일을 계속합니다.',
  'Sleep under a roof restores them faster than sleep in the open. Raids come at night.':
    '지붕 아래에서 자면 바깥에서 자는 것보다 빨리 기운을 되찾습니다. 습격은 밤에 옵니다.',
  'Rain wears on residents caught outdoors, and a storm wears on them more. A roof or an evening at the tavern sets them right.':
    '비는 바깥에 있는 주민을 지치게 하고, 폭풍은 더 지치게 합니다. 지붕 아래나 선술집에서 보내는 저녁이 그들을 달래 줍니다.',
  'Deep snow slows walking, and the cold wears on anyone without a roof.':
    '눈이 깊이 쌓이면 걸음이 느려지고, 추위는 지붕 없는 이들을 지치게 합니다.',
  'Fields lie fallow and game is scarce, so the settlement lives on what it stored.':
    '밭은 쉬고 사냥감은 드물어, 정착지는 모아 둔 식량으로 버텨야 합니다.',
  'Raids come more often in winter. Keep everyone housed: the cold wears on anyone sleeping out.':
    '겨울에는 습격이 더 잦습니다. 모두에게 집을 마련해 주세요. 밖에서 자면 추위에 지칩니다.',
  'A newcomer from the altar': '제단에서 온 새 주민',
  'Every new resident is shaped by an offering at the Altar of Odin: water, bones, gold, food and stone each lean them a different way.':
    '새 주민은 모두 오딘의 제단에 바친 제물로 빚어집니다. 물, 뼈, 금, 식량, 석재가 저마다 다른 쪽으로 이끕니다.',
  'Make room in a home for them.': '그들이 지낼 집에 자리를 마련해 주세요.',
  // Danger
  'A monster': '몬스터',
  'Monsters climb out of the gates. Swarmers are small and quick and fall to a blow or two, but they come in numbers.':
    '몬스터는 관문에서 기어 나옵니다. 작은 몬스터 떼는 빠르지만 한두 번 치면 쓰러집니다. 대신 수가 많습니다.',
  'Fight them together, not one by one: select residents, press A and click to attack-move.':
    '하나씩 따로가 아니라 함께 싸우세요. 주민들을 선택하고 A를 누른 뒤 클릭하면 공격하며 이동합니다.',
  'The first kill': '첫 처치',
  'A kill gives experience to the killer and to every ally fighting nearby, and many leave bones.':
    '처치하면 쓰러뜨린 주민과 가까이에서 함께 싸운 동료 모두가 경험치를 얻고, 대부분 뼈를 남깁니다.',
  'Each level makes a resident hit harder and hold out longer.':
    '레벨이 오를 때마다 더 세게 치고 더 오래 버팁니다.',
  'A resident is down': '주민이 쓰러졌습니다',
  'A resident at the end of their strength falls, and bleeds out unless an ally kneels beside them in time.':
    '힘이 다한 주민은 쓰러지고, 동료가 제때 곁에 무릎 꿇지 않으면 피를 흘려 숨을 거둡니다.',
  'Select a standing ally and right-click the fallen to raise them. The wound lingers for a few days and keeps their health low until it heals.':
    '서 있는 동료를 선택하고 쓰러진 주민을 오른쪽 클릭하면 일으켜 세웁니다. 부상은 며칠 동안 남고, 나을 때까지 체력이 낮게 머뭅니다.',
  'A resident has died': '주민이 세상을 떠났습니다',
  'The dead do not come back. The memorial keeps their name and deeds.':
    '죽은 이는 돌아오지 않습니다. 추모 기록에 그 이름과 업적이 남습니다.',
  'The settlement grieves; a runestone that names the fallen eases the grief.':
    '정착지는 슬픔에 잠깁니다. 죽은 이의 이름을 새긴 룬석이 슬픔을 덜어 줍니다.',
  'A raid is coming': '습격이 다가옵니다',
  'Raiders come out of an open gate after dark, as many as the settlement looks able to fight.':
    '어두워지면 열린 관문에서 습격대가 나옵니다. 그 수는 정착지의 힘에 맞춰 정해집니다.',
  'Gather fighters by the camp before nightfall. A manned watchtower shoots raiders that come near.':
    '해가 지기 전에 싸울 주민들을 캠프 곁에 모으세요. 사람이 지키는 망루는 가까이 온 습격대를 쏩니다.',
  'The raid is here': '습격이 시작되었습니다',
  'A wave of raiders is on its way; the arrow at the edge of the screen points to where it comes from.':
    '습격대가 몰려옵니다. 화면 가장자리의 화살표가 그들이 오는 쪽을 가리킵니다.',
  'Fight them together near the camp. Once the camp grows into a fort, it shoots at them too.':
    '캠프 가까이에서 함께 싸우세요. 캠프가 요새로 자라면 요새도 적을 쏩니다.',
  'Beyond the gate': '관문 너머',
  'Swarmers pour out of dens until the dens are destroyed. Destroy every den and the guardian to clear the floor.':
    '소굴이 부서질 때까지 몬스터 떼가 쏟아져 나옵니다. 소굴을 모두 부수고 수호자를 쓰러뜨리면 층을 돌파합니다.',
  'Press R to call the party home, ` to select it, and Space to pause and give orders.':
    'R을 누르면 파티를 불러들이고, `를 누르면 파티를 선택하며, Space를 누르면 멈춘 채 명령을 내릴 수 있습니다.',
  'A den': '소굴',
  'A den does not move or bite, but swarmers keep climbing out of it until it is destroyed.':
    '소굴은 움직이거나 물지 않지만, 부서질 때까지 몬스터 떼가 계속 기어 나옵니다.',
  'Break the dens first and the brood thins out.': '소굴부터 부수면 무리가 줄어듭니다.',
  'A den destroyed': '소굴을 부쉈습니다',
  'No more swarmers come from it.': '이제 그곳에서는 몬스터가 나오지 않습니다.',
  'When every den and the guardian of a floor are gone, what is left of the brood dies with them.':
    '한 층의 소굴이 모두 부서지고 수호자가 쓰러지면, 남은 무리도 함께 죽습니다.',
  'The guardian': '수호자',
  'It marks its slam on the ground before it lands: get out of the ring. Below half health it rages and calls its brood.':
    '내려찍기 전에 땅에 표시가 나타나니 그 원 밖으로 피하세요. 체력이 절반 아래로 떨어지면 날뛰며 무리를 부릅니다.',
  'An Aimed Shot breaks its wind-up.': '조준 사격으로 내려찍기 준비를 끊을 수 있습니다.',
  'A floor cleared': '층을 돌파했습니다',
  'A gate is sealed': '관문이 봉인되었습니다',
  'The party can go home with what it found.': '파티는 찾은 것을 가지고 돌아갈 수 있습니다.',
  'Clear all {0} floors of a gate to seal it.': '관문의 {0}층을 모두 돌파하면 관문이 봉인됩니다.',
  'No more raids come from it, and the settlement keeps the boon of its world for good.':
    '이제 그 관문에서는 습격이 오지 않고, 정착지는 그 세계의 축복을 영원히 얻습니다.',
  'Raiders from the gates still open grow stronger week by week.':
    '아직 열린 관문의 습격대는 주마다 강해집니다.',
  'A new level': '새 레벨',
  "Experience from fighting raises a resident's level. Each level makes them hit harder and hold out longer.":
    '싸워서 얻은 경험치로 주민의 레벨이 오릅니다. 레벨이 오를 때마다 더 세게 치고 더 오래 버팁니다.',
  'Callings learn their second skill at level {0}.': '직업마다 레벨 {0}에 두 번째 기술을 배웁니다.',
  'A skill': '기술',
  'Each calling has two skills: the first from level 1, the second from level {0}.':
    '직업마다 기술이 둘 있습니다. 첫 번째는 레벨 1부터, 두 번째는 레벨 {0}부터 씁니다.',
  'Select a resident and press Q or W, or use the skill buttons. On Auto they use them by themselves when it helps.':
    '주민을 선택하고 Q나 W를 누르거나 기술 버튼을 쓰세요. 자동으로 두면 도움이 될 때 스스로 씁니다.',
  'A second skill': '두 번째 기술',
  'At level {0} a calling learns its second skill.': '레벨 {0}이 되면 직업의 두 번째 기술을 배웁니다.',
  'Press W with the resident selected, or set it to Auto on the skill card.':
    '주민을 선택한 채 W를 누르거나, 기술 카드에서 자동으로 두세요.',
  // Buildings
  'One resident works here.': '주민 한 명이 이곳에서 일합니다.',
  'Up to {0} residents work here.': '주민이 {0}명까지 이곳에서 일합니다.',
  'It opens the way to {0} more kinds of building.': '이 건물로 {0}가지 건물을 더 지을 수 있게 됩니다.',
  'It opens the way to {0}.': '이 건물로 지을 수 있게 됩니다: {0}.',
  'Roads open with it: lay one with the Road tool in the build menu.':
    '이제 길을 낼 수 있습니다. 건설 메뉴의 길 도구로 길을 내세요.',
  'Fields open with it: stake one out with the Field tool in the build menu.':
    '이제 밭을 일굴 수 있습니다. 건설 메뉴의 밭 도구로 밭을 정하세요.',
};
