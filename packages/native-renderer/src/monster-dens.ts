// Dens: the nests monsters climb out of. They never move, so they are plain art, one per lair.
import { DungeonKind } from '../../engine/src/world-types';
import { SceneNode, type Rgb } from './paint';
import { dusk } from './form-paint';
import { capsules, discs, fills } from './rig-skin';

const ink: Rgb = [26, 22, 32];
export interface Den {
  art: SceneNode;
  /** How far the art rises above the ground, in world pixels. */
  top: number;
  shadow: readonly [number, number];
}
export function denArt(lair: DungeonKind): Den {
  const art = new SceneNode();
  switch (lair) {
    case DungeonKind.Cave: {
      // A burrow under a bank of earth, with what the pack has gnawed lying about.
      const earth: Rgb = [112, 98, 84];
      art
        .add(
          fills(earth, [
            [-28, 0],
            [-22, -10],
            [-12, -17],
            [2, -19],
            [16, -15],
            [26, -7],
            [30, 0],
          ]),
        )
        .add(
          fills(
            [146, 130, 106],
            [
              [-22, -10],
              [-12, -17],
              [2, -19],
              [-2, -12],
              [-14, -8],
            ],
          ),
        )
        .add(discs(ink, [2, -5, 9.5, 6.5]))
        .add(capsules(1.2, [226, 216, 190], [15, -1.5, 21, -2.5], [17, -4.5, 19.5, 0.3]));
      return { art, top: 19, shadow: [30, 7] };
    }
    case DungeonKind.Crypt: {
      // A barrow mouth: two uprights and a lintel set into a grown-over mound.
      const stone: Rgb = [152, 152, 160];
      art
        .add(
          fills(
            [104, 126, 92],
            [
              [-30, 0],
              [-24, -12],
              [-10, -20],
              [8, -21],
              [22, -14],
              [30, 0],
            ],
          ),
        )
        .add(
          fills(ink, [
            [-3, 0],
            [-3, -15],
            [5, -15],
            [5, 0],
          ]),
        )
        .add(
          fills(
            stone,
            [
              [-9, 0],
              [-8, -15],
              [-3, -15],
              [-3, 0],
            ],
            [
              [5, 0],
              [5, -15],
              [10, -15],
              [11, 0],
            ],
            [
              [-11, -15],
              [13, -15],
              [12, -19],
              [-10, -19],
            ],
          ),
        )
        .add(
          fills(
            dusk(stone, 0.4),
            [
              [8, -15],
              [10, -15],
              [11, 0],
              [9, 0],
            ],
            [
              [2, -19],
              [12, -19],
              [13, -15],
              [3, -15],
            ],
          ),
        )
        .add(discs([150, 226, 212], [-0.2, -8, 0.5], [2.4, -8.2, 0.45]));
      return { art, top: 21, shadow: [31, 7] };
    }
    case DungeonKind.Portal:
    case DungeonKind.Return: {
      // A rift: a tear standing in the air, with splinters of the far side adrift round it.
      art
        .add(discs([40, 32, 56, 150], [0, 0, 13, 4]))
        .add(
          fills(
            [56, 42, 90],
            [
              [0, -34],
              [5, -26],
              [3, -20],
              [8, -12],
              [4, -6],
              [6, 0],
              [-4, 0],
              [-6, -8],
              [-2, -14],
              [-7, -22],
              [-3, -28],
            ],
          ),
        )
        .add(
          fills(
            [158, 116, 176],
            [
              [0, -30],
              [2.5, -24],
              [1, -18],
              [4, -11],
              [1.5, -5],
              [0, -9],
              [-2, -15],
              [-1, -22],
            ],
          ),
        )
        .add(
          fills(
            [199, 131, 38],
            [
              [-12, -18],
              [-9, -22],
              [-8, -16],
            ],
            [
              [11, -26],
              [14, -23],
              [10, -21],
            ],
            [
              [-10, -6],
              [-13, -3],
              [-8, -2],
            ],
          ),
        );
      return { art, top: 34, shadow: [13, 4] };
    }
    case DungeonKind.GiantHall: {
      // A cairn of boulders, rimed on top, with the giants' rune on its capstone.
      const stone: Rgb = [120, 126, 142];
      art
        .add(discs(dusk(stone, 0.42), [-11, -6, 12, 7.4], [11, -6, 12.6, 7.8], [0, -17, 10.6, 7.4]))
        .add(discs(stone, [-12, -6.6, 10.6, 6.6], [10, -6.6, 11.4, 7], [-1, -17.6, 9.6, 6.6]))
        .add(
          fills(ink, [
            [-3, 0],
            [-2, -8],
            [2, -9],
            [4, 0],
          ]),
        )
        .add(
          fills(
            [210, 224, 236],
            [
              [-9, -22],
              [-2, -25],
              [6, -23],
              [3, -20.5],
              [-5, -19.5],
            ],
          ),
        )
        .add(
          capsules(
            0.9,
            [46, 44, 70],
            [-3, -19.5, -3, -13.5],
            [-3, -18.2, -0.2, -16.6],
            [-0.2, -16.6, -3, -15],
          ),
        );
      return { art, top: 25, shadow: [28, 7] };
    }
    default: {
      // A goblin warren: a hole propped with stolen timber in a heap of rubble, a rag for a banner.
      const rubble: Rgb = [128, 122, 112],
        wood: Rgb = [122, 92, 62];
      art
        .add(
          fills(rubble, [
            [-28, 0],
            [-20, -9],
            [-9, -13],
            [-2, -11],
            [6, -16],
            [18, -12],
            [28, 0],
          ]),
        )
        .add(
          fills(
            [160, 152, 136],
            [
              [-20, -9],
              [-9, -13],
              [-2, -11],
              [-8, -6],
              [-16, -5],
            ],
          ),
        )
        .add(
          fills(ink, [
            [-6, 0],
            [-5, -8],
            [0, -11],
            [6, -8],
            [7, 0],
          ]),
        )
        .add(capsules(1.6, wood, [-7, 0, -6, -9], [8, 0, 7, -9], [-7.5, -9.6, 8.5, -9.6]))
        .add(capsules(0.7, wood, [16, -12, 16, -24]))
        .add(
          fills(
            [170, 86, 52],
            [
              [16, -24],
              [23, -22],
              [16, -19],
            ],
          ),
        );
      return { art, top: 24, shadow: [29, 7] };
    }
  }
}
