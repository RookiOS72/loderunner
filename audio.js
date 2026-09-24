/* Audio — synthesized via WebAudio, no asset files.
 *
 * The 1983 original was silent (the README calls sound "optional"), so
 * this isn't a reproduction of anything — just short, cheap sound
 * effects for the events that most need feedback: digging, picking up
 * gold, trapping a guard, a guard dying in a hole, the player dying,
 * and winning a level. Same approach as the sibling asteroids project
 * (blip/noise helpers into a shared master gain), scaled down since
 * Lode Runner has no persistent sounds (no thrust/drone equivalent).
 *
 * Gated on a user-initiated AudioContext per the browser autoplay
 * policy — call unlock() from an input handler before anything plays.
 */

const Audio = (() => {
  let ctx = null;
  let masterGain = null;
  let muted = false;

  function init() {
    if (ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(ctx.destination);
  }

  function unlock() {
    if (!ctx) init();
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  function setMuted(m) {
    muted = m;
  }

  // A single tone with an exponential decay. `endFreq`, if given, ramps
  // the pitch across the tone's duration (a rising or falling blip).
  function blip(freq, durMs, type = "square", vol = 0.3, endFreq = null) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + durMs / 1000);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durMs / 1000);
    osc.connect(gain).connect(masterGain);
    osc.start(t);
    osc.stop(t + durMs / 1000 + 0.02);
  }

  // A filtered noise burst — used for the dig thunk and the enemy-death poof.
  function noise(durMs, vol = 0.3, filterFreq = 1200, filterQ = 1) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * (durMs / 1000));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = 1 - i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    filter.Q.value = filterQ;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durMs / 1000);
    src.connect(filter).connect(gain).connect(masterGain);
    src.start(t);
  }

  // A short sequence of blips, each `stepMs` apart — used for the
  // win/lose stingers (a little arpeggio up or down).
  function arpeggio(freqs, stepMs, durMs, type = "square", vol = 0.25) {
    if (!ctx || muted) return;
    freqs.forEach((f, i) => {
      setTimeout(() => blip(f, durMs, type, vol), i * stepMs);
    });
  }

  // ---- Game-specific events ----

  function dig() {
    noise(90, 0.22, 700, 1.2);
  }

  function gold() {
    blip(880, 50, "square", 0.18);
    setTimeout(() => blip(1320, 90, "square", 0.18), 45);
  }

  function trap() {
    blip(700, 120, "sawtooth", 0.2, 300); // falling pitch — "gotcha"
  }

  function enemyDeath() {
    noise(160, 0.25, 900, 1);
  }

  function playerDeath() {
    arpeggio([440, 349, 261, 196], 110, 160, "square", 0.22);
  }

  function win() {
    arpeggio([392, 523, 659, 784], 90, 140, "square", 0.22);
  }

  return {
    init, unlock, setMuted,
    dig, gold, trap, enemyDeath, playerDeath, win,
  };
})();
