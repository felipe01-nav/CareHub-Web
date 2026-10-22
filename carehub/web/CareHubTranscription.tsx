// CareHub: private meeting transcription.
//
// The speech model (OpenAI's open Whisper model) runs inside this browser, on
// this computer. The meeting audio is never sent anywhere: not to the Care Hub
// server and not to any outside service. Only the model itself is downloaded
// once (from Hugging Face) and then kept in the browser's cache.
//
// This replaces the stock recorder, which streamed audio to AssemblyAI. It
// keeps the same shape (start / stop and the same callbacks), so the meeting
// notes block works unchanged. Words arrive a few seconds after each sentence.
import { useState } from 'react';

import audioWorkletUrl from '@/application/integrations/meeting-audio-worklet?worker&url';

export type MeetingAudioSource = 'microphone' | 'meeting';
export type TranscriptionState = 'starting' | 'recording' | 'stopping' | 'idle';

export class MeetingRecordingError extends Error {
  constructor(
    public readonly code: 'unsupported' | 'noSharedAudio' | 'alreadyRecording' | 'connectionFailed' | 'quotaExceeded'
  ) {
    super(code);
  }
}

// ---------------------------------------------------------------------------
// Settings (kept in this browser)
// ---------------------------------------------------------------------------
type Quality = 'fast' | 'accurate';
export type CarehubTranscribeSettings = { language: string; quality: Quality; speakers: boolean };

const SETTINGS_KEY = 'carehub-transcribe-settings';
const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
const MODELS: Record<Quality, string> = {
  fast: 'onnx-community/whisper-base',
  accurate: 'onnx-community/whisper-small',
};
const LANGUAGES: [string, string][] = [
  ['english', 'English'],
  ['portuguese', 'Portuguese'],
  ['spanish', 'Spanish'],
  ['french', 'French'],
  ['german', 'German'],
  ['italian', 'Italian'],
  ['dutch', 'Dutch'],
  ['norwegian', 'Norwegian'],
  ['swedish', 'Swedish'],
  ['danish', 'Danish'],
  ['auto', 'Detect automatically'],
];

export function getTranscribeSettings(): CarehubTranscribeSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<CarehubTranscribeSettings>;

    return {
      language: LANGUAGES.some(([value]) => value === saved.language) ? (saved.language as string) : 'english',
      quality: saved.quality === 'accurate' ? 'accurate' : 'fast',
      speakers: saved.speakers !== false,
    };
  } catch {
    return { language: 'english', quality: 'fast', speakers: true };
  }
}

function saveTranscribeSettings(settings: CarehubTranscribeSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // private mode: keep the defaults
  }
}

