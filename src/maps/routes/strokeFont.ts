import {
  connectStrokes,
  layoutGlyphStrokes,
  type GlyphStrokes,
  type UnitPoint
} from "../../../electron/routing/sketchGeometry";

/**
 * A single-stroke (skeleton) vector font for GPS-art text, in the spirit of
 * the Hershey Simplex font: each glyph is a set of open polylines rather than
 * filled outlines, so a runner traces every letter exactly once. Glyphs are
 * authored on a 4-wide × 6-tall grid, y up.
 */

type GridStroke = Array<[number, number]>;

interface GridGlyph {
  width: number;
  strokes: GridStroke[];
}

const GLYPH_HEIGHT = 6;

const GRID_GLYPHS: Record<string, GridGlyph> = {
  " ": { width: 3, strokes: [] },
  A: {
    width: 4,
    strokes: [
      [
        [0, 0],
        [2, 6],
        [4, 0]
      ],
      [
        [0.8, 2.4],
        [3.2, 2.4]
      ]
    ]
  },
  B: {
    width: 4,
    strokes: [
      [
        [0, 0],
        [0, 6],
        [3, 6],
        [4, 5.2],
        [4, 3.8],
        [3, 3],
        [0, 3]
      ],
      [
        [3, 3],
        [4, 2.2],
        [4, 0.8],
        [3, 0],
        [0, 0]
      ]
    ]
  },
  C: {
    width: 4,
    strokes: [
      [
        [4, 5],
        [3, 6],
        [1, 6],
        [0, 5],
        [0, 1],
        [1, 0],
        [3, 0],
        [4, 1]
      ]
    ]
  },
  D: {
    width: 4,
    strokes: [
      [
        [0, 0],
        [0, 6],
        [2.5, 6],
        [4, 4.5],
        [4, 1.5],
        [2.5, 0],
        [0, 0]
      ]
    ]
  },
  E: {
    width: 4,
    strokes: [
      [
        [4, 6],
        [0, 6],
        [0, 0],
        [4, 0]
      ],
      [
        [0, 3],
        [3, 3]
      ]
    ]
  },
  F: {
    width: 4,
    strokes: [
      [
        [4, 6],
        [0, 6],
        [0, 0]
      ],
      [
        [0, 3],
        [3, 3]
      ]
    ]
  },
  G: {
    width: 4,
    strokes: [
      [
        [4, 5],
        [3, 6],
        [1, 6],
        [0, 5],
        [0, 1],
        [1, 0],
        [3, 0],
        [4, 1],
        [4, 3],
        [2.5, 3]
      ]
    ]
  },
  H: {
    width: 4,
    strokes: [
      [
        [0, 0],
        [0, 6]
      ],
      [
        [0, 3],
        [4, 3]
      ],
      [
        [4, 6],
        [4, 0]
      ]
    ]
  },
  I: {
    width: 2,
    strokes: [
      [
        [1, 0],
        [1, 6]
      ]
    ]
  },
  J: {
    width: 4,
    strokes: [
      [
        [3, 6],
        [3, 1],
        [2, 0],
        [1, 0],
        [0, 1]
      ]
    ]
  },
  K: {
    width: 4,
    strokes: [
      [
        [0, 0],
        [0, 6]
      ],
      [
        [4, 6],
        [0, 2.8]
      ],
      [
        [1.5, 3.8],
        [4, 0]
      ]
    ]
  },
  L: {
    width: 4,
    strokes: [
      [
        [0, 6],
        [0, 0],
        [4, 0]
      ]
    ]
  },
  M: {
    width: 4,
    strokes: [
      [
        [0, 0],
        [0, 6],
        [2, 2.5],
        [4, 6],
        [4, 0]
      ]
    ]
  },
  N: {
    width: 4,
    strokes: [
      [
        [0, 0],
        [0, 6],
        [4, 0],
        [4, 6]
      ]
    ]
  },
  O: {
    width: 4,
    strokes: [
      [
        [1, 0],
        [0, 1],
        [0, 5],
        [1, 6],
        [3, 6],
        [4, 5],
        [4, 1],
        [3, 0],
        [1, 0]
      ]
    ]
  },
  P: {
    width: 4,
    strokes: [
      [
        [0, 0],
        [0, 6],
        [3, 6],
        [4, 5.2],
        [4, 3.6],
        [3, 2.8],
        [0, 2.8]
      ]
    ]
  },
  Q: {
    width: 4,
    strokes: [
      [
        [1, 0],
        [0, 1],
        [0, 5],
        [1, 6],
        [3, 6],
        [4, 5],
        [4, 1],
        [3, 0],
        [1, 0]
      ],
      [
        [2.5, 1.5],
        [4, -0.4]
      ]
    ]
  },
  R: {
    width: 4,
    strokes: [
      [
        [0, 0],
        [0, 6],
        [3, 6],
        [4, 5.2],
        [4, 3.6],
        [3, 2.8],
        [0, 2.8]
      ],
      [
        [2.5, 2.8],
        [4, 0]
      ]
    ]
  },
  S: {
    width: 4,
    strokes: [
      [
        [4, 5],
        [3, 6],
        [1, 6],
        [0, 5.2],
        [0, 4],
        [1, 3.2],
        [3, 2.8],
        [4, 2],
        [4, 0.8],
        [3, 0],
        [1, 0],
        [0, 1]
      ]
    ]
  },
  T: {
    width: 4,
    strokes: [
      [
        [0, 6],
        [4, 6]
      ],
      [
        [2, 6],
        [2, 0]
      ]
    ]
  },
  U: {
    width: 4,
    strokes: [
      [
        [0, 6],
        [0, 1],
        [1, 0],
        [3, 0],
        [4, 1],
        [4, 6]
      ]
    ]
  },
  V: {
    width: 4,
    strokes: [
      [
        [0, 6],
        [2, 0],
        [4, 6]
      ]
    ]
  },
  W: {
    width: 4,
    strokes: [
      [
        [0, 6],
        [1, 0],
        [2, 4],
        [3, 0],
        [4, 6]
      ]
    ]
  },
  X: {
    width: 4,
    strokes: [
      [
        [0, 0],
        [4, 6]
      ],
      [
        [0, 6],
        [4, 0]
      ]
    ]
  },
  Y: {
    width: 4,
    strokes: [
      [
        [0, 6],
        [2, 3],
        [4, 6]
      ],
      [
        [2, 3],
        [2, 0]
      ]
    ]
  },
  Z: {
    width: 4,
    strokes: [
      [
        [0, 6],
        [4, 6],
        [0, 0],
        [4, 0]
      ]
    ]
  },
  "0": {
    width: 4,
    strokes: [
      [
        [1, 0],
        [0, 1],
        [0, 5],
        [1, 6],
        [3, 6],
        [4, 5],
        [4, 1],
        [3, 0],
        [1, 0]
      ]
    ]
  },
  "1": {
    width: 3,
    strokes: [
      [
        [0.5, 4.8],
        [1.7, 6],
        [1.7, 0]
      ]
    ]
  },
  "2": {
    width: 4,
    strokes: [
      [
        [0, 5],
        [1, 6],
        [3, 6],
        [4, 5],
        [4, 4],
        [0, 0],
        [4, 0]
      ]
    ]
  },
  "3": {
    width: 4,
    strokes: [
      [
        [0, 5],
        [1, 6],
        [3, 6],
        [4, 5],
        [4, 3.8],
        [3, 3],
        [1.5, 3]
      ],
      [
        [3, 3],
        [4, 2.2],
        [4, 1],
        [3, 0],
        [1, 0],
        [0, 1]
      ]
    ]
  },
  "4": {
    width: 4,
    strokes: [
      [
        [3, 0],
        [3, 6],
        [0, 2],
        [4, 2]
      ]
    ]
  },
  "5": {
    width: 4,
    strokes: [
      [
        [4, 6],
        [0, 6],
        [0, 3.5],
        [3, 3.5],
        [4, 2.5],
        [4, 1],
        [3, 0],
        [1, 0],
        [0, 1]
      ]
    ]
  },
  "6": {
    width: 4,
    strokes: [
      [
        [4, 5],
        [3, 6],
        [1, 6],
        [0, 5],
        [0, 1],
        [1, 0],
        [3, 0],
        [4, 1],
        [4, 2.5],
        [3, 3.5],
        [1, 3.5],
        [0, 2.5]
      ]
    ]
  },
  "7": {
    width: 4,
    strokes: [
      [
        [0, 6],
        [4, 6],
        [1.5, 0]
      ]
    ]
  },
  "8": {
    width: 4,
    strokes: [
      [
        [1, 3],
        [0, 4],
        [0, 5],
        [1, 6],
        [3, 6],
        [4, 5],
        [4, 4],
        [3, 3],
        [1, 3],
        [0, 2],
        [0, 1],
        [1, 0],
        [3, 0],
        [4, 1],
        [4, 2],
        [3, 3]
      ]
    ]
  },
  "9": {
    width: 4,
    strokes: [
      [
        [0, 1],
        [1, 0],
        [3, 0],
        [4, 1],
        [4, 5],
        [3, 6],
        [1, 6],
        [0, 5],
        [0, 3.5],
        [1, 2.5],
        [3, 2.5],
        [4, 3.5]
      ]
    ]
  }
};

