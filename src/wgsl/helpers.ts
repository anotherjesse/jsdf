export const WGSL_HELPERS = /* wgsl */`
const SDF_PI = 3.141592653589793;

fn safe_div2(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(select(a.x / b.x, 0.0, abs(b.x) < 0.0000001), select(a.y / b.y, 0.0, abs(b.y) < 0.0000001));
}

fn safe_div3(a: vec3f, b: vec3f) -> vec3f {
  return vec3f(
    select(a.x / b.x, 0.0, abs(b.x) < 0.0000001),
    select(a.y / b.y, 0.0, abs(b.y) < 0.0000001),
    select(a.z / b.z, 0.0, abs(b.z) < 0.0000001)
  );
}

fn max2(v: vec2f) -> f32 { return max(v.x, v.y); }
fn max3(v: vec3f) -> f32 { return max(v.x, max(v.y, v.z)); }
fn sgn(v: f32) -> f32 { return select(-1.0, 1.0, v >= 0.0); }
fn imod(a: f32, b: f32) -> f32 { return a - b * floor(a / b); }

fn ease_linear(t: f32) -> f32 { return t; }
fn ease_in_quad(t: f32) -> f32 { return t * t; }
fn ease_out_quad(t: f32) -> f32 { return -t * (t - 2.0); }
fn ease_in_out_quad(t: f32) -> f32 {
  let u = 2.0 * t - 1.0;
  return select(-0.5 * (u * (u - 2.0) - 1.0), 2.0 * t * t, t < 0.5);
}
fn ease_in_cubic(t: f32) -> f32 { return t * t * t; }
fn ease_out_cubic(t: f32) -> f32 { let u = t - 1.0; return u * u * u + 1.0; }
fn ease_in_out_cubic(t: f32) -> f32 {
  let u = t * 2.0;
  let v = u - 2.0;
  return select(0.5 * (v * v * v + 2.0), 0.5 * u * u * u, u < 1.0);
}
fn ease_in_quart(t: f32) -> f32 { return t * t * t * t; }
fn ease_out_quart(t: f32) -> f32 { let u = t - 1.0; return -(u * u * u * u - 1.0); }
fn ease_in_out_quart(t: f32) -> f32 {
  let u = t * 2.0;
  let v = u - 2.0;
  return select(-0.5 * (v * v * v * v - 2.0), 0.5 * u * u * u * u, u < 1.0);
}
fn ease_in_quint(t: f32) -> f32 { return t * t * t * t * t; }
fn ease_out_quint(t: f32) -> f32 { let u = t - 1.0; return u * u * u * u * u + 1.0; }
fn ease_in_out_quint(t: f32) -> f32 {
  let u = t * 2.0;
  let v = u - 2.0;
  return select(0.5 * (v * v * v * v * v + 2.0), 0.5 * u * u * u * u * u, u < 1.0);
}
fn ease_in_sine(t: f32) -> f32 { return -cos(t * SDF_PI / 2.0) + 1.0; }
fn ease_out_sine(t: f32) -> f32 { return sin(t * SDF_PI / 2.0); }
fn ease_in_out_sine(t: f32) -> f32 { return -0.5 * (cos(SDF_PI * t) - 1.0); }
fn ease_in_expo(t: f32) -> f32 { return select(pow(2.0, 10.0 * (t - 1.0)), 0.0, t == 0.0); }
fn ease_out_expo(t: f32) -> f32 { return select(1.0 - pow(2.0, -10.0 * t), 1.0, t == 1.0); }
fn ease_in_out_expo(t: f32) -> f32 {
  if (t == 0.0) { return 0.0; }
  if (t == 1.0) { return 1.0; }
  return select(1.0 - 0.5 * pow(2.0, -20.0 * t + 10.0), 0.5 * pow(2.0, 20.0 * t - 10.0), t < 0.5);
}
fn ease_in_circ(t: f32) -> f32 { return -(sqrt(max(0.0, 1.0 - t * t)) - 1.0); }
fn ease_out_circ(t: f32) -> f32 { let u = t - 1.0; return sqrt(max(0.0, 1.0 - u * u)); }
fn ease_in_out_circ(t: f32) -> f32 {
  let u = t * 2.0;
  let v = u - 2.0;
  return select(0.5 * (sqrt(max(0.0, 1.0 - v * v)) + 1.0), -0.5 * (sqrt(max(0.0, 1.0 - u * u)) - 1.0), u < 1.0);
}
fn ease_in_elastic(t: f32) -> f32 { let u = t - 1.0; return -(pow(2.0, 10.0 * u) * sin((u - 0.125) * (2.0 * SDF_PI) / 0.5)); }
fn ease_out_elastic(t: f32) -> f32 { return pow(2.0, -10.0 * t) * sin((t - 0.125) * (2.0 * SDF_PI / 0.5)) + 1.0; }
fn ease_in_out_elastic(t: f32) -> f32 {
  let u = t * 2.0;
  let v = u - 1.0;
  let a = -0.5 * (pow(2.0, 10.0 * v) * sin((v - 0.125) * 2.0 * SDF_PI / 0.5));
  let b = pow(2.0, -10.0 * v) * sin((v - 0.125) * 2.0 * SDF_PI / 0.5) * 0.5 + 1.0;
  return select(b, a, u < 1.0);
}
fn ease_in_back(t: f32) -> f32 { return t * t * ((1.70158 + 1.0) * t - 1.70158); }
fn ease_out_back(t: f32) -> f32 { let u = t - 1.0; return u * u * ((1.70158 + 1.0) * u + 1.70158) + 1.0; }
fn ease_in_out_back(t: f32) -> f32 {
  let k = 1.70158 * 1.525;
  let u = t * 2.0;
  let v = u - 2.0;
  return select(0.5 * (v * v * ((k + 1.0) * v + k) + 2.0), 0.5 * (u * u * ((k + 1.0) * u - k)), u < 1.0);
}
fn ease_out_bounce(t: f32) -> f32 {
  let a = (121.0 * t * t) / 16.0;
  let b = (363.0 / 40.0 * t * t) - (99.0 / 10.0 * t) + 17.0 / 5.0;
  let c = (4356.0 / 361.0 * t * t) - (35442.0 / 1805.0 * t) + 16061.0 / 1805.0;
  let d = (54.0 / 5.0 * t * t) - (513.0 / 25.0 * t) + 268.0 / 25.0;
  return select(select(select(d, c, t < 0.9), b, t < 8.0 / 11.0), a, t < 4.0 / 11.0);
}
fn ease_in_bounce(t: f32) -> f32 { return 1.0 - ease_out_bounce(1.0 - t); }
fn ease_in_out_bounce(t: f32) -> f32 { return select(ease_out_bounce(2.0 * t - 1.0) * 0.5 + 0.5, ease_in_bounce(2.0 * t) * 0.5, t < 0.5); }
fn ease_in_square(t: f32) -> f32 { return select(1.0, 0.0, t < 1.0); }
fn ease_out_square(t: f32) -> f32 { return select(0.0, 1.0, t > 0.0); }
fn ease_in_out_square(t: f32) -> f32 { return select(1.0, 0.0, t < 0.5); }
`;

