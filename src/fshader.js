const fragCode = `
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

precision mediump float;

uniform sampler2D font_tex;
uniform float hint_amount;
uniform float subpixel_amount;
uniform bool is_bgr;
uniform bool is_vertical;

uniform vec3 bg_color;
uniform vec3 font_color;

varying vec2  tc0;
varying float doffset;
varying vec2  sdf_texel;


/*
Let a glyph cover a certain pixel with
pixelCoverage:  the ratio [0, 1] how much of the pixel is covered and
grad:           the normalized gradient vector on the glyph edge.
This function estimates how much of each subpixel (r,g,b) is covered.

subpixelLevel:  If zero, subpixel rendering is off which means all subpixels are equal to pixelCoverage.
                The greater the value (up to approx. 1.0), the stronger the subpixel effect.
isBgr:          Indicates whether the screen uses an RGB or a BGR Bayer pattern. 
isVertical:     Indicates whether the screen uses a horizontal or vertical Bayer pattern.

RGB horizontal:   BGR horizontal:   RGB vertical:   BGR vertical:
                                     _______         _______
| | | |           | | | |           |___R___|       |___B___|
|R|G|B|           |B|G|R|           |___G___|       |___G___|
| | | |           | | | |           |___B___|       |___R___|

For an exact solution one would need to distinguish many cases how the glyph edge intersects with the pixel
so we use a linear approximation.
This approximation considers the horizontal gradient (grad.x) for a horizontal screen Bayer pattern and vice versa.
For both the horizontal and vertical gradient there are three cases for which a solution is simple:

grad.x = -1                grad.x = 0                   grad.x = +1
(glyph edge facing left)   (glyph edge horizontal)      (glyph edge facing right) 
--G--|                                                              |--G--
--L--|                                                              |--L--
--Y--|                          --EDGE--                            |--Y--
--P--|                                                              |--P--
--H--|                                                              |--H--

grad.y = -1                grad.y = 0                   grad.y = +1
(glyph edge facing down)   (glyph edge vertical)        (glyph edge facing up) 
                                 |                               |||||||
 -----                           E                               |GLYPH|
|||||||                          D                               |||||||
|GLYPH|                          G                                -----
|||||||                          E
                                 |
                                
Let's take the horizontal RGB pattern with grad.x = -1 as an example.
--G--|
--L--|         | | | |
--Y--|   -->   |R|G|B|
--P--|         | | | |
--H--|
When the glyph edge moves from the left side of the red superpixel to the right side of the blue superpixel,
the overall pixel coverage rises linearly from 0 to 1.
While rising from 0 to 1/3, the coverage of R rises from 0 to 1, G follows between 1/3 and 2/3 and B between 2/3 and 1.
So in this case, the subpixel coverage is 3 * pixel coverage (plus an offset).
As a second condition, it can be seen easily that for grad.x = 0 all three subpixel coverages shall equal the pixel coverage.
The following equation fulfills those two conditions (and interpolates/approximates linearly for -1 < grad.x < 0):
subpixel coverage = pixel coverage + abs (grad.x) * [2 * pixel coverage - vec3(0, 1, 2)].

The above equation is used for grad.x <= 0. For grad.x >= 0, the subpixel positions (0, 1, 2) have to be flipped because
in this case the blue subpixel is hit first when the pixel coverage rises from 0 to 1 (glyph moves in from the right now).
The subpixel positions have to be flipped as well if a BGR instead of an RGB Bayer pattern is used.
The subpixel positions have to be flipped as well if a vertical bayern pattern instead of a horizontal Bayer pattern is used because
in this case the glyph edge faces down and hits the blue pixel first (for an RGB-pattern) when the gradient is negative. */
lowp vec3 estimateSubpixelCoverage(lowp vec2 grad, lowp float pixelCoverage, lowp float subpixelLevel, bool isBgr, bool isVertical) {
  lowp float slope = isVertical ? grad.y : grad.x;
  slope *= 0.3 * subpixelLevel; // empirical value
  /* Check for inequality because if we flip twice (both because of the sign of the slope and because of the BGR pattern) we effectively do not flip. */
  bool flip = isVertical
    ? (slope < 0.0) != isBgr
    : (slope > 0.0) != isBgr;
  lowp vec3 subpixelPositions = flip ?  vec3(2, 1, 0) : vec3(0, 1, 2);

  lowp vec3 subpixelCoverage = pixelCoverage + abs(slope) * (2.0 * pixelCoverage - subpixelPositions);  
  subpixelCoverage = clamp(subpixelCoverage, 0.0, 1.0 );

  return subpixelCoverage;
}


void main() {
    // Sampling the texture, L pattern
    float sdf       = texture2D( font_tex, tc0 ).r;
    float sdf_north = texture2D( font_tex, tc0 + vec2( 0.0, sdf_texel.y ) ).r;
    float sdf_east  = texture2D( font_tex, tc0 + vec2( sdf_texel.x, 0.0 ) ).r;

    // Estimating stroke direction by the distance field gradient vector
    vec2  sgrad     = vec2( sdf_east - sdf, sdf_north - sdf );
    float sgrad_len = max( length( sgrad ), 1.0 / 128.0 );
    vec2  grad      = sgrad / vec2( sgrad_len );
    float vgrad = abs( grad.y ); // 0.0 - vertical stroke, 1.0 - horizontal one
    
    float horz_scale  = 1.1; // Blurring vertical strokes along the X axis a bit
    float vert_scale  = 0.6; // While adding some contrast to the horizontal strokes
    float hdoffset    = mix( doffset * horz_scale, doffset * vert_scale, vgrad ); 
    float res_doffset = mix( doffset, hdoffset, hint_amount );
    
    float alpha       = smoothstep( 0.5 - res_doffset, 0.5 + res_doffset, sdf );

    // Additional contrast
    alpha             = pow( alpha, 1.0 + 0.2 * vgrad * hint_amount );

    // Unfortunately there is no support for ARB_blend_func_extended in WebGL.
    // Fortunately the background is filled with a solid color so we can do
    // the blending inside the shader.
    
    // Discarding pixels beyond a threshold to minimise possible artifacts.
    if ( alpha < 20.0 / 256.0 ) discard;
    
    vec3 channels = estimateSubpixelCoverage( grad, alpha, subpixel_amount, is_bgr, is_vertical );

    // For subpixel rendering we have to blend each color channel separately
    vec3 res = mix( bg_color, font_color, channels );
    
    gl_FragColor = vec4( res, 1.0 );
}
`;
