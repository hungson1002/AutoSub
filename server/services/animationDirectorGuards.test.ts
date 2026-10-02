import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guardRewriteTargets,
  storyboardConcreteEvidenceIssues,
  storyboardDeterministicGuardIssues,
  storyboardMascotRoleIssues,
  storyboardMascotCloneCastIssues,
  storyboardMetaphorDensityIssues,
  storyboardTextTrapIssues,
  storyboardUnlockedStoryCastIssues,
} from './animationDirectorGuards';

test('mascot may act as a stable viewer-proxy inside the story frame', () => {
  const issues = storyboardMascotRoleIssues([
    {
      title: 'Night',
      narration: '',
      visualBeats: [
        { characterRefs: ['mascot'], visual: 'The normal unchanged mascot is sleeping in bed in a dark apartment.', narrationCue: 'He is asleep.' },
        { characterRefs: ['mascot'], visual: 'Presenter mascot points to a simple illustrated doorway while explaining the idea.', narrationCue: 'Here is the key.' },
        { characterRefs: ['mascot'], visual: 'The normal mascot points a flashlight down the hallway as a viewer proxy.', narrationCue: 'He checks the hallway.' },
      ],
    },
  ]);
  assert.equal(issues.length, 0);
});

test('mascot story-role guard also catches prompts that forgot characterRefs', () => {
  const issues = storyboardMascotRoleIssues([
    { visualBeats: [{ characterRefs: [], visual: 'The reference mascot is dressed as a prehistoric hunter carrying a spear through tall grass.' }] },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, 'MASCOT_STORY_ROLE');
});

test('three repeated brain metaphors inside four visuals trigger a diversity repair', () => {
  const issues = storyboardMetaphorDensityIssues([
    {
      visualBeats: [
        { visual: 'A glowing brain with arrows.' },
        { visual: 'A dark hallway with a hanging coat.' },
        { visual: 'A brain with gears inside.' },
        { visual: 'A neural brain diagram metaphor.' },
      ],
    },
  ]);
  assert.ok(issues.some((item) => item.code === 'METAPHOR_REPETITION'));
});

test('mascot may share the setting but cannot be redesigned as a story identity', () => {
  const issues = storyboardMascotRoleIssues([
    {
      visualBeats: [
        { characterRefs: ['mascot'], visual: 'Presenter mascot walks through the forest beside a bear while keeping the normal mascot outfit.' },
        { characterRefs: ['mascot'], visual: 'The mascot works as a doctor treating a patient, wearing a doctor uniform.' },
        { characterRefs: ['mascot'], visual: 'Presenter mascot points to an inset illustration of a forest while explaining fear.' },
      ],
    },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.beatIndex, 1);
});

test('visible story people must be locked to CAST ids', () => {
  const issues = storyboardUnlockedStoryCastIssues([
    {
      visualBeats: [
        { visual: 'A young man in a brown shirt freezes beside his bed.' },
        { characterRefs: ['CAST_01'], visual: 'CAST_01, the same young man, reaches for the lamp.' },
        { visual: 'Anonymous background extras cross the street.' },
      ],
    },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, 'UNLOCKED_STORY_CAST');
  assert.equal(issues[0]?.beatIndex, 0);
});

test('non-mascot humans cannot reuse the mascot white-round-head identity language', () => {
  const issues = storyboardMascotCloneCastIssues([
    {
      visualBeats: [
        { visual: 'A young man with a blank white round head, round glasses and a yellow scarf stands beside the bed.' },
        { visual: 'A young man with short brown hair, a human face silhouette and a dark blue pajama shirt stands beside the bed.' },
        { characterRefs: ['mascot'], visual: 'The mascot with its normal white round head points toward the hallway.' },
      ],
    },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, 'MASCOT_CLONE_CAST');
  assert.equal(issues[0]?.beatIndex, 0);
  assert.equal(storyboardDeterministicGuardIssues([
    { visualBeats: [{ visual: 'A young man with a blank white round head stands beside the bed.' }] },
  ]).some((item) => item.code === 'MASCOT_CLONE_CAST'), true);
  assert.equal(storyboardMascotCloneCastIssues([
    { visualBeats: [{ visual: 'A young man with messy black hair, a distinct human face silhouette and thin one-stroke arms and legs stands beside the bed.' }] },
  ]).length, 0);
});

test('generic people in separate mini-stories do not get merged into one global CAST identity', () => {
  const issues = storyboardUnlockedStoryCastIssues([
    { visualBeats: [{ visual: 'A young man in a brown shirt checks a warehouse door.' }] },
    { visualBeats: [{ visual: 'A young man in a blue shirt joins a different laboratory experiment.' }] },
  ]);
  assert.equal(issues.length, 0);
});

test('text-bearing surfaces are rejected when no on-screen text is approved', () => {
  const issues = storyboardTextTrapIssues([
    {
      visualBeats: [
        { visual: 'A warning poster hangs behind the character.' },
        { visual: 'A blank unmarked poster hangs behind the character.' },
        { onScreenText: '02:13', visual: 'A simple digital clock screen shows 02:13.' },
      ],
    },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, 'TEXT_TRAP_RISK');
});

test('text-trap detection stays available for image prompting/QC but does not block the storyboard gate', () => {
  const segments = [{ visualBeats: [{ visual: 'A warning poster hangs behind the character.' }] }];
  assert.equal(storyboardTextTrapIssues(segments).length, 1);
  assert.equal(storyboardDeterministicGuardIssues(segments).some((item) => item.code === 'TEXT_TRAP_RISK'), false);
});

test('metaphor family may return later when repetitions are not locally dense', () => {
  const visuals = [
    'A brain cross-section.',
    'A hallway.',
    'A frightened face.',
    'A coat.',
    'A lamp.',
    'A bedroom.',
    'A phone.',
    'A door.',
    'An amygdala inside a brain.',
    'A floorboard.',
    'A window.',
    'A hand on a switch.',
    'A kitchen.',
    'A staircase.',
    'A street.',
    'A clock.',
    'Neural activity inside the brain.',
  ];
  const issues = storyboardMetaphorDensityIssues([{ visualBeats: visuals.map((visual) => ({ visual })) }]);
  assert.equal(issues.length, 0);
});

test('named concrete evidence must also appear in the visual prompt', () => {
  const issues = storyboardConcreteEvidenceIssues([
    {
      visualBeats: [
        { narrationCue: 'Chiếc áo khoác treo ở cửa trông giống một người.', visual: 'A generic fear symbol floating in darkness.' },
        { narrationCue: 'Điện thoại sáng lên.', visual: 'A smartphone lights the character face.' },
      ],
    },
  ]);
  assert.equal(issues.length, 2);
  assert.ok(issues.some((item) => /coat\/jacket/i.test(item.message)));
  assert.ok(issues.some((item) => /door\/doorway/i.test(item.message)));
});

test('deterministic guard returns unique one-based scene rewrite targets', () => {
  const issues = storyboardDeterministicGuardIssues([
    { visualBeats: [{ characterRefs: ['mascot'], visual: 'Mascot works as a doctor treating a patient.' }] },
    { visualBeats: [{ narrationCue: 'A coat hangs in the hallway.', visual: 'A generic warning icon.' }] },
  ]);
  assert.deepEqual(guardRewriteTargets(issues), [1, 2]);
});
