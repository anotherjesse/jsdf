export const GLSL_HELPERS = /* glsl */`
precision highp float;

const float SDF_PI = 3.141592653589793;

vec2 safe_div2(vec2 a, vec2 b) {
  return vec2(abs(b.x) < 0.0000001 ? 0.0 : a.x / b.x, abs(b.y) < 0.0000001 ? 0.0 : a.y / b.y);
}

vec3 safe_div3(vec3 a, vec3 b) {
  return vec3(
    abs(b.x) < 0.0000001 ? 0.0 : a.x / b.x,
    abs(b.y) < 0.0000001 ? 0.0 : a.y / b.y,
    abs(b.z) < 0.0000001 ? 0.0 : a.z / b.z
  );
}

float max2(vec2 v) { return max(v.x, v.y); }
float max3(vec3 v) { return max(v.x, max(v.y, v.z)); }
float sgn(float v) { return v >= 0.0 ? 1.0 : -1.0; }
float imod(float a, float b) { return a - b * floor(a / b); }

float ease_linear(float t) { return t; }
float ease_in_quad(float t) { return t * t; }
float ease_out_quad(float t) { return -t * (t - 2.0); }
float ease_in_out_quad(float t) {
  float u = 2.0 * t - 1.0;
  return t < 0.5 ? 2.0 * t * t : -0.5 * (u * (u - 2.0) - 1.0);
}
float ease_in_cubic(float t) { return t * t * t; }
float ease_out_cubic(float t) { float u = t - 1.0; return u * u * u + 1.0; }
float ease_in_out_cubic(float t) {
  float u = t * 2.0;
  float v = u - 2.0;
  return u < 1.0 ? 0.5 * u * u * u : 0.5 * (v * v * v + 2.0);
}
float ease_in_quart(float t) { return t * t * t * t; }
float ease_out_quart(float t) { float u = t - 1.0; return -(u * u * u * u - 1.0); }
float ease_in_out_quart(float t) {
  float u = t * 2.0;
  float v = u - 2.0;
  return u < 1.0 ? 0.5 * u * u * u * u : -0.5 * (v * v * v * v - 2.0);
}
float ease_in_quint(float t) { return t * t * t * t * t; }
float ease_out_quint(float t) { float u = t - 1.0; return u * u * u * u * u + 1.0; }
float ease_in_out_quint(float t) {
  float u = t * 2.0;
  float v = u - 2.0;
  return u < 1.0 ? 0.5 * u * u * u * u * u : 0.5 * (v * v * v * v * v + 2.0);
}
float ease_in_sine(float t) { return -cos(t * SDF_PI / 2.0) + 1.0; }
float ease_out_sine(float t) { return sin(t * SDF_PI / 2.0); }
float ease_in_out_sine(float t) { return -0.5 * (cos(SDF_PI * t) - 1.0); }
float ease_in_expo(float t) { return t == 0.0 ? 0.0 : pow(2.0, 10.0 * (t - 1.0)); }
float ease_out_expo(float t) { return t == 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t); }
float ease_in_out_expo(float t) {
  if (t == 0.0) { return 0.0; }
  if (t == 1.0) { return 1.0; }
  return t < 0.5 ? 0.5 * pow(2.0, 20.0 * t - 10.0) : 1.0 - 0.5 * pow(2.0, -20.0 * t + 10.0);
}
float ease_in_circ(float t) { return -(sqrt(max(0.0, 1.0 - t * t)) - 1.0); }
float ease_out_circ(float t) { float u = t - 1.0; return sqrt(max(0.0, 1.0 - u * u)); }
float ease_in_out_circ(float t) {
  float u = t * 2.0;
  float v = u - 2.0;
  return u < 1.0 ? -0.5 * (sqrt(max(0.0, 1.0 - u * u)) - 1.0) : 0.5 * (sqrt(max(0.0, 1.0 - v * v)) + 1.0);
}
float ease_in_elastic(float t) { float u = t - 1.0; return -(pow(2.0, 10.0 * u) * sin((u - 0.125) * (2.0 * SDF_PI) / 0.5)); }
float ease_out_elastic(float t) { return pow(2.0, -10.0 * t) * sin((t - 0.125) * (2.0 * SDF_PI / 0.5)) + 1.0; }
float ease_in_out_elastic(float t) {
  float u = t * 2.0;
  float v = u - 1.0;
  float a = -0.5 * (pow(2.0, 10.0 * v) * sin((v - 0.125) * 2.0 * SDF_PI / 0.5));
  float b = pow(2.0, -10.0 * v) * sin((v - 0.125) * 2.0 * SDF_PI / 0.5) * 0.5 + 1.0;
  return u < 1.0 ? a : b;
}
float ease_in_back(float t) { return t * t * ((1.70158 + 1.0) * t - 1.70158); }
float ease_out_back(float t) { float u = t - 1.0; return u * u * ((1.70158 + 1.0) * u + 1.70158) + 1.0; }
float ease_in_out_back(float t) {
  float k = 1.70158 * 1.525;
  float u = t * 2.0;
  float v = u - 2.0;
  return u < 1.0 ? 0.5 * (u * u * ((k + 1.0) * u - k)) : 0.5 * (v * v * ((k + 1.0) * v + k) + 2.0);
}
float ease_out_bounce(float t) {
  float a = (121.0 * t * t) / 16.0;
  float b = (363.0 / 40.0 * t * t) - (99.0 / 10.0 * t) + 17.0 / 5.0;
  float c = (4356.0 / 361.0 * t * t) - (35442.0 / 1805.0 * t) + 16061.0 / 1805.0;
  float d = (54.0 / 5.0 * t * t) - (513.0 / 25.0 * t) + 268.0 / 25.0;
  return t < 4.0 / 11.0 ? a : t < 8.0 / 11.0 ? b : t < 0.9 ? c : d;
}
float ease_in_bounce(float t) { return 1.0 - ease_out_bounce(1.0 - t); }
float ease_in_out_bounce(float t) { return t < 0.5 ? ease_in_bounce(2.0 * t) * 0.5 : ease_out_bounce(2.0 * t - 1.0) * 0.5 + 0.5; }
float ease_in_square(float t) { return t < 1.0 ? 0.0 : 1.0; }
float ease_out_square(float t) { return t > 0.0 ? 1.0 : 0.0; }
float ease_in_out_square(float t) { return t < 0.5 ? 0.0 : 1.0; }
`;
