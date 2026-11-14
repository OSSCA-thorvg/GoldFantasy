import type { Phrases } from '../phrases';

/** Army controls, orders, skills, swarms and dens, the worlds beyond gates, the downed and the memorial. */
export const combatPhrases: Phrases = {
  // Army keys and the fighters at hand
  'No fighter is free: the warriors, rangers, mages, clerics and bards are busy or indoors':
    '나설 수 있는 전투원이 없습니다: 전사, 순찰자, 마법사, 성직자, 음유시인이 모두 바쁘거나 실내에 있습니다',
  'No one selected can hold here': '선택한 주민 중 이곳을 사수할 수 있는 이가 없습니다',
  'Select a resident first.': '먼저 주민을 선택하세요.',
  'No one can reach {0}': '{0}에게 갈 수 있는 이가 없습니다',

  // Control groups
  'Select residents first, then Ctrl+{0} makes them group {1}': '먼저 주민을 선택하세요. Ctrl+{0} 키로 {1}번 부대를 지정합니다',
  'Group {0} is empty: select residents and press Ctrl+{1}': '{0}번 부대가 비어 있습니다: 주민을 선택하고 Ctrl+{1} 키를 누르세요',
  'Group {0}: {1}': '{0}번 부대: {1}',
  '{0} down. Health {1}% on average.': '{0}명 쓰러짐. 평균 체력 {1}%.',
  'Health {0}% on average.': '평균 체력 {0}%.',
  'Tap to select them; tap again to look at them.': '탭하면 선택하고, 한 번 더 탭하면 화면을 옮깁니다.',
  '{0} selects them, {1} twice looks at them. Ctrl+{2} remakes the group, Shift+{3} adds to it.':
    '{0} 키로 선택, {1} 키를 두 번 누르면 화면 이동. Ctrl+{2} 키로 다시 지정, Shift+{3} 키로 추가합니다.',
  'Make group {0}': '{0}번 부대 지정',
  'The selected residents become group {0}; tap its tab to select them again.':
    '선택한 주민이 {0}번 부대가 됩니다. 부대 탭을 누르면 다시 선택합니다.',
  'The selected residents become group {0} (Ctrl+{1}); press {2} to select them again.':
    '선택한 주민이 {0}번 부대가 됩니다 (Ctrl+{1}). {2} 키를 누르면 다시 선택합니다.',

  // Key hints beyond a gate
  'Q / W skills  ·  H hold  ·  S stop  ·  R recall': 'Q / W 기술  ·  H 사수  ·  S 정지  ·  R 소집',
  'M move past enemies  ·  A attack-move  ·  ` party': 'M 적 무시 이동  ·  A 공격 이동  ·  ` 파티',
  'Ctrl+1-9 make a group, 1-9 select it': 'Ctrl+1-9 부대 지정, 1-9 부대 선택',
  'Right-click a downed ally to revive  ·  Space pause': '쓰러진 동료 우클릭: 일으키기  ·  Space 일시 정지',

  // The orders card
  'Choose a building for the selected residents to raise.': '선택한 주민이 지을 건물을 고르세요.',
  'Walk to the point you click and ignore enemies on the way. A group arrives in formation: blades in front, bows and staves behind.':
    '클릭한 곳으로 걸어가며 가는 길의 적은 무시합니다. 무리는 대형을 갖춰 도착합니다: 칼날은 앞에, 활과 지팡이는 뒤에 섭니다.',
  'Attack-move': '공격 이동',
  'Walk to the point you click and fight whatever they meet. Click an enemy to make it everyone’s first target.':
    '클릭한 곳으로 걸어가며 마주치는 적과 싸웁니다. 적을 클릭하면 모두가 그 적부터 노립니다.',
  Hold: '사수',
  'Hold position': '위치 사수',
  'Stand on this spot, strike whatever comes into reach and never chase. Skills on auto still fire. Any other order ends it.':
    '이 자리에 서서 닿는 적을 치고 절대 쫓지 않습니다. 자동 기술은 그대로 씁니다. 다른 명령을 내리면 풀립니다.',
  Stop: '정지',
  'Drop the current order and stand still.': '지금 명령을 거두고 그 자리에 섭니다.',
  'Fell, mine, build, mend or tend what you click next. Right-click does the same at once.':
    '다음에 클릭하는 것을 베고, 캐고, 짓고, 고치거나 돌봅니다. 우클릭하면 바로 같은 일을 합니다.',
  'Demolish a building, a field or a road with these residents.': '이 주민들로 건물, 밭 또는 길을 철거합니다.',
  'Put the tool down and go back to selecting (Q while a tool is in hand).':
    '도구를 내려놓고 선택으로 돌아갑니다 (도구를 든 동안 Q).',
  'Come out of the building they are in.': '들어가 있는 건물에서 나옵니다.',
  '{0}  ({1})': '{0}  ({1})',
  'Holding position: strikes what comes into reach, never chases': '위치 사수: 닿는 적을 치고 쫓지 않습니다',
  'No farm stands close enough to work this field': '이 밭을 돌볼 만큼 가까운 농장이 없습니다',
  'The farm by this field has no room for more workers': '이 밭의 농장에는 일꾼 자리가 더 없습니다',

  // Skill names
  Challenge: '도발',
  Whirl: '회전 베기',
  'Aimed Shot': '조준 사격',
  Volley: '화살비',
  'Rune Burst': '룬 폭발',
  'Frost Ring': '서리 고리',
  Mend: '치료',
  Sanctuary: '성역',
  'Rallying Verse': '격려의 노래',
  Dirge: '비탄의 노래',

  // The skill card
  'Q  {0}': 'Q  {0}',
  'W  {0}': 'W  {0}',
  Active: '발동',
  Ready: '준비됨',
  'Auto on': '자동 켬',
  'Auto off': '자동 끔',
  'Auto-use is on': '자동 사용 켜짐',
  'Auto-use is off': '자동 사용 꺼짐',
  '{0} uses {1} on their own when it helps.': '{0}은(는) 도움이 될 때 {1}을(를) 스스로 씁니다.',
  'The {0} who have it use {1} on their own when it helps.': '이 기술이 있는 {0}명이 도움이 될 때 {1}을(를) 스스로 씁니다.',
  '{0} waits for your order.': '{0}: 명령을 기다립니다.',
  'Every skill starts on auto. Turn it off to time it by hand.': '모든 기술은 자동으로 시작합니다. 끄면 직접 때를 골라 씁니다.',
  'Comes at level {0}.': '레벨 {0}에 배웁니다.',
  'Comes at level {0}. {1}': '레벨 {0}에 배웁니다. {1}',
  '{0} more get it at level {1}.': '나머지 {0}명은 레벨 {1}에 배웁니다.',
  'Tap, then tap the ground where it should land.': '탭한 뒤 떨어질 곳의 땅을 탭하세요.',
  'Tap to use it for every selected resident of this calling who has it ready.':
    '탭하면 선택한 이 직업 주민 중 준비된 모두가 씁니다.',
  '{0}: hold to see where it lands under the cursor, release to cast. Or click here, then the ground.':
    '{0}: 누르고 있으면 커서 아래에 떨어질 곳이 보이고, 떼면 시전합니다. 또는 여기를 클릭한 뒤 땅을 클릭하세요.',
  '{0}: every selected resident who has it ready uses it.': '{0}: 선택한 주민 중 준비된 모두가 씁니다.',
  '{0} comes at level {1}': '{0}: 레벨 {1}에 배웁니다',
  '{0} ×{1}': '{0} ×{1}',
  '{0}: {1}/{2} ready': '{0}: {1}/{2} 준비됨',
  '{0}: level {1}': '{0}: 레벨 {1}',
  'Tap to show their skills.': '탭하면 이 직업의 기술을 보여 줍니다.',
  'Click or press Tab to show their skills. Q and W still fire for everyone selected.':
    '클릭하거나 Tab 키를 누르면 이 직업의 기술을 보여 줍니다. Q와 W는 그대로 선택한 모두가 씁니다.',

  // Firing skills
  'No one selected has a second skill': '선택한 주민 중 두 번째 기술이 있는 이가 없습니다',
  'No one selected has a skill': '선택한 주민 중 기술이 있는 이가 없습니다',
  'Second skills come at level {0}': '두 번째 기술은 레벨 {0}에 배웁니다',
  '{0} is ready in {1} s': '{0}: {1}초 뒤 준비됩니다',
  'Skills are recovering (the first is ready in {0} s)': '기술을 회복하는 중입니다 ({0}초 뒤 첫 기술 준비)',
  '{0}: no one in reach': '{0}: 닿는 곳에 아무도 없습니다',
  '{0}: release {1} over the ground to cast': '{0}: 땅 위에서 {1} 키를 떼면 시전합니다',
  'Tap the ground for {0}': '{0}: 땅을 탭하세요',
  '{0}: click the ground; right-click cancels': '{0}: 땅을 클릭하세요. 우클릭하면 취소합니다',
  'the skill': '기술',
  'Volley and Frost Ring': '화살비, 서리 고리',
  'Frost Ring and Volley': '서리 고리, 화살비',

  // Beyond a gate: the party panel
  // The list joint splits these first, so each piece has its own key.
  '{0}/{1} dens': '소굴 {0}/{1}',
  '{0}/{1} dens  ·  {2}': '소굴 {0}/{1}  ·  {2}',
  'Dens {0} of {1}': '소굴 {0}/{1}',
  'Monsters {0}': '몬스터 {0}',
  'Dens {0} of {1}  ·  Monsters {2}': '소굴 {0}/{1}  ·  몬스터 {2}',
  'Go home leaves behind: {0}': '귀환하면 남겨지는 이: {0}',
  'Recall party (R)': '파티 소집 (R)',
  '{0}, {1}, level {2}': '{0}, {1}, 레벨 {2}',
  'Downed: bleeds out in {0} s. Select an ally and right-click the body to revive.':
    '쓰러짐: {0}초 뒤 숨을 거둡니다. 동료를 선택하고 쓰러진 이를 우클릭해 일으키세요.',
  'Downed: bleeds out in {0} s unless an ally kneels beside them':
    '쓰러짐: 동료가 곁에 무릎 꿇지 않으면 {0}초 뒤 숨을 거둡니다',
  '{0} is ready': '{0} 준비됨',
  '{0} in {1} s': '{0}: {1}초 뒤',
  'Click to select; click twice to look.': '클릭하면 선택, 두 번 클릭하면 화면을 옮깁니다.',

  // Swarms and dens (the banner detail is one line: keep it short)
  'A den is destroyed': '소굴을 부쉈습니다',
  'The last den is destroyed': '마지막 소굴을 부쉈습니다',
  '{0} struck the last blow. {1}': '{0}의 마지막 일격. {1}',
  '{0} of {1} still breeds.': '소굴 {1}곳 중 {0}곳 남음.',
  '{0} of {1} still breed.': '소굴 {1}곳 중 {0}곳 남음.',
  'No more will climb out.': '더는 기어 나오지 않습니다.',
  'The brood breaks': '무리가 무너집니다',
  '{0} monster dies with their dens. The floor is clear.': '몬스터 {0}마리도 함께 죽었습니다. 층을 돌파했습니다.',
  '{0} monsters die with their dens. The floor is clear.': '몬스터 {0}마리도 함께 죽었습니다. 층을 돌파했습니다.',
  'A raid wave of {0} comes from the {1}': '{1}에서 습격대 {0}마리가 몰려옵니다',
  'A den is destroyed ({0} left)': '소굴을 부쉈습니다 ({0}곳 남음)',
  'The guardian has fallen; {0} den still breeds': '수호자가 쓰러졌습니다. 소굴 {0}곳이 아직 몬스터를 낳습니다',
  'The guardian has fallen; {0} dens still breed': '수호자가 쓰러졌습니다. 소굴 {0}곳이 아직 몬스터를 낳습니다',
  'What was left of the brood dies with it ({0})': '남은 무리도 함께 죽었습니다 ({0})',
  'The guardian roars and its brood answers': '수호자가 포효하자 무리가 응답합니다',

  // The expedition forecast
  'too few to stand against a swarm': '몬스터 떼를 막기에는 수가 너무 적습니다',
  'likely to lose this floor': '이 층에서 질 가능성이 큽니다',
  'a hard fight': '힘든 싸움이 됩니다',
  ready: '준비되었습니다',
  'Selected: {0} at level {1} on average, {2}.': '선택: {0}명, 평균 레벨 {1}. {2}.',
  'Your fighters: {0} at level {1} on average, {2}.': '전투원: {0}명, 평균 레벨 {1}. {2}.',

  // The guardian
  'The guardian of {0} is roused': '{0}의 수호자가 깨어났습니다',
  'this world': '이 세계',
  'Its slam is marked on the ground before it lands: move away.': '내려찍기는 떨어지기 전에 땅에 표시됩니다: 피하세요.',
  'Guardian of {0}': '{0}의 수호자',
  Enraged: '격노',
  'Winding up a slam: move away! ({0} s)': '내려찍기 준비 중: 피하세요! ({0}초)',

  // The downed and the auto-pause
  '{0} is down': '{0}이(가) 쓰러졌습니다',
  '{0} has died': '{0}이(가) 세상을 떠났습니다',
  '{0} and {1} are down': '{0}, {1}이(가) 쓰러졌습니다',
  '{0} residents are down': '주민 {0}명이 쓰러졌습니다',
  'Paused. You can give orders while paused.': '일시 정지됨. 멈춘 동안에도 명령할 수 있습니다.',
  'Go to them': '찾아가기',
  'Go to it': '살펴보기',
  Resume: '다시 진행',
  'Resume (Space)': '다시 진행 (Space)',
  '{0} is bleeding out': '{0}이(가) 피를 흘리고 있습니다',
  'Click to look and select the nearest ally who can help, then right-click the body to revive.':
    '클릭하면 그곳을 비추고 도울 수 있는 가장 가까운 동료를 선택합니다. 그다음 쓰러진 이를 우클릭해 일으키세요.',
  '+{0} more down': '+{0}명 더 쓰러짐',
  'Downed: another resident must tend them before they bleed out.':
    '쓰러짐: 숨을 거두기 전에 다른 주민이 돌봐야 합니다.',
  'This resident has stepped into the gate.': '이 주민은 관문 안으로 들어갔습니다.',
  '{0} is down and bleeding out': '{0}이(가) 쓰러져 피를 흘리고 있습니다',
  '{0} is back on their feet': '{0}이(가) 다시 일어섰습니다',
  '{0} has died of their wounds': '{0}이(가) 상처로 숨을 거두었습니다',
  '{0} was killed by the guardian': '{0}: 수호자에게 죽었습니다',
  '{0} was left behind beyond {1}': '{0}이(가) {1} 너머에 남겨졌습니다',
  '{0} would be left behind to die': '{0}은(는) 남겨져 죽게 됩니다',
  '{0}. {1} would be left behind to die': '{0}. {1}은(는) 남겨져 죽게 됩니다',
  '{0} casts the fallen party back out, gravely wounded; the spoils are lost':
    '{0}이(가) 쓰러진 파티를 밖으로 내던졌습니다. 모두 크게 다쳤고 전리품을 잃었습니다',

  // Causes of death
  'Killed by monsters': '몬스터에게 목숨을 잃음',
  'Killed by the guardian': '수호자에게 목숨을 잃음',
  'Killed by a provoked giant': '성난 거인에게 목숨을 잃음',
  'Killed by {0}': '{0}에게 목숨을 잃음',
  'Killed by a {0}': '{0}에게 목숨을 잃음',
  'Died of wounds': '상처로 숨짐',
  Starved: '굶어 죽음',
  'Died of the cold': '얼어 죽음',
  'Left behind beyond {0}': '{0} 너머에 남겨짐',
  wolf: '늑대',
  cow: '소',
  pig: '돼지',
  chicken: '닭',
  dog: '개',
  cat: '고양이',

  // The memorial
  '{0} will be missed at the fire.': '모닥불 곁의 모두가 {0}을(를) 그리워할 것입니다.',
  'The settlement will remember {0}.': '정착지는 {0}을(를) 기억할 것입니다.',
  'Rest now, {0}; others keep the watch.': '이제 쉬어요, {0}. 남은 이들이 자리를 지킵니다.',
  "{0}'s place at the table stays empty tonight.": '오늘 밤 식탁의 {0} 자리는 비어 있습니다.',
  '{0} in {1}, on day {2}.': '{2}일째, {1}에서 {0}.',
  // Outweighs 'Left behind beyond {0}', which would otherwise swallow the place and the day.
  'Left behind beyond {0} in {1}, on day {2}.': '{2}일째, {1}에서 {0} 너머에 남겨짐.',
  '{0} kill': '처치 {0}',
  '{0} kills': '처치 {0}',
  '{0} day in the settlement': '정착지에서 {0}일',
  '{0} days in the settlement': '정착지에서 {0}일',
  'their first day in the settlement': '정착지에서의 첫날',
  '{0} more to remember': '기억할 이가 {0}명 더 있습니다',
  Farewell: '작별',

  // Floating combat words
  Block: '막음',
  DOWN: '쓰러짐',
};
