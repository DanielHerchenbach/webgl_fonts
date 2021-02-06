/*
 * Copyright (c) 2017 Anton Stepin astiopin@gmail.com
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

const CHAR_CODES = {
  QUESTION_MARK: 63,
  SPACE: 32,
  NEWLINE: 10
};

/* The font generator tool outputs the font metrics as an array. The following indices are used: */
const CHAR_METRICS = {
  LEFT: 0,
  TOP: 1,
  RIGHT: 2,
  BOTTOM: 3,
  BEARING_X: 4,
  BEARING_Y: 5,
  ADVANCE_X: 6,
  FLAGS: 7
};

function fontMetrics (font, pixelSize, moreLineGap = 0.0) {
  // We use separate scale for the low case characters
  // so that x-height fits the pixel grid.
  // Other characters use the ascend (metrics from the json export are already normalized to ascend = 1) to fit to the pixels
  const capScale = Math.round(pixelSize);
  const lowScale = Math.round(font.xHeight * capScale) / font.xHeight;

  const lineHeight = pixelSize * (1 - font.descent + font.lineGap + moreLineGap);

  /* All font metrics are expressed in terms of the ascent (normalized to ascent = 1).
  To achieve the same for values in terms of texture pixels we have to apply the following factor.
  This is because the glyph height from the font generation tool corresponds to the ascent + abs(descent) = 1 - descent. */
  const scaleTexturePxToMetrics = (1 - font.descent) / font.glyphHeight;

  return {
    capScale: capScale,
    lowScale: lowScale,
    pixelSize: pixelSize,
    lineHeight: lineHeight,
    scaleTexturePxToMetrics: scaleTexturePxToMetrics
  };
}

function charRect (pos, font, fontMetrics, charMetrics, kern = 0.0) {
  // Low case characters have first bit set in 'flags'
  const lowcase = (charMetrics[CHAR_METRICS.FLAGS] & 1) === 1;

  /* Pen position is at the top of the line, Y goes up. Baseline is the ascent (1 * pixelSize)
  below the top of the line. Round to integral pixels for hinting. */
  const baseline = Math.round(pos[1] - fontMetrics.pixelSize);

  /* Low case chars use their own scale. Scale is applied to stretch the glyphs a bit in y-direction
  in order to fit the pixel grid for hinting.
  In horizontal direction no rounding is used (i.e. the scale is simply pixelSize)
  because scaling shall not affect the global text width. */
  const scaleY = lowcase ? fontMetrics.lowScale : fontMetrics.capScale;
  const scaleX = fontMetrics.pixelSize;

  // Laying out the glyph rectangle
  const gLeft = charMetrics[CHAR_METRICS.LEFT];
  const gTop = charMetrics[CHAR_METRICS.TOP];
  const gRight = charMetrics[CHAR_METRICS.RIGHT];
  const gBottom = charMetrics[CHAR_METRICS.BOTTOM];

  const falloff = font.falloff * fontMetrics.scaleTexturePxToMetrics;
  const top = baseline + scaleY * (charMetrics[CHAR_METRICS.BEARING_Y] + falloff);
  const left = pos[0] + scaleX * (charMetrics[CHAR_METRICS.BEARING_X] - falloff + kern);
  const bottom = top - scaleY * fontMetrics.scaleTexturePxToMetrics * (gBottom - gTop);
  const right = left + scaleX * fontMetrics.scaleTexturePxToMetrics * (gRight - gLeft);
  const p = [left, top, right, bottom];

  // Advancing pen position
  const newPosX = pos[0] + scaleX * (charMetrics[CHAR_METRICS.ADVANCE_X] + kern);

  // Signed distance field size in screen pixels
  const sdfSize = 2.0 * falloff * fontMetrics.pixelSize;

  /* Convert from texture pixels to texture coordinates. */
  const gLeftTexture = gLeft / font.textureWidth;
  const gTopTexture = gTop / font.textureHeight;
  const gRightTexture = gRight / font.textureWidth;
  const gBottomTexture = gBottom / font.textureHeight;

  const vertices = [
    p[0], p[1], gLeftTexture, gTopTexture, sdfSize,
    p[2], p[1], gRightTexture, gTopTexture, sdfSize,
    p[0], p[3], gLeftTexture, gBottomTexture, sdfSize,

    p[0], p[3], gLeftTexture, gBottomTexture, sdfSize,
    p[2], p[1], gRightTexture, gTopTexture, sdfSize,
    p[2], p[3], gRightTexture, gBottomTexture, sdfSize];

  return { vertices: vertices, pos: [newPosX, pos[1]] };
}

function writeString (string, font, fontMetrics, pos, vertexArray, strPos = 0, arrayPos = 0) {
  let prevCharCode = null; // Used to calculate kerning
  let cpos = pos; // Current pen position
  let xMax = 0.0; // Max width - used for bounding box

  for (;;) {
    if (strPos === string.length) break;
    const glyphFloatCount = 6 * 5; // two rectangles, 5 floats per vertex
    if (arrayPos + glyphFloatCount >= vertexArray.length) break;

    let currentCharCode = string.charCodeAt(strPos);
    strPos++;

    if (currentCharCode === CHAR_CODES.NEWLINE) {
      if (cpos[0] > xMax) xMax = cpos[0]; // Expanding the bounding rect
      cpos[0] = pos[0];
      cpos[1] -= fontMetrics.lineHeight;
      prevCharCode = null;
      continue;
    }

    if (currentCharCode === CHAR_CODES.SPACE) {
      cpos[0] += font.advanceXSpace * fontMetrics.pixelSize;
      prevCharCode = null;
      continue;
    }

    let charMetrics = font.chars[currentCharCode];
    if (!charMetrics) { // Substituting unavailable characters with '?'
      currentCharCode = CHAR_CODES.QUESTION_MARK;
      charMetrics = font.chars[currentCharCode];
    }

    let kern;
    if (prevCharCode !== null && prevCharCode in font.kerning && currentCharCode in font.kerning[prevCharCode]) {
      kern = font.kerning[prevCharCode][currentCharCode];
    } else {
      kern = 0;
    }

    // calculating the glyph rectangle and copying it to the vertex array
    const rect = charRect(cpos, font, fontMetrics, charMetrics, kern);

    for (let i = 0; i < rect.vertices.length; ++i) {
      vertexArray[arrayPos] = rect.vertices[i];
      arrayPos++;
    }

    prevCharCode = currentCharCode;
    cpos = rect.pos;
  }

  const res = {
    rect: [pos[0], pos[1], xMax - pos[0], pos[1] - cpos[1] + fontMetrics.lineHeight],
    string_pos: strPos,
    array_pos: arrayPos
  };

  return res;
}