/** Language and quality pickers, shown above the "Meeting tab / Microphone" buttons. */
export function CareHubTranscribeOptions() {
  const [settings, setSettings] = useState(getTranscribeSettings);
  const update = (patch: Partial<CarehubTranscribeSettings>) => {
    const next = { ...settings, ...patch };

    setSettings(next);
    saveTranscribeSettings(next);
  };
  const selectClass =
    'rounded-md border border-border-primary bg-bg-body px-1.5 py-1 text-xs text-text-primary outline-none';

  return (
    <div className='mb-3 flex flex-col gap-2 text-xs text-text-secondary'>
      <div className='flex flex-wrap items-center gap-3'>
        <label className='flex items-center gap-1.5'>
          Language
          <select className={selectClass} value={settings.language} onChange={(e) => update({ language: e.target.value })}>
            {LANGUAGES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className='flex items-center gap-1.5'>
          Quality
          <select
            className={selectClass}
            value={settings.quality}
            onChange={(e) => update({ quality: e.target.value === 'accurate' ? 'accurate' : 'fast' })}
          >
            <option value='fast'>Fast (about 150 MB download)</option>
            <option value='accurate'>Accurate (about 500 MB download, slower)</option>
          </select>
        </label>
        <label className='flex items-center gap-1.5' title='Guesses who is talking from the sound of each voice. Not perfect.'>
          <input type='checkbox' checked={settings.speakers} onChange={(e) => update({ speakers: e.target.checked })} />
          Label speakers (best guess)
        </label>
      </div>
      <span>
        🔒 Private: the speech model runs on this computer and the audio never leaves it. The first time, the model is
        downloaded once.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The speech model runs in a background worker so the page stays smooth.
// ---------------------------------------------------------------------------
const WORKER_SOURCE = [
  "import { pipeline, env } from '" + LIB_URL + "';",
  'env.allowLocalModels = false;',
  "let asr = null; let current = '';",
  'function build(model, gpu) {',
  '  const files = {};',
  '  const progress_callback = (p) => {',
  "    if (!p || p.status !== 'progress' || !p.file) return;",
  '    files[p.file] = [p.loaded || 0, p.total || 0];',
  '    let done = 0; let total = 0;',
  '    for (const key in files) { done += files[key][0]; total += files[key][1]; }',
  "    if (total) self.postMessage({ type: 'progress', percent: Math.floor((done * 100) / total) });",
  '  };',
  '  return pipeline(',
  "    'automatic-speech-recognition',",
  '    model,',
  "    gpu ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback }",
  "        : { device: 'wasm', dtype: 'q8', progress_callback }",
  '  );',
  '}',
  'async function hasGpu() {',
  '  try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch (e) { return false; }',
  '}',
  'async function load(model) {',
  '  if (asr && current === model) return;',
  '  if (asr && asr.dispose) { try { await asr.dispose(); } catch (e) {} }',
  "  asr = null; current = '';",
  '  if (await hasGpu()) {',
  '    try {',
  '      const gpuAsr = await build(model, true);',
  '      await gpuAsr(new Float32Array(16000));',
  '      asr = gpuAsr; current = model; return;',
  '    } catch (e) {}',
  '  }',
  '  asr = await build(model, false); current = model;',
  '}',
  'self.onmessage = async (event) => {',
  '  const data = event.data;',
  '  try {',
  "    if (data.type === 'load') {",
  '      await load(data.model);',
  "      self.postMessage({ id: data.id, type: 'done' });",
  "    } else if (data.type === 'run') {",
  "      if (!asr) throw new Error('The speech model is not ready.');",
  "      const options = { task: 'transcribe' };",
  "      if (data.language && data.language !== 'auto') options.language = data.language;",
  '      const out = await asr(data.audio, options);',
  "      const text = Array.isArray(out) ? out.map((o) => o.text || '').join(' ') : (out && out.text) || '';",
  "      self.postMessage({ id: data.id, type: 'done', text });",
  '    }',
  '  } catch (error) {',
  "    self.postMessage({ id: data.id, type: 'error', message: String((error && error.message) || error) });",
  '  }',
  '};',
].join('\n');

type WorkerReply = { id?: number; type: 'done' | 'error' | 'progress'; text?: string; message?: string; percent?: number };

let worker: Worker | undefined;
let workerUrl: string | undefined;
let callSeq = 0;
const pending = new Map<number, { resolve: (reply: WorkerReply) => void; reject: (error: Error) => void }>();
let progressListener: ((percent: number) => void) | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function disposeWorker() {
  worker?.terminate();
  worker = undefined;
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  workerUrl = undefined;
}

function getWorker() {
  if (worker) return worker;
  workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  const created = new Worker(workerUrl, { type: 'module' });

  created.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
    if (data.type === 'progress') {
      progressListener?.(data.percent ?? 0);
      return;
    }

    const waiting = data.id === undefined ? undefined : pending.get(data.id);

    if (!waiting || data.id === undefined) return;
    pending.delete(data.id);
    if (data.type === 'error') waiting.reject(new Error(data.message || 'The speech model failed.'));
    else waiting.resolve(data);
  };

  created.onerror = (event) => {
    event.preventDefault();
    const error = new Error(
      'The speech model could not be started. The first time, it needs the internet to download. Please try again.'
    );

    pending.forEach((waiting) => waiting.reject(error));
    pending.clear();
    if (worker === created) disposeWorker();
  };

  worker = created;
  return created;
}

function callWorker(message: Record<string, unknown>, transfer: Transferable[] = []) {
  return new Promise<WorkerReply>((resolve, reject) => {
    const id = ++callSeq;

    pending.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ ...message, id }, transfer);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

// Free the memory a while after the last meeting (8 GB Macs).
function scheduleIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!pending.size) disposeWorker();
  }, 10 * 60 * 1000);
}

function cancelIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
}

// ---------------------------------------------------------------------------
// Audio helpers
// ---------------------------------------------------------------------------
const TARGET_RATE = 16000;
const FRAMES_PER_SECOND = 10; // the audio worklet sends 100 ms pieces
const MIN_SECONDS = 3;
const MAX_SECONDS = 25;
const END_SILENCE_FRAMES = 6; // 0.6 s pause ends a sentence
const LEAD_IN_FRAMES = 4;

function toModelAudio(frames: Float32Array[], rate: number) {
  let length = 0;

  for (const frame of frames) length += frame.length;
  const input = new Float32Array(length);
  let offset = 0;

  for (const frame of frames) {
    input.set(frame, offset);
    offset += frame.length;
  }

  let output = input;

  if (rate !== TARGET_RATE && length) {
    const ratio = rate / TARGET_RATE;

    output = new Float32Array(Math.max(1, Math.floor(length / ratio)));
    if (ratio > 1) {
      for (let i = 0; i < output.length; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
        let sum = 0;

        for (let j = start; j < end; j++) sum += input[j];
        output[i] = sum / (end - start);
      }
    } else {
      for (let i = 0; i < output.length; i++) {
        const position = i * ratio;
        const left = Math.floor(position);
        const right = Math.min(length - 1, left + 1);
        const weight = position - left;

        output[i] = input[left] * (1 - weight) + input[right] * weight;
      }
    }
  }

  // Quiet audio: raise the volume a little (at most 8x).
  let peak = 0;

  for (let i = 0; i < output.length; i++) peak = Math.max(peak, Math.abs(output[i]));
  if (peak > 0 && peak < 0.5) {
    const gain = Math.min(8, 0.9 / peak);

    for (let i = 0; i < output.length; i++) output[i] *= gain;
  }

  return output;
}

const MADE_UP = new Set([
  'you',
  'thank you',
  'thank you.',
  'thanks.',
  'thanks for watching!',
  'thanks for watching.',
  'thank you for watching.',
  'thank you for watching!',
  'bye.',
  'bye!',
  'okay.',
  'so.',
]);

// Whisper sometimes writes "[BLANK_AUDIO]", "(music)" or a polite "Thank you." on noise.
function cleanText(raw: string | undefined, voicedFrames: number) {
  const text = (raw || '')
    .replace(/\[[^\]]{0,40}\]|\([^)]{0,40}\)|\*[^*]{0,40}\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!/[\p{L}\p{N}]/u.test(text)) return '';
  if (voicedFrames < 15 && MADE_UP.has(text.toLowerCase())) return '';
  return text;
}

type Piece = { audio: Float32Array; turn: number; voiced: number; who?: string };

// ---------------------------------------------------------------------------
// Speaker labels (best guess, all on this computer)
// A short "voiceprint" per sentence: the average shape of the voice (MFCC)
// and its pitch. Similar prints get the same "Speaker N".
// ---------------------------------------------------------------------------
const FFT_SIZE = 512;
const MEL_BANDS = 24;
const CEPSTRA = 12;
let melBank: Float32Array[] | undefined;
let hann: Float32Array | undefined;

