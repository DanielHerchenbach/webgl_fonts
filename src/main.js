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

/* global loadTexture, initAttribs, createProgram, vertCode, fragCode, colorFromString, fontMetrics, writeString, bindAttribs, requestAnimationFrame */

import arimoFont from './fonts/arimo.js';
import robotoFont from './fonts/roboto.js';

let doUpdate = true;

function updateText () {
  doUpdate = true;
}

export function glMain () {
  // Initializing input widgets

  const fontsSelect = document.getElementById('fonts');
  fontsSelect.addEventListener('input', updateText, false);
  fontsSelect.onchange = updateText;

  const fontSizeInput = document.getElementById('font_size');
  fontSizeInput.addEventListener('input', updateText, false);
  fontSizeInput.onchange = updateText;

  const fontHintingInput = document.getElementById('font_hinting');
  fontHintingInput.addEventListener('input', updateText, false);
  fontHintingInput.onchange = updateText;

  const subpixelInput = document.getElementById('subpixel');
  subpixelInput.addEventListener('input', updateText, false);
  subpixelInput.onchange = updateText;

  const fontColorInput = document.getElementById('font_color');
  fontColorInput.addEventListener('input', updateText, false);
  fontColorInput.onchange = updateText;

  const bgColorInput = document.getElementById('background_color');
  bgColorInput.addEventListener('input', updateText, false);
  bgColorInput.onchange = updateText;

  const textarea = document.getElementById('text');
  textarea.value = `To be, or not to be--that is the question:
Whether 'tis nobler in the mind to suffer
The slings and arrows of outrageous fortune
Or to take arms against a sea of troubles
And by opposing end them. To die, to sleep--
No more--and by a sleep to say we end
The heartache, and the thousand natural shocks
That flesh is heir to. 'Tis a consummation
Devoutly to be wished. To die, to sleep--
To sleep--perchance to dream: ay, there's the rub,
For in that sleep of death what dreams may come
When we have shuffled off this mortal coil,
Must give us pause. There's the respect
That makes calamity of so long life.`;
  textarea.addEventListener('input', updateText, false);
  textarea.onchange = updateText;

  const allFonts = {
    arimo: arimoFont,
    roboto: robotoFont
  };

  // GL stuff

  const canvas = document.getElementById('glcanvas');
  const gl = canvas.getContext('experimental-webgl', { premultipliedAlpha: false, alpha: false });

  // Loading SDF font images. Resulting textures should NOT be mipmapped!
  arimoFont.tex = loadTexture(gl, 'fonts/arimo.png', gl.LUMINANCE, false);
  robotoFont.tex = loadTexture(gl, 'fonts/roboto.png', gl.LUMINANCE, false);

  // Vertex attributes

  const attribs = [
    { loc: 0, name: 'pos', size: 2 }, // Vertex position
    { loc: 1, name: 'tex0', size: 2 }, // Texture coordinate
    { loc: 2, name: 'sdf_size', size: 1 } // Glyph SDF distance in screen pixels
  ];
  initAttribs(gl, attribs);

  // 10000 ought to be enough for anybody

  const vertexArray = new Float32Array(10000 * 6 * attribs[0].stride / 4);

  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexArray, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const prog = createProgram(gl, vertCode, fragCode, attribs);

  let strRes; // Result of a writeString function.
  // Contains text bounding rectangle.

  let vcount = 0; // Text string vertex count
  let tex; // Font texture

  let fontHinting = 1.0;
  let subpixel = 1.0;
  let isBgr = false;
  let isVertical = false;

  let fontColor = [0.1, 0.1, 0.1];
  let bgColor = [0.9, 0.9, 0.9];

  const canvasWidth = canvas.clientWidth;
  const canvasHeight = canvas.clientHeight;
  let pixelRatio = window.devicePixelRatio || 1;

  function render () {
    if (doUpdate) {
      fontColor = colorFromString(fontColorInput.value, [0.1, 0.1, 0.1]);
      bgColor = colorFromString(bgColorInput.value, [0.9, 0.9, 0.9]);

      let font = allFonts[fontsSelect.value];
      if (!font) {
        font = robotoFont;
      }
      tex = font.tex;

      const fontSize = Math.round(fontSizeInput.value * pixelRatio);
      const fmetrics = fontMetrics(font, fontSize, 0.2);

      // Laying out the text
      strRes = writeString(textarea.value, font, fmetrics, [0, 0], vertexArray);
      vcount = strRes.array_pos / (attribs[0].stride / 4 /* size of float */);

      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      fontHinting = fontHintingInput.checked ? 1.0 : 0.0;
      subpixel = subpixelInput.value !== 'off' ? 1.0 : 0.0;
      isBgr = subpixelInput.value === 'bgr_horizontal' || subpixelInput.value === 'bgr_vertical';
      isVertical = subpixelInput.value === 'rgb_vertical' || subpixelInput.value === 'bgr_vertical';

      doUpdate = false;
    }

    // Setting canvas size considering display DPI

    const newPixelRatio = window.devicePixelRatio || 1;

    if (pixelRatio !== newPixelRatio) {
      doUpdate = true;
      pixelRatio = newPixelRatio;
    }

    const cw = Math.round(pixelRatio * canvasWidth * 0.5) * 2.0;
    const ch = Math.round(pixelRatio * canvasHeight * 0.5) * 2.0;

    canvas.width = cw;
    canvas.height = ch;

    canvas.style.width = (cw / pixelRatio) + 'px';
    canvas.style.height = (ch / pixelRatio) + 'px';

    // Centering the text rectangle

    const dx = Math.round(-0.5 * strRes.rect[2]);
    const dy = Math.round(0.5 * strRes.rect[3]);

    const ws = 2.0 / cw;
    const hs = 2.0 / ch;

    // Transformation matrix. 3x3 ortho.
    // Canvas size, [0,0] is at the text rect's top left corner, Y goes up.

    const screenMat = new Float32Array([
      ws, 0, 0,
      0, hs, 0,
      dx * ws, dy * hs, 1
    ]);

    // Clearing the canvas

    gl.clearColor(bgColor[0], bgColor[1], bgColor[2], 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.viewport(0, 0, canvas.width, canvas.height);

    /* The output of the fragment shader (source color) is not an actual color but individual subpixel opacities (alpha_r, alpha_g, alpha_b, alpha_a).
    The following blend function will mix the color in the frame buffer with the (constant) font color according to these opacities. */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.CONSTANT_COLOR, gl.ONE_MINUS_SRC_COLOR);
    gl.blendColor(fontColor[0], fontColor[1], fontColor[2], 1.0);

    // Setting up our shader values and rendering
    // a vcount of vertices from the vertex_buffer

    gl.useProgram(prog.id);

    prog.font_tex.set(0);
    prog.sdf_tex_size.set(tex.image.width, tex.image.height);
    prog.transform.setv(screenMat);
    prog.hint_amount.set(fontHinting);
    prog.subpixel_amount.set(subpixel);
    prog.is_bgr.set(isBgr);
    prog.is_vertical.set(isVertical);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.id);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    bindAttribs(gl, attribs);

    gl.drawArrays(gl.TRIANGLES, 0, vcount);

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}