/** Extra spacing between letters, in em (glyph-height) units. */
const LETTER_TRACKING_EM = 0.25;

function toEmGlyph(glyph: GridGlyph): GlyphStrokes {
  return {
    width: glyph.width / GLYPH_HEIGHT,
    strokes: glyph.strokes.map((stroke) =>
      stroke.map(([x, y]) => ({ x: x / GLYPH_HEIGHT, y: y / GLYPH_HEIGHT }))
    )
  };
}

export function isSketchTextSupported(text: string): boolean {
  return [...text.toUpperCase()].every((char) => GRID_GLYPHS[char]);
}

/**
 * Turns text into one continuous polyline in unit space: x spans [-1, 1]
 * across the full text width, y keeps the same scale (so letters stay
 * proportioned). Pen-travel joins between strokes become ordinary route legs.
 */
export function textToUnitPath(text: string): UnitPoint[] {
  const glyphs = [...text.toUpperCase()]
    .map((char) => GRID_GLYPHS[char])
    .filter((glyph): glyph is GridGlyph => Boolean(glyph))
    .map(toEmGlyph);
  if (glyphs.length === 0) {
    return [];
  }
  const layout = layoutGlyphStrokes(glyphs, LETTER_TRACKING_EM);
  const path = connectStrokes(layout.strokes);
  if (path.length < 2 || layout.width === 0) {
    return [];
  }
  const scale = 2 / layout.width;
  // Glyphs sit on the baseline with cap height 1em; center vertically.
  return path.map((point) => ({
    x: (point.x - layout.width / 2) * scale,
    y: (point.y - 0.5) * scale
  }));
}