function melFilters() {
  if (melBank) return melBank;
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const hz = (m: number) => 700 * (10 ** (m / 2595) - 1);
  const low = mel(80);
  const high = mel(5000);
  const points = Array.from({ length: MEL_BANDS + 2 }, (_, i) => hz(low + ((high - low) * i) / (MEL_BANDS + 1)));
  const bins = points.map((f) => Math.floor(((FFT_SIZE + 1) * f) / TARGET_RATE));

  melBank = [];
  for (let m = 1; m <= MEL_BANDS; m++) {
    const filter = new Float32Array(FFT_SIZE / 2 + 1);

    for (let k = bins[m - 1]; k < bins[m]; k++) filter[k] = (k - bins[m - 1]) / Math.max(1, bins[m] - bins[m - 1]);
    for (let k = bins[m]; k < bins[m + 1]; k++) filter[k] = (bins[m + 1] - k) / Math.max(1, bins[m + 1] - bins[m]);
    melBank.push(filter);
  }

  return melBank;
}

function fftPower(re: Float32Array): Float32Array {
  const n = re.length;
  const im = new Float32Array(n);

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;

    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const t = re[i];

      re[i] = re[j];
      re[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;

      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;

        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const next = cr * wr - ci * wi;

        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }

  const power = new Float32Array(n / 2 + 1);

  for (let k = 0; k <= n / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
  return power;
}

function framePitch(frame: Float32Array) {
  const minLag = Math.floor(TARGET_RATE / 400);
  const maxLag = Math.floor(TARGET_RATE / 70);
  let energy = 0;

  for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
  if (energy <= 0) return 0;
  let best = 0;
  let bestLag = 0;

  for (let lag = minLag; lag <= maxLag && lag < frame.length - 32; lag++) {
    let sum = 0;

    for (let i = 0; i + lag < frame.length; i++) sum += frame[i] * frame[i + lag];
    const r = sum / energy;

    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }

  return best > 0.35 && bestLag ? TARGET_RATE / bestLag : 0;
}

type Voiceprint = { mfcc: Float32Array; pitch: number };

/** Average voice shape and pitch of the louder parts of a 16 kHz clip. */
function voiceprint(audio: Float32Array): Voiceprint | null {
  const hop = FFT_SIZE / 2;
  const count = Math.floor((audio.length - FFT_SIZE) / hop);

  if (count < 20) return null;
  if (!hann) hann = Float32Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const energies = new Float32Array(count);

  for (let f = 0; f < count; f++) {
    let e = 0;

    for (let i = 0; i < FFT_SIZE; i++) e += audio[f * hop + i] ** 2;
    energies[f] = e;
  }

  const threshold = Float32Array.from(energies).sort()[Math.floor(count * 0.5)];
  const filters = melFilters();
  const sum = new Float32Array(CEPSTRA);
  const pitches: number[] = [];
  let used = 0;
  const logMel = new Float32Array(MEL_BANDS);

  for (let f = 0; f < count; f++) {
    if (energies[f] < threshold || energies[f] <= 0) continue;
    const frame = new Float32Array(FFT_SIZE);

    for (let i = 0; i < FFT_SIZE; i++) frame[i] = audio[f * hop + i] * (hann as Float32Array)[i];
    if (f % 2 === 0) {
      const p = framePitch(audio.subarray(f * hop, f * hop + FFT_SIZE));

      if (p) pitches.push(p);
    }

    const power = fftPower(frame);

    for (let m = 0; m < MEL_BANDS; m++) {
      let e = 0;
      const filter = filters[m];

      for (let k = 0; k < power.length; k++) if (filter[k]) e += filter[k] * power[k];
      logMel[m] = Math.log(e + 1e-10);
    }

    for (let c = 1; c <= CEPSTRA; c++) {
      let v = 0;

      for (let m = 0; m < MEL_BANDS; m++) v += logMel[m] * Math.cos((Math.PI * c * (m + 0.5)) / MEL_BANDS);
      sum[c - 1] += v;
    }

    used++;
  }

  if (used < 10) return null;
  for (let c = 0; c < CEPSTRA; c++) sum[c] /= used;
  pitches.sort((a, b) => a - b);
  return { mfcc: sum, pitch: pitches.length >= 3 ? pitches[Math.floor(pitches.length / 2)] : 0 };
}

class SpeakerGuesser {
  private speakers: { mean: Float32Array; pitch: number; count: number }[] = [];
  private n = 0;
  private avg = new Float32Array(CEPSTRA);
  private m2 = new Float32Array(CEPSTRA);
  private last = '';

  private spread(c: number) {
    return this.n >= 4 ? Math.max(0.3, Math.sqrt(this.m2[c] / (this.n - 1))) : 2;
  }

  private distance(a: Voiceprint, s: { mean: Float32Array; pitch: number }) {
    let sum = 0;

    for (let c = 0; c < CEPSTRA; c++) sum += ((a.mfcc[c] - s.mean[c]) / this.spread(c)) ** 2;
    const pitchGap = a.pitch && s.pitch ? Math.abs(Math.log(a.pitch / s.pitch)) : 0;

    return Math.sqrt(sum / CEPSTRA) + 1.5 * pitchGap;
  }

  /** "Speaker N" for this clip, or the previous speaker when unsure. */
  guess(audio: Float32Array, voicedFrames: number): string {
    const print = voicedFrames >= 10 ? voiceprint(audio) : null;

    if (!print) return this.last || 'Speaker 1';
    this.n++;
    for (let c = 0; c < CEPSTRA; c++) {
      const delta = print.mfcc[c] - this.avg[c];

      this.avg[c] += delta / this.n;
      this.m2[c] += delta * (print.mfcc[c] - this.avg[c]);
    }

    let best = -1;
    let bestDistance = Infinity;

    this.speakers.forEach((s, i) => {
      const d = this.distance(print, s);

      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    if (best < 0 || (bestDistance > 1.35 && this.speakers.length < 6)) {
      this.speakers.push({ mean: Float32Array.from(print.mfcc), pitch: print.pitch, count: 1 });
      best = this.speakers.length - 1;
    } else {
      const s = this.speakers[best];
      const w = 1 / Math.min(20, s.count + 1);

      for (let c = 0; c < CEPSTRA; c++) s.mean[c] += (print.mfcc[c] - s.mean[c]) * w;
      if (print.pitch) s.pitch = s.pitch ? s.pitch + (print.pitch - s.pitch) * w : print.pitch;
      s.count++;
    }

    this.last = `Speaker ${best + 1}`;
    return this.last;
  }
}

function levelOf(analyser: AnalyserNode, buffer: Float32Array) {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;

  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

/** One recording: microphone (and meeting tab) -> sentences -> Whisper -> transcript. */
export class MeetingTranscription {
  private static activeSession?: MeetingTranscription;
  private readonly settings = getTranscribeSettings();
  private streams: MediaStream[] = [];
  private context?: AudioContext;
  private processor?: AudioWorkletNode;
  private sampleRate = 48000;
  private closed = false;
  private failed = false;
  private stopping?: Promise<void>;
  private frames: Float32Array[] = [];
  private voiced = 0;
  private silentRun = 0;
  private floor = -1;
  private queue: Piece[] = [];
  private turn = 0;
  private working?: Promise<void>;
  private model?: Promise<void>;
  private modelReady = false;
  private status = '';
  private speakers = new SpeakerGuesser();
  private micAnalyser?: AnalyserNode;
  private tabAnalyser?: AnalyserNode;
  private levelBuffer = new Float32Array(2048);
  private micLevel = 0;
  private tabLevel = 0;
  private lastSpeaker = '';

  constructor(
    _workspaceId: string,
    private readonly callbacks: {
      onState: (state: TranscriptionState) => void;
      onPartial: (text: string) => void;
      onTranscript: (text: string, turnOrder?: number) => void;
      onError: (error: unknown) => void;
      onPendingDuration: (seconds: number) => void;
    }
  ) {
    void _workspaceId;
  }

  async start(source: MeetingAudioSource, _pendingDuration = 0) {
    void _pendingDuration;
    if (MeetingTranscription.activeSession) throw new MeetingRecordingError('alreadyRecording');
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined' ||
      typeof Worker === 'undefined' ||
      (source === 'meeting' && !navigator.mediaDevices.getDisplayMedia)
    )
      throw new MeetingRecordingError('unsupported');
    MeetingTranscription.activeSession = this;
    cancelIdle();
    this.callbacks.onState('starting');
    try {
      // Screen capture must be requested directly from the button click.
      if (source === 'meeting') {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

        this.addStream(display);
        if (!display.getAudioTracks().length) throw new MeetingRecordingError('noSharedAudio');
      }

      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });

      this.addStream(microphone);
      this.callbacks.onPendingDuration(0);
      this.assertOpen();

      // Get the model ready in the background. Audio is kept until it is ready.
      this.model = this.loadModel();
      this.model.catch((error: unknown) => this.fail(error));

      this.context = new AudioContext();
      this.sampleRate = this.context.sampleRate;
      await this.context.audioWorklet.addModule(audioWorkletUrl);
      this.assertOpen();
      this.processor = new AudioWorkletNode(this.context, 'meeting-audio', {
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      this.processor.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => this.onFrame(new Int16Array(data));
      for (const stream of this.streams) {
        const input = this.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));

        input.connect(this.processor);
        if (this.settings.speakers && source === 'meeting') {
          // Which side is talking: this computer's microphone ("You") or the meeting tab.
          const analyser = this.context.createAnalyser();

          analyser.fftSize = 2048;
          input.connect(analyser);
          if (stream.getVideoTracks().length) this.tabAnalyser = analyser;
          else this.micAnalyser = analyser;
        }
      }

      this.processor.connect(this.context.destination);
      await this.context.resume();
      this.assertOpen();
      this.callbacks.onState('recording');
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private assertOpen() {
    if (this.closed) throw new DOMException('Recording cancelled', 'AbortError');
  }

  private addStream(stream: MediaStream) {
    if (this.closed) {
      stream.getTracks().forEach((track) => track.stop());
      this.assertOpen();
    }

    this.streams.push(stream);
    stream.getTracks().forEach((track) =>
      track.addEventListener(
        'ended',
        () => {
          void this.stop();
        },
        { once: true }
      )
    );
  }

  private showStatus() {
    this.callbacks.onPartial(this.status);
  }

  private async loadModel() {
    const listener = (percent: number) => {
      if (this.modelReady) return;
      this.status =
        percent < 100
          ? `Downloading the private speech model (first time only)… ${percent}%`
          : 'Starting the speech model…';
      this.showStatus();
    };

    progressListener = listener;
    this.status = 'Starting the speech model…';
    this.showStatus();
    try {
      await callWorker({ type: 'load', model: MODELS[this.settings.quality] });
      this.modelReady = true;
      this.status = '';
      this.showStatus();
    } finally {
      if (progressListener === listener) progressListener = undefined;
    }
  }

  private onFrame(pcm: Int16Array) {
    if (this.closed) return;
    const frame = new Float32Array(pcm.length);
    let sum = 0;

    for (let i = 0; i < pcm.length; i++) {
      const value = pcm[i] / 32768;

      frame[i] = value;
      sum += value * value;
    }

    const rms = Math.sqrt(sum / Math.max(1, pcm.length));

    // Background level: drops at once, rises slowly.
    if (this.floor < 0 || rms < this.floor) this.floor = rms;
    else this.floor += (rms - this.floor) * 0.002;
    const speech = rms > 0.002 && rms > this.floor * 3;

    this.frames.push(frame);
    if (speech) {
      this.voiced++;
      this.silentRun = 0;
      if (this.micAnalyser && this.tabAnalyser) {
        this.micLevel += levelOf(this.micAnalyser, this.levelBuffer);
        this.tabLevel += levelOf(this.tabAnalyser, this.levelBuffer);
      }
    } else {
      this.silentRun++;
    }

    if (!this.voiced) {
      // Only silence so far: keep a short lead-in.
      if (this.frames.length > LEAD_IN_FRAMES) this.frames.splice(0, this.frames.length - LEAD_IN_FRAMES);
      this.silentRun = 0;
      return;
    }

    const seconds = this.frames.length / FRAMES_PER_SECOND;

    if ((seconds >= MIN_SECONDS && this.silentRun >= END_SILENCE_FRAMES) || seconds >= MAX_SECONDS) this.cut();
  }

  private cut() {
    const frames = this.frames;
    const voiced = this.voiced;

    this.frames = [];
    this.voiced = 0;
    this.silentRun = 0;
    if (voiced < 3) {
      this.micLevel = 0;
      this.tabLevel = 0;
      return;
    }

    this.queue.push(this.piece(frames, voiced));
    void this.work().catch((error: unknown) => this.fail(error));
  }

  private piece(frames: Float32Array[], voiced: number): Piece {
    const audio = toModelAudio(frames, this.sampleRate);
    let who: string | undefined;

    if (this.settings.speakers) {
      try {
        if (this.micAnalyser && this.tabAnalyser && this.micLevel > this.tabLevel * 1.5) who = 'You';
        else who = this.speakers.guess(audio, voiced);
      } catch {
        who = undefined;
      }
    }

    this.micLevel = 0;
    this.tabLevel = 0;
    return { audio, turn: ++this.turn, voiced, who };
  }

  private label(piece: Piece, text: string) {
    if (!piece.who) return text;
    if (piece.who === this.lastSpeaker) return text;
    this.lastSpeaker = piece.who;
    return `${piece.who}: ${text}`;
  }

  private work(): Promise<void> {
    if (this.working) return this.working;
    this.working = (async () => {
      try {
        await this.model;
        while (this.queue.length && !this.failed) {
          if (this.queue.length > 2) {
            this.status = `Catching up… (${this.queue.length} parts waiting)`;
            this.showStatus();
          }

          const piece = this.queue.shift() as Piece;
          const reply = await callWorker({ type: 'run', audio: piece.audio, language: this.settings.language }, [
            piece.audio.buffer,
          ]);
          const text = cleanText(reply.text, piece.voiced);

          if (text) this.callbacks.onTranscript(this.label(piece, text), piece.turn);
        }

        if (this.status.startsWith('Catching up')) {
          this.status = '';
          this.showStatus();
        }
      } finally {
        this.working = undefined;
      }
    })();
    return this.working;
  }

  private fail(error: unknown) {
    if (this.stopping || this.failed) return;
    this.failed = true;
    this.callbacks.onError(error);
    void this.stop();
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closed = true;
    this.streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    this.processor?.disconnect();
    if (this.processor) this.processor.port.onmessage = null;
    this.callbacks.onState('stopping');
    this.stopping = (async () => {
      // The last sentence.
      if (this.frames.length && !this.failed) {
        const frames = this.frames;
        const voiced = this.voiced;

        this.frames = [];
        if (voiced >= 3) this.queue.push(this.piece(frames, voiced));
      }

      await this.context?.close().catch(() => undefined);
      if (!this.failed && this.model) {
        try {
          while (this.working || (this.queue.length && !this.failed)) await this.work();
        } catch (error) {
          this.callbacks.onError(error);
        }
      }

      this.status = '';
      this.callbacks.onPartial('');
      if (MeetingTranscription.activeSession === this) MeetingTranscription.activeSession = undefined;
      scheduleIdle();
      this.callbacks.onState('idle');
    })();
    return this.stopping;
  }
}
