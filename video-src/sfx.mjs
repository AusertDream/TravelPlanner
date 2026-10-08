import fs from 'fs';
const SR = 48000;
function wav(name, data) {
  let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 0.89 / peak : 1;
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(data.length * 2, 40);
  data.forEach((v, i) => buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * g * 32767))), 44 + i * 2));
  fs.writeFileSync(`sfx/${name}.wav`, buf);
}
const N = s => Math.round(s * SR);
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
// one-pole lowpass / highpass helpers
function lp(x, fc) { const a = Math.exp(-2 * Math.PI * fc / SR); let y = 0; return x.map(v => (y = (1 - a) * v + a * y)); }
function hp(x, fc) { const l = lp(x, fc); return x.map((v, i) => v - l[i]); }
// variable bandpass (state variable filter)
function svf(x, fcFn, q = 1.2) { let lo = 0, bp = 0; const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) { const f = 2 * Math.sin(Math.PI * Math.min(fcFn(i / SR), SR / 6) / SR); const hi = x[i] - lo - bp / q; bp += f * hi; lo += f * bp; out[i] = bp; } return out; }
function env(t, a, d) { return t < a ? t / a : Math.exp(-(t - a) / d); }

// pop: quick upward sine chirp with fast decay
{ const L = N(0.14), x = new Float32Array(L); let ph = 0;
  for (let i = 0; i < L; i++) { const t = i / SR; const f = 520 + 900 * (1 - Math.exp(-t / 0.025)); ph += 2 * Math.PI * f / SR; x[i] = Math.sin(ph) * env(t, 0.002, 0.035); }
  wav('pop', x); }
// pop2: lower bubble
{ const L = N(0.16), x = new Float32Array(L); let ph = 0;
  for (let i = 0; i < L; i++) { const t = i / SR; const f = 300 + 500 * (1 - Math.exp(-t / 0.03)); ph += 2 * Math.PI * f / SR; x[i] = Math.sin(ph) * env(t, 0.002, 0.045); }
  wav('pop2', x); }
// whoosh: noise through sweeping bandpass, swell then fade
{ const L = N(0.7), n = Float32Array.from({ length: L }, rnd);
  const y = svf(n, t => 300 + 3200 * Math.sin(Math.PI * Math.min(t / 0.7, 1)) ** 2, 0.9);
  for (let i = 0; i < L; i++) { const t = i / SR; y[i] *= Math.sin(Math.PI * Math.min(t / 0.7, 1)) ** 1.6; }
  wav('whoosh', y); }
// swish: short fast whoosh
{ const L = N(0.32), n = Float32Array.from({ length: L }, rnd);
  const y = svf(n, t => 900 + 5000 * (t / 0.32), 1.1);
  for (let i = 0; i < L; i++) { const t = i / SR; y[i] *= Math.sin(Math.PI * t / 0.32) ** 2; }
  wav('swish', y); }
// ding: bell with inharmonic partials
function bell(f0, dur, name, parts = [[1, 1, 1], [2.0, .5, .6], [2.76, .35, .4], [5.4, .18, .25], [8.9, .08, .15]]) {
  const L = N(dur), x = new Float32Array(L);
  for (const [r, a, d] of parts) for (let i = 0; i < L; i++) { const t = i / SR; x[i] += a * Math.sin(2 * Math.PI * f0 * r * t) * env(t, 0.001, d * dur * 0.5); }
  wav(name, x);
}
bell(1318.5, 1.4, 'ding');
bell(1760, 1.0, 'ding_hi');
// tick: wood-block click
{ const L = N(0.08), x = new Float32Array(L);
  for (let i = 0; i < L; i++) { const t = i / SR; x[i] = (Math.sin(2 * Math.PI * 1900 * t) * 0.7 + Math.sin(2 * Math.PI * 3100 * t) * 0.3) * env(t, 0.0005, 0.012) + rnd() * 0.15 * env(t, 0.0002, 0.004); }
  wav('tick', x); }
// key: keyboard click (filtered noise burst + small body)
for (let k = 0; k < 4; k++) { const L = N(0.05), n = Float32Array.from({ length: L }, rnd); const y = hp(n, 1500 + k * 400);
  for (let i = 0; i < L; i++) { const t = i / SR; y[i] = y[i] * env(t, 0.0003, 0.006 + k * 0.001) + Math.sin(2 * Math.PI * (180 + 30 * k) * t) * 0.3 * env(t, 0.001, 0.01); }
  wav('key' + k, y); }
// stamp: low thump + paper slap
{ const L = N(0.45), x = new Float32Array(L); let ph = 0; const n = hp(Float32Array.from({ length: L }, rnd), 800);
  for (let i = 0; i < L; i++) { const t = i / SR; const f = 55 + 120 * Math.exp(-t / 0.03); ph += 2 * Math.PI * f / SR; x[i] = Math.sin(ph) * env(t, 0.001, 0.09) * 1.0 + n[i] * 0.5 * env(t, 0.0005, 0.025); }
  wav('stamp', x); }
// sparkle: rising glittery arpeggio
{ const L = N(1.3), x = new Float32Array(L); const notes = [1568, 1976, 2349, 2637, 3136, 3951, 4699];
  notes.forEach((f, k) => { const st = k * 0.07; for (let i = N(st); i < L; i++) { const t = i / SR - st; x[i] += Math.sin(2 * Math.PI * f * t) * env(t, 0.002, 0.18) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 9 * t)); } });
  wav('sparkle', x); }
// coin: ka-ching (two bright bells)
{ const L = N(0.9), x = new Float32Array(L);
  for (const [st, f] of [[0, 2093], [0.08, 2637]]) for (let i = N(st); i < L; i++) { const t = i / SR - st; x[i] += (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.7 * t)) * env(t, 0.001, 0.22); }
  wav('coin', x); }
// boing: wobbly spring for dizzy
{ const L = N(0.6), x = new Float32Array(L); let ph = 0;
  for (let i = 0; i < L; i++) { const t = i / SR; const f = 180 + 120 * Math.sin(2 * Math.PI * 14 * t) * Math.exp(-t / 0.3) + 200 * Math.exp(-t / 0.15); ph += 2 * Math.PI * f / SR; x[i] = Math.sin(ph) * env(t, 0.003, 0.18); }
  wav('boing', x); }
// rise: soft riser for transitions into reveal
{ const L = N(1.0), n = Float32Array.from({ length: L }, rnd); const y = svf(n, t => 400 + 6000 * (t / 1.0) ** 2, 2.0); let ph = 0;
  for (let i = 0; i < L; i++) { const t = i / SR; ph += 2 * Math.PI * (300 + 600 * t) / SR; y[i] = (y[i] * 0.7 + Math.sin(ph) * 0.2) * (t / 1.0) ** 1.5 * (t > 0.95 ? (1 - t) / 0.05 : 1); }
  wav('rise', y); }
// chime: gentle 3-note major chime for success
{ const L = N(1.6), x = new Float32Array(L);
  [[0, 1046.5], [0.11, 1318.5], [0.22, 1568]].forEach(([st, f]) => { for (let i = N(st); i < L; i++) { const t = i / SR - st; x[i] += (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2 * t)) * env(t, 0.002, 0.35); } });
  wav('chime', x); }
console.log(fs.readdirSync('sfx').join(' '));
